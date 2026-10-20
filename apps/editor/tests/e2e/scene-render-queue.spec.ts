// SPDX-License-Identifier: Apache-2.0
// The render queue: the queue makes a clip of the walkthrough with no terminal. The spec copies the walkthrough sample
// (its build too) into a temp folder and starts the dev server of the scene page on it. The runs of the queue take a
// GPU lock of their own (this spec holds the lock of the tests).
// Run it alone under the GPU lock:
//   bunx --bun playwright test scene-render-queue --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 300_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-render-queue-"));
  for (const part of ["assets", "build", "dist", "posters", "rights", "scenes", "sequences", "scenity.project.json"]) {
    cpSync(join(WALKTHROUGH, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ walk: dir }, { SCENITY_BENCH_LOCK: join(dir, ".scenity/render.lock") });
  origin = server.origin;
  key = server.keys.walk ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("a clip of the walkthrough comes out with no terminal", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/plaza.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.renderQueue"));
  const panel = page.getByTestId("render-panel");
  await expect(panel.getByTestId("render-sequence")).toHaveValue("sequences/meet.sequence.json");
  await panel.getByTestId("render-camera").fill("front");
  await panel.getByTestId("render-from").fill("0");
  await panel.getByTestId("render-to").fill("500");
  await panel.getByTestId("render-fps").fill("6");
  await panel.getByTestId("render-size").fill("320x200");
  await panel.getByTestId("render-add").click();
  const item = panel.getByTestId("render-item").first();
  await expect(item).toHaveAttribute("data-state", /running|waiting/);
  await expect(item).toHaveAttribute("data-state", "done", { timeout: 240_000 });
  const output = panel.getByTestId("render-output").first();
  await expect(output.locator("video")).toHaveCount(1);
  const file = (await output.getAttribute("data-file")) ?? "";
  expect(file).toMatch(/^test-results\/renders\/meet-clip-\d+@0-500\.webm$/);
  expect(existsSync(join(dir, file))).toBe(true);
  // A WebM file starts with the EBML magic number.
  expect(readFileSync(join(dir, file)).readUInt32BE(0)).toBe(0x1a45dfa3);
});
