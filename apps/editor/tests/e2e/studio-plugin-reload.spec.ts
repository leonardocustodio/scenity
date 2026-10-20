// SPDX-License-Identifier: Apache-2.0
// The hot reload of a studio face. The spec copies the spin sample, starts the dev server of the scene page with the
// file watch enabled, and opens the editor. An edit of the studio face of the demo plugin (a new command) installs the
// faces again with no reload of the window. The new command is there, and each earlier command is there once. The
// panel of the plugin works, and a value of the page stays. The files of the repository never change.
//   bunx --bun playwright test studio-plugin-reload --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SPIN = join(LABS_ROOT, "../../samples/spin");
const READY = { timeout: 120_000 };

test.use({ viewport: { width: 1600, height: 1000 } });
test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-plugin-reload-"));
  cpSync(SPIN, dir, { recursive: true, filter: (path) => !path.includes("node_modules") && !path.endsWith("/dist") });
  server = await startSpecServer(
    { spin: dir },
    // The spec edits a studio face: the dev server watches the files.
    { SCENITY_SCENE_NO_WATCH: "0" },
  );
  origin = server.origin;
  key = server.keys.spin ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

test("an edit of a studio face installs the faces again with no reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/spin.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const commands = (): Promise<string[]> =>
    page.evaluate(() =>
      (globalThis.__scenity as unknown as { commands(): { id: string }[] }).commands().map((each) => each.id),
    );
  await expect.poll(async () => (await commands()).includes("demo.selectSpinners"), READY).toBe(true);
  await page.evaluate(() => {
    (globalThis as unknown as { keep: number }).keep = 1;
  });
  // The edit: a second command in the studio face.
  const file = join(dir, "plugins/demo/src/studio.ts");
  const text = readFileSync(file, "utf8");
  const marker = "    commands: [\n";
  expect(text).toContain(marker);
  writeFileSync(
    file,
    text.replace(
      marker,
      `${marker}      { id: "demo.reloaded", title: "demo-select-spinners", run: (ctx) => ctx.selection.set([]) },\n`,
    ),
  );
  await expect.poll(async () => (await commands()).includes("demo.reloaded"), READY).toBe(true);
  const ids = await commands();
  expect(ids.filter((id) => id === "demo.selectSpinners")).toHaveLength(1);
  expect(await page.evaluate(() => (globalThis as unknown as { keep?: number }).keep)).toBe(1);
  // The panel of the plugin works after the install.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.demo.spinners"));
  await expect(page.locator('.studio-panel[data-panel="demo.spinners"]')).toBeVisible();
  await expect(page.getByTestId("contribution-error")).toHaveCount(0);
  expect(errors).toEqual([]);
});
