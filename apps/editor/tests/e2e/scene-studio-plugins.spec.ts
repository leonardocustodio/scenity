// SPDX-License-Identifier: Apache-2.0
// The studio face of a plugin: the spin sample plugin adds a panel through its studio face. The spec starts the dev
// server of the scene page on a copy of the spin sample (the project settings of the demo plugin write a file of the
// project). The panel "Spinners" of the demo plugin lists the entities with `demo.spin`. Its Select and its command
// change the selection. Safe mode loads no studio face. The importer of the host face imports a `.pattern` file. Run
// it alone under the GPU lock:
//   bunx --bun playwright test scene-studio-plugins --project=chromium --workers=1
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { startSpecServer, type SpecServer } from "./specServer";
import { copySpin } from "./spinCopy";

const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 180_000 });

let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

let dir = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = copySpin("scenity-studio-plugins-");
  // The copy gets an asset folder, so the Project panel can import (the asset source of the demo plugin).
  const projectFile = join(dir, "scenity.project.json");
  const project = JSON.parse(readFileSync(projectFile, "utf8")) as Record<string, unknown>;
  writeFileSync(projectFile, JSON.stringify({ ...project, assets: ["assets"] }, null, 2));
  mkdirSync(join(dir, "assets"), { recursive: true });
  server = await startSpecServer(
    { spin: dir },
    // The built-in source answers nothing: the spec uses the source of the demo plugin only.
    { SCENITY_POLYHAVEN_API: "http://127.0.0.1:9" },
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

async function open(page: Page, extra = ""): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&edit=1&scene=scenes/spin.scene.json${extra}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
}

const selection = (page: Page) => page.evaluate(() => globalThis.__scenity?.selection?.() ?? []);

test("the demo plugin adds the panel Spinners and a command through its studio face", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The studio faces load after the start of the window: open the panel until it is there.
  const panel = page.getByTestId("demo-spinners");
  await expect
    .poll(async () => {
      // The command is not there before the face loads: the call throws then.
      await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.demo.spinners")).catch(() => null);
      return panel.isVisible();
    }, READY)
    .toBe(true);
  await expect(panel.locator("[data-entity]")).toHaveCount(2);
  await expect(panel.locator("[data-entity=spinner]")).toContainText("deg/s");
  await panel.getByTestId("demo-select-slow-spinner").click();
  await expect.poll(() => selection(page)).toEqual(["slow-spinner"]);
  await page.evaluate(() => globalThis.__scenity?.command?.("demo.selectSpinners"));
  await expect.poll(async () => [...(await selection(page))].sort()).toEqual(["slow-spinner", "spinner"]);
});

test("safe mode loads no studio face", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "&safe=1");
  await page.waitForTimeout(2000);
  // The face did not load: the window has no command of its panel.
  await expect(page.evaluate(() => globalThis.__scenity?.command?.("panel.open.demo.spinners"))).rejects.toThrow(
    'No command "panel.open.demo.spinners"',
  );
  await expect(page.getByTestId("demo-spinners")).toHaveCount(0);
});

