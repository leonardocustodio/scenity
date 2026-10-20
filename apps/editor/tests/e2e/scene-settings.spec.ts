// SPDX-License-Identifier: Apache-2.0
// The editor settings and the key map of the scene page: a changed key works after a reload. The spec copies the
// showroom to a temp folder and opens it in the edit mode with no file watch. In the settings tab of the dock, it gives
// "frame the selection" the key G in place of F, and the grid snap 0.05 m. After a reload, G frames the selected
// armchair and F does nothing. The gizmos snap to 0.05 m, and the project file `scenity.editor.json` of the copy holds
// the snap. The key map of the user is in the browser storage. The files of the repository never change. Run it alone
// under the GPU lock:
//   bunx --bun playwright test scene-settings --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ViewportInfo } from "../../src/scene/viewport/viewportTypes";
import { LABS_ROOT } from "./builds";
import { ON_STUDIO, startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 60_000 };
const ENTITY = "armchair";

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 150_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-settings-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ settings: dir });
  origin = server.origin;
  key = server.keys.settings ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy in the edit mode and wait for the frame, the gizmos, the viewport and the project settings. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&scene=scenes/main.scene.json&camera=front&edit=1`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-gizmo", "1", READY);
  await expect(view).toHaveAttribute("data-viewport", "1", READY);
  await expect(view).toHaveAttribute("data-settings", "1", READY);
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.editorSettings?.().loaded)).toBe(true);
  await page.evaluate(() => globalThis.__scenity?.frame());
}

function viewport(page: Page): Promise<ViewportInfo> {
  return page.evaluate(() => {
    const info = globalThis.__scenity?.viewport?.();
    if (info === undefined) throw new Error("no viewport");
    return info;
  });
}

/** The grid snap of the gizmos now (m). */
function gizmoGrid(page: Page): Promise<number | undefined> {
  return page.evaluate(() => globalThis.__scenity?.gizmo?.().settings.snaps.grid);
}

test("the theme and the contrast change at once and hold after a reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "dark");
  await page.getByTestId("dock-tab-preferences").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toHaveAttribute("data-loaded", "1");
  // The key map has the commands of the theme (the search box shows them too).
  for (const id of ["theme.dark", "theme.light", "theme.navy", "theme.contrast"])
    await expect(page.getByTestId(`key-row-${id}`)).toHaveCount(1);
  await page.getByTestId("settings-theme").selectOption("light");
  await page.getByTestId("settings-contrast").check();
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
  await page.reload();
  await open(page);
  await expect(page.locator("body")).toHaveAttribute("data-theme", "light");
  await expect(page.locator("html")).toHaveAttribute("data-contrast", "more");
  await page.evaluate(() => localStorage.removeItem("scenity.studio.theme"));
});

test("a changed key and a changed grid snap hold after a reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  expect(await gizmoGrid(page)).toBe(0.01);
  await page.getByTestId("dock-tab-preferences").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toBeVisible();
  await expect(panel).toHaveAttribute("data-loaded", "1");
  // The key map lists the commands of the page with their default keys.
  await expect(page.getByTestId("key-row-view.frame")).toHaveAttribute("data-keys", "F");
  await expect(page.getByTestId("key-row-file.save")).toHaveAttribute("data-keys", "Mod+S");
  await expect(page.getByTestId("key-row-entity.delete")).toHaveAttribute("data-keys", "Delete Backspace");
  await expect(page.getByTestId("keymap-conflicts")).toHaveCount(0);
  // F to G: a key press while the capture waits.
  await page.getByTestId("key-change-view.frame").click();
  await expect(page.getByTestId("keymap-capture")).toBeVisible();
  await page.keyboard.press("g");
  await expect(page.getByTestId("key-row-view.frame")).toHaveAttribute("data-keys", "G");
  // The grid snap goes to the project file of the copy.
  const grid = page.getByTestId("setting-snaps.grid");
  await grid.fill("0.05");
  await grid.press("Enter");
  await expect(page.getByTestId("setting-source-snaps.grid")).toHaveAttribute("data-source", "project");
  const file = join(dir, "scenity.editor.json");
  await expect.poll(() => (existsSync(file) ? readFileSync(file, "utf8") : "")).toContain('"grid": 0.05');
  expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ format: "scenity.editor/1", snaps: { grid: 0.05 } });
  expect(await gizmoGrid(page)).toBe(0.05);
  // A picture of the tab for the owner (test-results).
  await page.screenshot({ path: test.info().outputPath("settings.png") });

  await page.reload();
  await open(page);
  expect(await gizmoGrid(page)).toBe(0.05);
  expect(await page.evaluate(() => globalThis.__scenity?.editorSettings?.().settings.snaps.grid)).toBe(0.05);
  // The dock opens on the settings tab again: the layout of the project keeps the tab.
  await expect(page.getByTestId("settings-panel")).toBeVisible();
  await expect(page.getByTestId("key-row-view.frame")).toHaveAttribute("data-keys", "G");
  await expect(page.getByTestId("setting-snaps.grid")).toHaveValue("0.05");

  // F does nothing now; G frames the selected armchair with the editor camera.
  await page.evaluate((id) => globalThis.__scenity?.select?.([id]), ENTITY);
  await page.locator("body").focus();
  expect((await viewport(page)).camera).toBe("front");
  await page.keyboard.press("f");
  await page.evaluate(() => globalThis.__scenity?.frame());
  await page.waitForTimeout(300);
  expect((await viewport(page)).camera).toBe("front");
  await page.keyboard.press("g");
  await expect.poll(async () => (await viewport(page)).camera).toBe("editor");
  await page.evaluate(() => globalThis.__scenity?.frame());
  const info = await viewport(page);
  const bounds = await page.evaluate(
    (id) =>
      globalThis.__scenity
        ?.inspect?.()
        .then((made) => made?.entities.find((entity) => entity.id === id)?.bounds ?? null),
    ENTITY,
  );
  expect(bounds).not.toBeNull();
  const min = bounds?.min ?? [];
  const max = bounds?.max ?? [];
  for (const axis of [0, 1, 2]) {
    expect(info.target?.[axis]).toBeCloseTo(((min[axis] ?? 0) + (max[axis] ?? 0)) / 2, 3);
  }
  // The key map of the user is in the browser storage, not in a file of the project.
  const stored = await page.evaluate(() => globalThis.localStorage.getItem("scenity.keymap.user"));
  expect(JSON.parse(stored ?? "{}")).toEqual({ format: "scenity.keymap/1", keys: { "view.frame": ["G"] } });
  expect(readFileSync(file, "utf8")).not.toContain("view.frame");
});

test("Preferences shows the settings in groups with a search, and names the host values", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.getByTestId("dock-tab-preferences").click();
  const panel = page.getByTestId("settings-panel");
  await expect(panel).toHaveAttribute("data-loaded", "1");
  for (const group of ["snaps", "view", "camera", "dock", "recent", "render"])
    await expect(panel.getByTestId(`settings-group-${group}`)).toBeVisible();
  // In the studio the values of the host show; outside it a note says where they are.
  await expect(panel.getByTestId(ON_STUDIO ? "settings-host" : "settings-host-none")).toBeVisible();
  await panel.getByTestId("settings-search").fill("speed");
  await expect(panel.getByTestId("setting-row-camera.flySpeed")).toBeVisible();
  await expect(panel.getByTestId("setting-row-snaps.grid")).toHaveCount(0);
  await expect(panel.getByTestId("settings-theme")).toHaveCount(0);
  await expect(panel.getByTestId("settings-host")).toHaveCount(0);
  await panel.getByTestId("settings-search").fill("contrast");
  await expect(panel.getByTestId("settings-contrast")).toBeVisible();
  await panel.getByTestId("settings-search").fill("");
  await expect(panel.getByTestId("setting-row-snaps.grid")).toBeVisible();
});

/** The keys of a command in the key map of the page. */
function keysOf(page: Page, id: string): Promise<readonly string[] | undefined> {
  return page.evaluate(
    (command) => globalThis.__scenity?.keymap?.().commands.find((item) => item.id === command)?.keys,
    id,
  );
}

test("a person changes a key on the keyboard picture; clashes, import and export", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.shortcuts"));
  const panel = page.getByTestId("shortcuts");
  await expect(panel.getByTestId("key-F")).toHaveAttribute("data-bound", /[1-9]/);
  // Pick a command, then press a key on the picture.
  await panel.getByTestId("shortcuts-search").fill("frame");
  await panel.getByTestId("shortcuts-command-view.frame").click();
  await panel.getByTestId("key-J").click();
  await expect.poll(() => keysOf(page, "view.frame")).toEqual(["J"]);
  await expect(panel.getByTestId("shortcuts-note")).toContainText("view.frame");
  // A press with no picked command shows the commands of the key. Remove deletes the key.
  await panel.getByTestId("key-J").click();
  await panel.getByTestId("shortcuts-key-commands").getByTestId("shortcuts-remove-view.frame").click();
  await expect.poll(() => keysOf(page, "view.frame")).toEqual([]);
  // The key of another command of the same context gives a clash.
  const other = await page.evaluate(() => {
    const map = globalThis.__scenity?.keymap?.();
    const frame = map?.commands.find((item) => item.id === "view.frame");
    return map?.commands.find(
      (item) =>
        item.id !== "view.frame" && item.context === frame?.context && item.keys.some((key) => /^[A-Z]$/.test(key)),
    );
  });
  const key = other?.keys.find((item) => /^[A-Z]$/.test(item)) ?? "";
  expect(key).not.toBe("");
  await panel.getByTestId("shortcuts-search").fill("frame");
  await panel.getByTestId("shortcuts-command-view.frame").click();
  await panel.getByTestId(`key-${key}`).click();
  await expect(panel.getByTestId(`key-${key}`)).toHaveAttribute("data-clash", "1");
  await expect(panel.getByTestId("shortcuts-clashes")).toContainText("view.frame");
  // Reset all gives the default keys again.
  await panel.getByTestId("shortcuts-reset").click();
  await expect.poll(() => keysOf(page, "view.frame")).toEqual(["F"]);
  await expect(panel.getByTestId(`key-${key}`)).toHaveAttribute("data-clash", "0");
  // Import a key map file, then export it again.
  await panel.getByTestId("shortcuts-import").setInputFiles({
    name: "keys.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify({ format: "scenity.keymap/1", keys: { "view.frame": ["K"] } })),
  });
  await expect.poll(() => keysOf(page, "view.frame")).toEqual(["K"]);
  const [download] = await Promise.all([page.waitForEvent("download"), panel.getByTestId("shortcuts-export").click()]);
  const path = await download.path();
  expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ format: "scenity.keymap/1", keys: { "view.frame": ["K"] } });
});

test("the tour shows six steps over the panels and comes back from Help", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // Under automation the tour does not start by itself.
  await expect(page.getByTestId("tour")).toHaveCount(0);
  await page.evaluate(() => globalThis.__scenity?.command?.("help.tour"));
  const tour = page.getByTestId("tour");
  const steps = ["view", "hierarchy", "inspector", "project", "timeline", "search"];
  for (const [index, step] of steps.entries()) {
    await expect(tour).toHaveAttribute("data-step", step);
    await expect(page.locator("[data-tour-target]"), step).toHaveCount(1);
    await expect(tour).toContainText(`Step ${String(index + 1)} of 6`);
    await tour.getByTestId("tour-next").click();
  }
  await expect(tour).toHaveCount(0);
  expect(await page.evaluate(() => localStorage.getItem("scenity.tour.done"))).toBe("1");
  // Skip ends it at once.
  await page.evaluate(() => globalThis.__scenity?.command?.("help.tour"));
  await page.getByTestId("tour-skip").click();
  await expect(page.getByTestId("tour")).toHaveCount(0);
});
