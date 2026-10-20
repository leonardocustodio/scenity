// SPDX-License-Identifier: Apache-2.0
// The texts of the scene page in the pseudo-locale. With `locale=pseudo` the page opens in the edit mode, and the spec
// opens each part: the file bar, the play bar, the gizmo bar, the viewport menus,
// the hierarchy and its context menu, the inspector of an entity, the layout tools, each tab of the dock (assets,
// sequence, rules, settings, material), a proposal card, a notice of the scenes, the draft notice and the start
// screen. In each state, each visible text must be pseudo-localized. The rule is in tests/support/pseudoText.ts: data
// values are in `translate="no"` elements. The spec reads the samples of the repository and never saves.
// Run it alone under the GPU lock:
//   bunx --bun playwright test scene-pseudo --project=chromium --workers=1
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";
import { plainTexts } from "../support/pseudoText";

const READY = { timeout: 60_000 };
const PICKUP = "project=characters&scene=scenes/pickup.scene.json&sequence=sequences/pickup.sequence.json&paused=1";
const MATERIALS = "project=gltf-samples&scene=scenes/materials.scene.json&camera=front";
/** The standard material of the gltf-samples project (the asset that scene-materials.spec.ts opens). */
const STANDARD = "01M51H7Y9ZE026AZ1AQJ288Y3V";

test.describe.configure({ mode: "serial", timeout: 180_000 });

let origin = "";
let server: SpecServer | null = null;

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  server = await startSpecServer({
    characters: join(LABS_ROOT, "../../samples/characters"),
    "gltf-samples": join(LABS_ROOT, "../../samples/gltf-samples"),
    showroom: join(LABS_ROOT, "../../samples/showroom"),
  });
  origin = server.origin;
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
});

/** Open a scene in the edit mode with the pseudo-locale and wait for the first frame and each part of the mode. */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${origin}/scene.html?${query}&edit=1&locale=pseudo`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  for (const mark of ["data-hierarchy", "data-inspector", "data-gizmo"]) await expect(view).toHaveAttribute(mark, "1");
  await expect(page.getByTestId("scene-assets")).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("lang", "en-XA");
}

/** Expect that each visible text of the page is pseudo-localized; `state` names the state in the message. */
async function expectPseudo(page: Page, state: string): Promise<void> {
  // Two frames: a panel that just opened paints its texts.
  await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const found = await plainTexts(page);
  // The texts that a package gives in English go into the report as a number.
  const packageTexts = await page.locator("[data-package-text]:visible").count();
  if (packageTexts > 0)
    test.info().annotations.push({ type: "package texts", description: `${state}: ${String(packageTexts)}` });
  expect.soft(found, `texts outside the pseudo-locale (${state})`).toEqual([]);
}

test("each part of the edit mode shows pseudo texts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, PICKUP);
  await expectPseudo(page, "the start of the edit mode");

  // The hierarchy, its context menu and the inspector of an entity.
  await page.getByTestId("hierarchy-row-cup").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Cup", READY);
  await expectPseudo(page, "the inspector of an entity");
  await page.getByTestId("hierarchy-row-cup").click({ button: "right" });
  await expect(page.getByTestId("hierarchy-menu")).toBeVisible();
  await expectPseudo(page, "the context menu of the hierarchy");
  await page.keyboard.press("Escape");

  // The layout tools: the measure tool with no selection asks for two points.
  await page.evaluate(() => globalThis.__scenity?.select?.(null));
  await page.getByTestId("layout-tool-measure").click();
  await expect(page.getByTestId("scene-layout-readout")).toBeVisible();
  await expectPseudo(page, "the measure tool");
  await page.getByTestId("layout-tool-clear").click();

  // Each tab of the dock.
  const tabs = await page
    .locator('[data-testid^="dock-tab-"]')
    .evaluateAll((items) => items.map((item) => item.getAttribute("data-testid") ?? ""));
  expect(tabs.length).toBeGreaterThanOrEqual(3);
  for (const tab of tabs) {
    await page.getByTestId(tab).click();
    await expectPseudo(page, tab);
  }
  // The rules tab with the graph of a rule.
  await page.getByTestId("dock-tab-rules").click();
  const row = page.locator('[data-testid="rules-check"][data-rule="pickup.gripAtPickup"]');
  await expect(row).toHaveCount(1, READY);
  await row.click();
  await expect(page.getByTestId("rule-graph")).toBeVisible(READY);
  await expectPseudo(page, "the rule graph");
  // The Project panel with the details of an asset.
  await page.getByTestId("dock-tab-project").click();
  await page.locator('[data-testid^="asset-tile-"]').first().click();
  await expect(page.getByTestId("asset-details")).toBeVisible();
  await expectPseudo(page, "the details of an asset");

  // A proposal of Claude waits on the card of the Scene view.
  await page.getByTestId("dock-tab-scene.view").click();
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("entity.move", { entity: "cup", x: 0.1 }, { by: "claude" }),
  );
  await expect(page.getByTestId("scene-proposal")).toHaveCount(1, READY);
  await expectPseudo(page, "the proposal card");
  await page.getByTestId("scene-proposal-reject").click();

  // A notice of the scenes: New scene asks for a path.
  await page.getByTestId("scene-tab-new").click();
  await expect(page.getByTestId("scene-input")).toBeVisible();
  await expectPseudo(page, "the new scene notice");
  await page.getByTestId("scene-input-cancel").click();

  // An edit leaves a local draft: a reload offers it in a notice.
  await page.evaluate(() => globalThis.__scenity?.apply([{ op: "set", path: "/entities/cup/name", value: "Mug" }]));
  await expect(page.getByTestId("scene-state")).not.toHaveText("saved");
  await open(page, PICKUP);
  await expect(page.getByTestId("scene-notice")).toBeVisible(READY);
  await expectPseudo(page, "the draft notice");
});

test("the material tab shows pseudo texts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, MATERIALS);
  await page.getByTestId(`asset-tile-${STANDARD}`).click();
  await page.getByTestId("asset-edit-material").click();
  await expect(page.getByTestId("material-panel")).toHaveAttribute("data-material", `asset:${STANDARD}`, READY);
  await expectPseudo(page, "the material tab");
});

test("the start screen shows pseudo texts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=showroom&edit=1&locale=pseudo`);
  await expect(page.getByTestId("start-scenes")).toBeVisible(READY);
  await expectPseudo(page, "the start screen");
});

test("without locale the page shows the en-US texts", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=showroom&scene=scenes/main.scene.json&camera=front&edit=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.locator("html")).toHaveAttribute("lang", "en-US");
  await expect(page.getByTestId("scene-save")).toHaveText("Save");
});
