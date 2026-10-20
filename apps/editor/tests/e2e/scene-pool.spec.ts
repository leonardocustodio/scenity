// SPDX-License-Identifier: Apache-2.0
// The scene pool in Preferences → Advanced: the pool state shows and changes from the UI. The spec starts a dev server
// with a pool folder of its own (no other pool sees it) and a GPU lock of its own (this spec holds the lock of the
// tests). Run it alone under the GPU lock:
//   bunx --bun playwright test scene-pool --project=chromium --workers=1
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const WALKTHROUGH = join(LABS_ROOT, "../../samples/walkthrough");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-pool-"));
  server = await startSpecServer(
    { walk: WALKTHROUGH },
    { SCENITY_SCENE_POOL_DIR: join(dir, "pool"), SCENITY_BENCH_LOCK: join(dir, "pool.lock") },
  );
  origin = server.origin;
  key = server.keys.walk ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  // Stop the pool of the spec when a step failed before the stop.
  await server
    ?.fetch("/pool.run", {
      method: "POST",
      headers: { "x-scenity-asset-import": "1", Origin: origin, "Content-Type": "application/json" },
      body: JSON.stringify({ action: "stop" }),
    })
    .catch(() => null);
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("the pool state shows and changes from Preferences", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/plaza.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.getByTestId("dock-tab-preferences").click();
  const pool = page.getByTestId("settings-pool");
  const state = pool.getByTestId("pool-state");
  await expect(state).toHaveAttribute("data-running", "0", READY);
  await expect(pool.getByTestId("pool-stop")).toBeDisabled();
  await pool.getByTestId("pool-pages").fill("1");
  await pool.getByTestId("pool-start").click();
  await expect(state).toHaveAttribute("data-running", "1", { timeout: 90_000 });
  await expect(state).toContainText("1 pages");
  await expect(pool.getByTestId("pool-start")).toBeDisabled();
  await pool.getByTestId("pool-stop").click();
  await expect(state).toHaveAttribute("data-running", "0", READY);
});