test("the points of the demo face: the widget, the preset, the overlay, the status item and Problems", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The overlay and the status item show when the face has loaded.
  await expect(page.getByTestId("demo-readout")).toContainText("2 spinners", READY);
  await expect(page.getByTestId("status-demo.count")).toContainText("2 spinners");
  // The widget of the speed of the spinner in the inspector: a change is one edit.
  await page.evaluate(() => globalThis.__scenity?.select?.(["spinner"]));
  const dial = page.getByTestId("demo-speed-range");
  await expect(dial).toBeVisible(READY);
  await dial.evaluate((input: HTMLInputElement) => {
    input.value = "500";
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  const speed = () =>
    page.evaluate(
      () =>
        (globalThis.__scenity?.document().entities.spinner?.components["demo.spin"] as { speed?: number } | undefined)
          ?.speed,
    );
  await expect.poll(speed).toBe(500);
  // The problem source of the plugin names the fast spinner.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.problems"));
  await expect(page.getByTestId("problem-title").filter({ hasText: "turns at 500 deg/s" })).toBeVisible(READY);
  // The create preset: a new spinner, and the overlay and the status item count it.
  await page.evaluate(() => globalThis.__scenity?.command?.("entity.create.demo.spinner"));
  await expect(page.getByTestId("demo-readout")).toContainText("3 spinners");
  await expect(page.getByTestId("status-demo.count")).toContainText("3 spinners");
  // The status item runs the command of the plugin: each spinner is selected.
  await page.getByTestId("status-demo.count").click();
  await expect.poll(async () => (await selection(page)).length).toBe(3);
});

test("the toolbar button, the scene tool and the settings of the demo face", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The toolbar button runs the command of the plugin.
  const button = page.getByTestId("toolbar-demo.selectAll");
  await expect(button).toBeVisible(READY);
  await button.click();
  await expect.poll(async () => [...(await selection(page))].sort()).toEqual(["slow-spinner", "spinner"]);
  // The scene tool takes the presses on the Scene view while it is active. Escape stops it.
  const tool = page.getByTestId("toolbar-demo.countClicks");
  await tool.click();
  await expect(tool).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("scene-view").dispatchEvent("pointerdown", { clientX: 40, clientY: 40 });
  await expect(page.getByTestId("studio-toast").filter({ hasText: "1 clicks on the Scene view." })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tool).toHaveAttribute("aria-pressed", "false");
  // The project settings of the plugin in Project settings: a lower speed of the warning gives problems for both
  // spinners, and the value goes to the file of the project.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.projectSettings"));
  const section = page.getByTestId("settings-plugin-demo");
  await expect(section).toBeVisible(READY);
  await section.getByTestId("project-add-fast").click();
  await section.getByTestId("project-input-fast").fill("10");
  await section.getByTestId("project-input-fast").press("Tab");
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.problems"));
  await expect(page.getByTestId("problem-title").filter({ hasText: "more than 10 deg/s" })).toHaveCount(2, READY);
  const file = join(dir, ".scenity/plugin-settings.json");
  await expect
    .poll(() => existsSync(file) && (JSON.parse(readFileSync(file, "utf8")) as { demo?: unknown }).demo)
    .toEqual({
      fast: 10,
    });
});

test("a scene tool with handles: a drag of the handle of a spinner moves it as one step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const tool = page.getByTestId("toolbar-demo.placeSpinners");
  await expect(tool).toBeVisible(READY);
  await tool.click();
  await expect(page.getByTestId("tool-handle")).toHaveCount(2);
  const handle = page.locator('[data-testid="tool-handle"][data-handle="spinner"]');
  await expect(handle).toHaveAttribute("aria-label", "Move Spinner");
  const place = () =>
    page.evaluate(
      () =>
        (globalThis.__scenity?.document().entities.spinner?.components.transform as { position?: number[] } | undefined)
          ?.position,
    );
  const before = await place();
  const box = await handle.boundingBox();
  if (box === null) throw new Error("the handle has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 80, box.y + 50, { steps: 6 });
  await page.mouse.up();
  // The spinner moves on its level: x and z change, y stays.
  await expect.poll(async () => (await place())?.[0]).not.toBe(before?.[0]);
  const after = await place();
  expect(after?.[1]).toBeCloseTo(before?.[1] ?? 0, 5);
  // The move is one step of the history.
  await page.evaluate(() => globalThis.__scenity?.command?.("history.undo"));
  await expect.poll(place).toEqual(before);
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("tool-handle")).toHaveCount(0);
});

test("an item of the demo face in the context menu of a hierarchy row", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.getByTestId("hierarchy-row-pedestal").click({ button: "right" });
  const item = page.getByTestId("hierarchy-menu").getByTestId("hierarchy-menu-plugin:demo.makeSpinner");
  await expect(item).toHaveText("Make it a spinner");
  await item.click();
  await expect
    .poll(() => page.evaluate(() => Object.keys(globalThis.__scenity?.document().entities.pedestal?.components ?? {})))
    .toContain("demo.spin");
  await page.evaluate(() => globalThis.__scenity?.undo());
});

test("a command of the demo face has its docs link in the search box", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await expect
    .poll(() =>
      page.evaluate(() =>
        (globalThis.__scenity as unknown as { commands(): { id: string }[] })
          .commands()
          .some((each) => each.id === "demo.selectSpinners"),
      ),
    )
    .toBe(true);
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type(">select the spinners");
  const row = page.locator('[data-testid="search-row"][data-item="demo.selectSpinners"]');
  await expect(row.getByTestId("search-row-docs")).toHaveAttribute("href", /docs\/plugins\.md#the-studio-face$/);
});

