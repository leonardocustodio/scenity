// SPDX-License-Identifier: Apache-2.0
/**
 * The performance run of the workbench. It takes the GPU lock and starts the host in test mode (the terminals run an
 * idle zsh) and the page server. Then it measures these values in Chromium (the GPU of the Mac):
 *
 * 1. the frame statistics of the lab alone and of the lab in the workbench frame with the Claude panel open, two runs
 *    each. The URL is `adaptive=0&gpu=1&tier=high&worker=1&t=9000&paused=1`, with the take of the lab in
 *    `SCENITY_WORKBENCH_E2E_LAB`;
 * 2. the CPU of the host over 60 s while the lab is paused and the terminal waits;
 * 3. the sizes of the captures at 1280 px (WebP 0.92, lossless WebP, PNG);
 * 4. the time of a `lab_frame` call, and the time from an edit hook to the after picture.
 *
 *   cd apps/workbench && bun tests/perf/run.ts [--out <file.json>] [--idle <seconds>]
 */
import type { ChildProcess } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { parseArgs } from "node:util";
import { chromium, type Browser, type Page } from "@playwright/test";
import { gpuLock } from "../../../editor/scripts/lab/gpuLock";
import { E2E_ENV, LAB_QUERY_ENV, type E2eSetup } from "../e2e/env";
import { hostRequest, hostTool, injectHmr, labFrame } from "../e2e/harness";
import { CHECKOUT, PAGE_DIR, startPageServer, startTestHost, stopChild } from "../e2e/processes";
import {
  captureSizes,
  editToAfter,
  frameStats,
  HostEvents,
  labFrameTimes,
  labReady,
  percentiles,
  processCpu,
  type FrameStats,
} from "./measure";

// The project of the lab plugin gives its take in the variable of env.ts.
const LAB_QUERY = process.env[LAB_QUERY_ENV] ?? "?adaptive=0&gpu=1&tier=high&worker=1&t=9000&paused=1";
const VIEWPORT = { width: 1440, height: 868 };
const GPU_ARGS = process.platform === "darwin" ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [];

async function newPage(browser: Browser, viewport = VIEWPORT): Promise<Page> {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 2 });
  return context.newPage();
}

/** The lab page alone, on the lab dev server of the host, with the same URL state, in a window of a size. */
async function labAlone(browser: Browser, labOrigin: string, viewport = VIEWPORT): Promise<FrameStats> {
  const page = await newPage(browser, viewport);
  try {
    await page.goto(`${labOrigin}/${LAB_QUERY}`);
    await labReady(page.mainFrame());
    return await frameStats(page.mainFrame());
  } finally {
    await page.context().close();
  }
}

/** The workbench page with the Claude panel (an idle zsh in the terminal) and the lab in its frame. */
async function openWorkbenchPage(browser: Browser, setup: E2eSetup): Promise<Page> {
  const page = await newPage(browser);
  await page.goto(`${setup.page}/?host=${encodeURIComponent(setup.host.origin)}#token=${setup.host.token}`);
  await page.getByTestId("workspace").waitFor({ timeout: 30_000 });
  await page.locator('[data-testid="terminal-claude"]').waitFor({ timeout: 30_000 });
  await labReady(await labFrame(page));
  return page;
}

async function labOriginOf(): Promise<string> {
  const hello = (await hostRequest("host.hello")) as { surfaces: { id: string; url: string | null }[] };
  const url = hello.surfaces.find((surface) => surface.id === "lab")?.url;
  if (url === null || url === undefined) throw new Error("The lab surface has no URL.");
  return new URL(url).origin;
}

async function waitLabServer(): Promise<string> {
  for (let tries = 0; tries < 240; tries += 1) {
    try {
      return await labOriginOf();
    } catch {
      await new Promise((done) => setTimeout(done, 250));
    }
  }
  throw new Error("The lab dev server did not start in 60 s.");
}

