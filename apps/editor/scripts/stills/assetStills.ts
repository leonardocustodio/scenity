// SPDX-License-Identifier: Apache-2.0
/**
 * The renderer of the asset stills. @scenity/assets makes the stills plan of a project and keeps the stamps of the
 * stills (`@scenity/assets/stills`). This script draws the stills in the still page of the editor (still.html, src/still) in
 * Chromium with the GPU, and writes `<project>/stills/<id>.webp` with the stamps.
 *
 *   bun apps/editor/scripts/stills/assetStills.ts <projectDir> [id ...] [--force]   draw the missing and stale stills
 *   bun apps/editor/scripts/stills/assetStills.ts <projectDir> --check              exit 1 on a missing or stale still
 *
 * Bun bundles the still page and serves it with the files of the project, so the script needs no Vite server. The
 * script takes the GPU lock of the tools for the render batch only. The renderer version is the hash of the files of
 * the still page: a change of the page makes each still stale (the check of `cli.ts stills` does not compare it).
 */
import { platform } from "node:os";
import { resolve } from "node:path";
import type { Browser, Page } from "@playwright/test";
import {
  makeStills,
  planStills,
  type StillRenderer,
  type StillRenderJob,
} from "../../../../packages/assets/src/stills/index.ts";
import { gpuLock } from "../lab/gpuLock";
import { STILL_QUALITY, STILL_SCALE } from "../../src/still/stillCapture";
import { stillServer, type StillServer } from "./stillServer";
import { rendererVersion } from "./stillVersion";

/** A renderer of stills in a Chromium page. */
export class BrowserStillRenderer implements StillRenderer {
  readonly version = rendererVersion();
  #release: (() => void) | null = null;
  #server: StillServer | null = null;
  #browser: Browser | null = null;
  #page: Page | null = null;

  async open(projectDir: string): Promise<void> {
    this.#release = await gpuLock({ log: (line) => console.log(line) });
    this.#server = await stillServer(projectDir);
    const mac = platform() === "darwin";
    const args = mac ? ["--use-angle=metal", "--enable-gpu", "--ignore-gpu-blocklist"] : [];
    const { chromium } = await import("@playwright/test");
    this.#browser = await chromium.launch({ args });
    this.#page = await this.#browser.newPage({ deviceScaleFactor: 1 });
  }

  async render(job: StillRenderJob): Promise<Uint8Array> {
    const page = this.#page;
    if (page === null || this.#server === null) throw new Error("the renderer is not open");
    await page.setViewportSize({ width: job.width * STILL_SCALE, height: job.height * STILL_SCALE });
    const query = new URLSearchParams({
      project: "project",
      mode: job.mode,
      asset: job.id,
      file: job.input,
      width: String(job.width),
      height: String(job.height),
    });
    await page.goto(`${this.#server.origin}/still.html?${query.toString()}`);
    await page.locator("#still[data-ready], #still[data-error]").waitFor({ timeout: 60_000 });
    const error = await page.locator("#still").getAttribute("data-error");
    if (error !== null) throw new Error(error);
    const data = await page.evaluate(async (quality) => {
      const api = globalThis.__scenityStill;
      if (api === undefined) throw new Error("the still page has no script API");
      return api.capture(quality);
    }, STILL_QUALITY);
    return new Uint8Array(Buffer.from(data, "base64"));
  }

  async close(): Promise<void> {
    await this.#browser?.close();
    this.#server?.stop();
    this.#release?.();
    this.#browser = null;
    this.#page = null;
    this.#server = null;
    this.#release = null;
  }
}

/** Run the command with its arguments. Gives the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const plain = argv.filter((arg) => !arg.startsWith("--"));
  const [dir, ...ids] = plain;
  if (dir === undefined) {
    console.error("usage: bun apps/editor/scripts/stills/assetStills.ts <projectDir> [id ...] [--force] [--check]");
    return 2;
  }
  const projectDir = resolve(dir);
  if (argv.includes("--check")) {
    const plan = await planStills(projectDir, { renderer: rendererVersion() });
    const open = plan.jobs.filter((job) => job.status !== "current");
    for (const job of open) console.log(`${job.id} ${job.kind}: ${job.status}, ${job.reason ?? ""}`);
    console.log(`${String(plan.jobs.length - open.length)} of ${String(plan.jobs.length)} stills current`);
    return open.length > 0 ? 1 : 0;
  }
  const started = performance.now();
  const report = await makeStills(projectDir, new BrowserStillRenderer(), {
    ...(ids.length > 0 ? { ids } : {}),
    force: argv.includes("--force"),
    log: (line) => console.log(line),
  });
  for (const path of report.removed) console.log(`removed ${path}`);
  for (const { id, reason } of report.failed) console.error(`FAILED ${id}: ${reason}`);
  const seconds = ((performance.now() - started) / 1000).toFixed(1);
  const drawn = new Set(report.made);
  const current = report.plan.jobs.filter((job) => job.status === "current" && !drawn.has(job.id)).length;
  console.log(
    `stills: ${String(report.made.length)} drawn, ${String(current)} current, ${String(report.failed.length)} failed (${seconds} s)`,
  );
  return report.failed.length > 0 ? 1 : 0;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