test("the asset source of the host face of the demo plugin imports a pattern with its rights", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const browser = page.getByTestId("asset-browser");
  await expect(browser).not.toHaveAttribute("data-count", "-1", READY);
  const before = Number(await browser.getAttribute("data-count"));
  await page.getByTestId("asset-get").click();
  await page.getByTestId("sources-provider").click();
  await page.getByRole("option", { name: "Demo patterns" }).click();
  await page.getByTestId("sources-kind-texture").click();
  const item = page.getByTestId("sources-item-checker");
  await item.click();
  await expect
    .poll(() => item.locator("img").evaluate((image) => (image as HTMLImageElement).naturalWidth), READY)
    .toBeGreaterThan(0);
  await page.getByTestId("sources-import").click();
  await expect(browser).toHaveAttribute("data-count", String(before + 1), READY);
  const record = JSON.parse(
    readFileSync(join(dir, "assets/sources/demo-patterns/checker/checker.png.meta.json"), "utf8"),
  ) as { kind: string; rights: string };
  expect(record).toMatchObject({ kind: "texture", rights: "../../../../rights/demo-patterns.yaml" });
  expect(readFileSync(join(dir, "rights/demo-patterns.yaml"), "utf8")).toContain("CC0-1.0");
});

test("an importer of the host face of the demo plugin imports a .pattern file as a demo.pattern asset", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const browser = page.getByTestId("asset-browser");
  await expect(browser).not.toHaveAttribute("data-count", "-1", READY);
  const before = Number(await browser.getAttribute("data-count"));
  const pattern = { colours: ["#ff8800", "#0088ff"], size: 8 };
  await page.getByTestId("asset-import-input").setInputFiles({
    name: "rings.pattern",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(pattern)),
  });
  // The rights record of the patterns of the plugin (CC0, from the asset source test), so the project still publishes.
  const dialog = page.getByTestId("asset-import-dialog");
  await dialog.getByTestId("import-rights").click();
  await page.getByRole("option", { name: /^demo-patterns/ }).click();
  await dialog.getByTestId("import-start").click();
  await expect(browser).toHaveAttribute("data-count", String(before + 1), READY);
  const record = JSON.parse(readFileSync(join(dir, "assets/sources/rings.pattern.meta.json"), "utf8")) as {
    id: string;
  };
  expect(record).toMatchObject({
    kind: "demo.pattern",
    importer: "demo.pattern",
    rights: "../../rights/demo-patterns.yaml",
  });
  const imported = JSON.parse(readFileSync(join(dir, ".scenity/imports", record.id, "pattern.json"), "utf8")) as {
    scale: number;
  };
  expect(imported).toMatchObject({ colours: pattern.colours, scale: 1 });
  // The asset inspector shows the asset with the preview of the kind (the `previews` point of the studio face).
  const tile = page.getByTestId(`asset-tile-${record.id}`);
  if ((await tile.getAttribute("aria-pressed")) !== "true") await tile.click();
  const details = page.getByTestId("asset-details");
  await expect(details.getByTestId("asset-preview")).toHaveAttribute("data-preview", "plugin", READY);
  await expect(details.getByTestId("demo-pattern-preview")).toContainText("rings");
});

test("a publish target of the host face of the demo plugin gets the archive", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  // A build folder of the copy: the target gets the archive of it (scene-asset-build.spec.ts tests the build itself).
  mkdirSync(join(dir, "dist"), { recursive: true });
  writeFileSync(join(dir, "dist/index.html"), "<!doctype html><title>Spin</title>\n");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.build"));
  const panel = page.getByTestId("build-panel");
  await panel.getByTestId("publish-run").click();
  await expect(panel.getByTestId("publish-result")).toHaveAttribute("data-passed", "1", { timeout: 120_000 });
  await panel.getByTestId("publish-send-demo.published").click();
  await expect(panel.getByTestId("publish-sent")).toContainText("Copied to published/", READY);
  const zip = readdirSync(join(dir, "published")).find((name) => name.endsWith(".zip"));
  expect(zip).toBeDefined();
});