/** The frame runs (alone, workbench, alone, workbench), the capture sizes and the tool times. */
async function pageMeasures(browser: Browser, setup: E2eSetup): Promise<Record<string, unknown>> {
  const labOrigin = await waitLabServer();
  const alone: FrameStats[] = [];
  const inWorkbench: FrameStats[] = [];
  // The lab alone in a window of the size of the workbench frame: the same pixels as in the frame.
  const aloneAtFrameSize: FrameStats[] = [];
  let page: Page | null = null;
  for (let run = 0; run < 2; run += 1) {
    alone.push(await labAlone(browser, labOrigin));
    page = await openWorkbenchPage(browser, setup);
    inWorkbench.push(await frameStats(await labFrame(page)));
    const box = await page.locator('[data-surface-tab="lab"] iframe[data-frame="lab-visible"]').boundingBox();
    const size = { width: Math.round(box?.width ?? 0), height: Math.round(box?.height ?? 0) };
    if (run === 0) await page.context().close();
    aloneAtFrameSize.push({
      ...(await labAlone(browser, labOrigin, size)),
      frame: `${String(size.width)}x${String(size.height)}`,
    });
  }
  if (page === null) throw new Error("No workbench page.");
  const sizes = [await captureSizes(page, 1280)];
  await hostTool("lab_frame", { t: 9000, camera: "top", width: 320 });
  sizes.push(await captureSizes(page, 1280));
  const frame1280 = await labFrameTimes(1280, 10);
  const frame640 = await labFrameTimes(640, 10);
  return { page, alone, inWorkbench, aloneAtFrameSize, sizes, frame1280, frame640 };
}

async function editTimes(page: Page, setup: E2eSetup): Promise<number[]> {
  const events = new HostEvents(setup.host);
  const scratch = join(CHECKOUT, "apps", "editor", "src", `workbench-perf-${String(process.pid)}.txt`);
  try {
    const times: number[] = [];
    for (let index = 0; index < 5; index += 1) {
      times.push(
        await editToAfter(
          { events, checkout: CHECKOUT, scratch, hmr: (file) => injectHmr(page, [file]) },
          `perf-edit-${String(index)}`,
        ),
      );
    }
    return times;
  } finally {
    events.close();
    rmSync(scratch, { force: true });
  }
}

async function measureAll(setup: E2eSetup, hostPid: number, idleSeconds: number): Promise<Record<string, unknown>> {
  const browser = await chromium.launch({ channel: "chromium", args: GPU_ARGS });
  try {
    const { page, ...pages } = await pageMeasures(browser, setup);
    const workbench = page as Page;
    const edits = await editTimes(workbench, setup);
    // The idle host: the lab is paused (frameStats pauses it), and the zsh of the terminal waits.
    await new Promise((done) => setTimeout(done, 5_000));
    const idle = await processCpu(hostPid, idleSeconds);
    return { ...pages, editToAfter: edits, idle };
  } finally {
    await browser.close();
  }
}

function summary(result: Record<string, unknown>): Record<string, unknown> {
  const times = (value: unknown): unknown =>
    typeof value === "object" && value !== null && "ms" in value ? percentiles((value as { ms: number[] }).ms) : null;
  return {
    ...result,
    frame1280Times: times(result.frame1280),
    frame640Times: times(result.frame640),
    editToAfterTimes: percentiles(result.editToAfter as number[]),
  };
}

async function main(): Promise<void> {
  const { values } = parseArgs({ options: { out: { type: "string" }, idle: { type: "string" } } });
  const release = await gpuLock({ log: (text) => console.error(`workbench perf: ${text}`) });
  const state = mkdtempSync(join(tmpdir(), "workbench-perf-state-"));
  const children: ChildProcess[] = [];
  try {
    const host = await startTestHost({ state, labQuery: LAB_QUERY, shell: "/bin/zsh" }, children);
    const page = await startPageServer(children);
    const setup: E2eSetup = { host: host.endpoint, page: page.origin, checkout: CHECKOUT, state };
    process.env[E2E_ENV] = JSON.stringify(setup);
    const result = summary(await measureAll(setup, host.pid, Number(values.idle ?? "60")));
    const text = JSON.stringify({ date: new Date().toISOString(), lab: LAB_QUERY, ...result }, null, 2);
    const out = values.out ?? join(PAGE_DIR, "test-results", `perf-${String(Date.now())}.json`);
    mkdirSync(dirname(out), { recursive: true });
    writeFileSync(out, `${text}\n`);
    console.log(text);
    console.log(`workbench perf: ${out}`);
  } finally {
    await Promise.all(children.map(stopChild));
    rmSync(state, { recursive: true, force: true });
    release();
  }
}

await main();
