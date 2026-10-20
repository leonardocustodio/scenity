// SPDX-License-Identifier: Apache-2.0
/**
 * The end-to-end run of a new project. `scenity create demo --install` makes a project in a temp folder outside the
 * checkout (the links of Bun: `bun link` in the package folders, then `bun install`). `scenity dev` runs in `demo`
 * (the bin of `node_modules/.bin`), and the scene page with the editor loads the new scene in headless Chromium
 * (`data-ready="1"` on the canvas). `scenity build` and `scenity check` pass on the project. Then the browser commands
 * run: `scenity sheet` on the new project and `scenity clip` on the walk of the characters sample.
 *
 * The tests run only with `SCENITY_GPU_TESTS=1` and a Chromium of Playwright, because a shared machine runs one GPU
 * test at a time (the caller takes the GPU lock of the machine). The link folder of Bun is a temp folder
 * (`BUN_INSTALL_GLOBAL_DIR`), so the run does not change the links of the user.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readWebm } from "@scenity/labs-platform/webm";
import { DEV_READY } from "../src/dev/command";
import { browserPresent, launchChromium } from "../src/page/browser";

const ROOT = join(import.meta.dir, "../../..");
const CLI = join(ROOT, "packages/cli/src/cli.ts");
const gpu = process.env.SCENITY_GPU_TESTS === "1" && (await browserPresent());
const temp = mkdtempSync(join(tmpdir(), "scenity-create-dev-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const env = { ...process.env, BUN_INSTALL_GLOBAL_DIR: join(temp, "bun-links"), SCENITY_CHECKOUT: "" };
const demo = join(temp, "demo");
const bin = join(demo, "node_modules", ".bin", "scenity");

function scenity(args: readonly string[], cwd: string, command = bin) {
  const run = spawnSync(command, [...args], { cwd, env, encoding: "utf8", timeout: 600_000 });
  return { code: run.status, text: `${run.stdout}${run.stderr}` };
}

/** Start `scenity dev` in the project folder; the result has the URL of the ready line and a stop function. */
async function startDev(): Promise<{ url: string; stop: () => Promise<void> }> {
  const child = spawn(bin, ["dev"], { cwd: demo, env, stdio: ["ignore", "pipe", "pipe"] });
  let text = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`no ready line in 120 s:\n${text}`)), 120_000);
    const read = (chunk: Buffer) => {
      text += chunk.toString();
      const line = text.split("\n").find((item) => item.startsWith(`${DEV_READY} `));
      if (line === undefined) return;
      clearTimeout(timer);
      resolve((JSON.parse(line.slice(DEV_READY.length + 1)) as { url: string }).url);
    };
    child.stdout.on("data", read);
    child.stderr.on("data", read);
    child.on("exit", (code) => reject(new Error(`scenity dev ended with ${String(code)}:\n${text}`)));
  });
  const stop = () =>
    new Promise<void>((resolve) => {
      child.once("exit", () => resolve());
      child.kill("SIGTERM");
    });
  return { url, stop };
}

describe("scenity create, then scenity dev in the new project", () => {
  test.skipIf(!gpu)(
    "create --install links the packages outside the checkout",
    () => {
      const made = scenity(["create", "demo", "--install"], temp, CLI);
      expect(made.code, made.text).toBe(0);
      expect(existsSync(bin)).toBe(true);
      expect(existsSync(join(demo, "node_modules", "@scenity", "scene", "package.json"))).toBe(true);
    },
    300_000,
  );

  test.skipIf(!gpu)(
    "scenity dev serves the editor page, and the page draws the empty scene",
    async () => {
      const dev = await startDev();
      const browser = await launchChromium();
      try {
        expect(dev.url).toMatch(/\/scene\.html\?project=demo&scene=scenes%2Fmain\.scene\.json&edit=1$/);
        const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.goto(dev.url);
        await page.waitForSelector('canvas[data-ready="1"]', { timeout: 120_000 });
        const scene = await page.evaluate(() => (globalThis as Record<string, unknown>).__scenity !== undefined);
        expect(scene).toBe(true);
        expect(errors).toEqual([]);
      } finally {
        await browser.close();
        await dev.stop();
      }
    },
    300_000,
  );

  test.skipIf(!gpu)(
    "scenity build and scenity check pass on the new project",
    () => {
      const build = scenity(["build"], demo);
      expect(build.code, build.text).toBe(0);
      expect(existsSync(join(demo, "dist", "index.html"))).toBe(true);
      const check = scenity(["check"], demo);
      expect(check.code, check.text).toBe(0);
      expect(check.text).toContain("boxNearCentre");
    },
    600_000,
  );
});

describe("scenity sheet and scenity clip in the player", () => {
  test.skipIf(!gpu)(
    "a sheet of the new project: one cell of the front camera",
    () => {
      const out = join(temp, "demo-sheet.png");
      const sheet = scenity(["sheet", "--camera", "front", "--out", out], demo);
      expect(sheet.code, sheet.text).toBe(0);
      const png = readFileSync(out);
      expect(png.subarray(1, 4).toString()).toBe("PNG");
      // One cell of 400 × 250 px with the gaps and the label row.
      expect(png.readUInt32BE(16)).toBe(408);
    },
    600_000,
  );

  test.skipIf(!gpu)(
    "a clip of the walk of the characters sample is a WebM file with a frame per time",
    () => {
      const out = join(temp, "walk.webm");
      const dist = join(temp, "characters-dist");
      const args = ["clip", join(ROOT, "samples/characters"), "--sequence", "sequences/walk-wave.sequence.json"];
      const clip = scenity(
        [...args, "--from", "0", "--to", "1000", "--fps", "6", "--out", out, "--dist", dist],
        ROOT,
        CLI,
      );
      expect(clip.code, clip.text).toBe(0);
      const summary = readWebm(new Uint8Array(readFileSync(out)));
      expect(summary.docType).toBe("webm");
      expect(["V_VP9", "V_VP8"]).toContain(summary.codec);
      expect([summary.width, summary.height]).toEqual([640, 400]);
      expect(summary.blocks).toHaveLength(7);
    },
    600_000,
  );
});
