// SPDX-License-Identifier: Apache-2.0
// The inspector of the scene page: a component of a plugin shows in the inspector with no editor code. The spec copies
// the showroom to a temp folder and lists the test plugin of tests/fixtures/inspector-plugin in its project document.
// The plugin gives one component with a zod schema. In the edit mode, a click selects an entity, and the "add
// component" menu adds the plugin component. The panel edits a number, a colour and an enum of it. ⌘Z undoes one edit,
// a drag of a number is one step, and Save and a reload keep the values. The files of the repository never change. Run
// it alone under the GPU lock:
//   bunx --bun playwright test scene-inspector --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const PLUGIN = join(LABS_ROOT, "tests/fixtures/inspector-plugin");
const SCENE = "scenes/main.scene.json";
const READY = { timeout: 60_000 };
const BEACON = "fixture.beacon";

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-inspector-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  // The copy lists the test plugin (an absolute folder): the editor has no code for its component.
  const projectFile = join(dir, "scenity.project.json");
  const project = JSON.parse(readFileSync(projectFile, "utf8")) as Record<string, unknown>;
  writeFileSync(projectFile, `${JSON.stringify({ ...project, plugins: [PLUGIN] }, null, 2)}\n`);
  server = await startSpecServer({ inspect: dir });
  origin = server.origin;
  key = server.keys.inspect ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** The main scene of the project when the query names no scene (`edit=1` with no `scene=` is the start screen). */
function mainScene(query: string): string {
  return query.includes("scene=") ? "" : "&scene=scenes/main.scene.json";
}

/** Open the copy in the edit mode and wait for the first frame with every asset and for the inspector. */
async function open(page: Page, query = ""): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1${mainScene(query)}${query}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-inspector", "1", READY);
}

/** A page point (CSS pixels) on an entity: the first point of a grid where the pick finds it. */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(async (entity) => {
    const canvas = document.querySelector("canvas");
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    // The canvas is in the Scene view panel, not at the corner of the page.
    const rect = canvas?.getBoundingClientRect();
    // The inspector panel covers a part of the canvas. A point under it does not reach the canvas.
    for (let y = height * 0.3; y < height * 0.95; y += 12) {
      for (let x = width * 0.05; x < width * 0.95; x += 12) {
        if (document.elementFromPoint((rect?.left ?? 0) + x, (rect?.top ?? 0) + y) !== canvas) continue;
        if ((await globalThis.__scenity?.pick(x, y))?.entity === entity) return { x, y };
      }
    }
    return null;
  }, id);
  if (found === null) throw new Error(`no point of the canvas shows ${id}`);
  const box = await page.getByTestId("scene-view").boundingBox();
  return { x: (box?.x ?? 0) + found.x, y: (box?.y ?? 0) + found.y };
}

/** The value of the plugin component of an entity in the document of the page. */
function beacon(page: Page, id: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate(
    ([entity, component]) =>
      globalThis.__scenity?.document().entities[entity ?? ""]?.components[component ?? ""] as
        Record<string, unknown> | undefined,
    [id, BEACON],
  );
}

test("a plugin component shows in the inspector with no editor code; edits undo, save and reload", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await expect(page.getByTestId("inspector-title")).toHaveText("Scene");
  // A click on the table selects it (the outline and the inspector).
  const point = await pointOn(page, "table");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("inspector-title")).toHaveText("Dining table");
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual(["table"]);
  await expect(page.getByTestId("inspector-component-transform")).toBeVisible();
  // The search of "Add component" offers the component of the plugin; its fields come from its zod schema.
  await page.getByTestId("inspector-add").fill(BEACON);
  await page.locator(`[data-testid="inspector-add-item"][data-component="${BEACON}"]`).click();
  const section = page.getByTestId(`inspector-component-${BEACON}`);
  await expect(section).toBeVisible();
  for (const key of ["rate", "tint", "mode", "on", "label", "offset", "target", "sound", "glow"]) {
    await expect(section.getByTestId(`field-${BEACON}-${key}-row`)).toBeVisible();
  }
  expect(await beacon(page, "table")).toEqual({ rate: 0, mode: "steady" });
  // A picture of the panel for the owner (test-results).
  await page.screenshot({ path: test.info().outputPath("inspector.png") });
  // A number, a colour and an enum.
  await page.getByTestId(`field-${BEACON}-rate`).fill("2.5");
  await page.getByTestId(`field-${BEACON}-rate`).press("Enter");
  await page.getByTestId(`field-${BEACON}-tint`).fill("#00ff00");
  await page.getByTestId(`field-${BEACON}-mode`).selectOption("pulse");
  expect(await beacon(page, "table")).toEqual({ rate: 2.5, tint: "#00ff00", mode: "pulse" });
  await expect(page.getByTestId("scene-state")).toHaveText("unsaved");
  // ⌘Z undoes one edit: the enum.
  await page.getByTestId("scene-view").focus();
  await page.keyboard.press("ControlOrMeta+z");
  await expect.poll(() => beacon(page, "table")).toEqual({ rate: 2.5, tint: "#00ff00", mode: "steady" });
  await expect(page.getByTestId(`field-${BEACON}-mode`)).toHaveValue("steady");
  // A drag of the grip of a number is one step.
  const grip = await page.getByTestId(`field-${BEACON}-rate-grip`).boundingBox();
  if (grip === null) throw new Error("no grip");
  await page.mouse.move(grip.x + grip.width / 2, grip.y + grip.height / 2);
  await page.mouse.down();
  await page.mouse.move(grip.x + grip.width / 2 + 40, grip.y + grip.height / 2, { steps: 8 });
  await page.mouse.up();
  expect((await beacon(page, "table"))?.rate).toBe(3.5);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  expect((await beacon(page, "table"))?.rate).toBe(2.5);
  // Save, then a reload with the table selected shows the same values.
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const disk = JSON.parse(readFileSync(join(dir, SCENE), "utf8")) as {
    entities: Record<string, { components: Record<string, unknown> }>;
  };
  expect(disk.entities.table?.components[BEACON]).toEqual({ mode: "steady", rate: 2.5, tint: "#00ff00" });
  await open(page, "&sel=table");
  await expect(page.getByTestId("inspector-title")).toHaveText("Dining table");
  await expect(page.getByTestId(`field-${BEACON}-rate`)).toHaveValue("2.5");
  await expect(page.getByTestId(`field-${BEACON}-tint-hex`)).toHaveValue("#00ff00");
  await expect(page.getByTestId(`field-${BEACON}-mode`)).toHaveValue("steady");
});

test("an edit of a transform part writes the vector; a reset puts the default back", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "&sel=ottoman");
  await expect(page.getByTestId("inspector-title")).toHaveText("Ottoman");
  await page.getByTestId("field-transform-scale-1").fill("2");
  await page.getByTestId("field-transform-scale-1").press("Enter");
  const scale = () =>
    page.evaluate(
      () => (globalThis.__scenity?.document().entities.ottoman?.components.transform as { scale?: number[] }).scale,
    );
  expect(await scale()).toEqual([1, 2, 1]);
  await page.getByTestId("field-transform-scale-row-reset").click();
  expect(await scale()).toBeUndefined();
});

test("two locked inspectors show two entities; the scene edits by the keyboard only", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1600, height: 1000 });
  await open(page);
  const titles = () => page.getByTestId("inspector-title").allTextContents();
  // Lock the first inspector on the table, open a second one, lock it on the lantern.
  await page.evaluate(() => globalThis.__scenity?.select?.(["table"]));
  await expect(page.getByTestId("inspector-title")).toHaveText("Dining table");
  await page.getByTestId("inspector-lock").click();
  await page.keyboard.press("ControlOrMeta+3");
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.copy", {}));
  await expect(page.getByTestId("inspector-title")).toHaveCount(2);
  await page.evaluate(() => globalThis.__scenity?.select?.(["lantern"]));
  await expect.poll(async () => (await titles()).sort()).toEqual(["Dining table", "Lantern"]);
  await page.getByTestId("inspector-lock").nth(1).click();
  // A new selection changes neither locked inspector.
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  await expect.poll(async () => (await titles()).sort()).toEqual(["Dining table", "Lantern"]);
  // The steps by keys: a point light and a camera from the search box, the exposure of the scene, then a save.
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type(">create a point light");
  await page.keyboard.press("Enter");
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type(">create a camera");
  await page.keyboard.press("Enter");
  const entities = () => page.evaluate(() => Object.values(globalThis.__scenity?.document().entities ?? {}));
  await expect
    .poll(async () => (await entities()).some((item) => "camera" in item.components && item.name === "Camera"))
    .toBe(true);
  expect(
    (await entities()).some((item) => (item.components.light as { type?: string } | undefined)?.type === "point"),
  ).toBe(true);
  // The exposure of the scene: the Tab key goes through the inspector to the field, then a value and Enter.
  await page.getByTestId("inspector-lock").first().click();
  await page.getByTestId("inspector-lock").nth(1).click();
  await page.keyboard.press("ControlOrMeta+Shift+A");
  await expect(page.getByTestId("inspector-title").first()).toHaveText("Scene");
  await page.getByTestId("inspector-lock").first().focus();
  let found = false;
  for (let step = 0; step < 80 && !found; step += 1) {
    await page.keyboard.press("Tab");
    found = await page.evaluate(
      () => document.activeElement?.closest('[data-component="environment"][data-field="exposure"]') !== null,
    );
  }
  expect(found).toBe(true);
  await page.keyboard.press("ControlOrMeta+A");
  await page.keyboard.type("1.4");
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis.__scenity?.document().environment as { exposure?: number } | undefined)?.exposure,
      ),
    )
    .toBe(1.4);
  // The environment map and the fog by keys: Tab to each select, then the arrow keys choose an option.
  const map = () =>
    page.evaluate(() => (globalThis.__scenity?.document().environment as { map?: string } | undefined)?.map);
  // The showroom has a map. The Reset button of the field (Enter) removes it, then an arrow key on the select sets it.
  await tabTo(page, '[data-testid="field-environment-map-row-reset"]');
  await page.keyboard.press("Enter");
  await expect.poll(map).toBeUndefined();
  await tabTo(page, '[data-testid="field-environment-map"]');
  await chooseByKeys(page);
  await expect.poll(map).toMatch(/^asset:/);
  await tabTo(page, '[data-testid="field-environment-fog-form"]');
  await chooseByKeys(page);
  await expect
    .poll(() => page.evaluate(() => (globalThis.__scenity?.document().environment as { fog?: unknown }).fog))
    .toBeDefined();
  // A material on a part by keys: the ottoman from the search box, the key of a part, then Enter.
  // The next test uses the armchair.
  await page.keyboard.press("ControlOrMeta+K");
  await page.keyboard.type("@Ottoman");
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("inspector-title").first()).toHaveText("Ottoman", READY);
  const parts = page.locator('datalist[id="field-model-materials-parts"] option');
  await expect(parts.first()).toBeAttached(READY);
  const part = (await parts.first().getAttribute("value")) ?? "";
  expect(part).toMatch(/^mesh:/);
  await tabTo(page, '[data-testid="field-model-materials-key"]');
  await page.keyboard.type(part);
  await page.keyboard.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(() =>
        Object.keys(
          (globalThis.__scenity?.document().entities.ottoman?.components.model as { materials?: object } | undefined)
            ?.materials ?? {},
        ),
      ),
    )
    .toEqual([part]);
  await page.keyboard.press("ControlOrMeta+S");
  await expect(page.getByTestId("scene-state")).toHaveText("saved", READY);
});

/** Press Tab until the focus is on an element of the selector (at most 160 presses). */
async function tabTo(page: Page, selector: string): Promise<void> {
  for (let step = 0; step < 160; step += 1) {
    if (await page.evaluate((query) => document.activeElement?.matches(query) === true, selector)) return;
    await page.keyboard.press("Tab");
  }
  throw new Error(`the Tab key did not reach ${selector}`);
}

/**
 * Choose another option of the focused select by keys: the type-ahead of a closed select (the start of the label of
 * the first other option that is not off). An arrow key opens the list of the system on macOS, so the spec types.
 */
async function chooseByKeys(page: Page): Promise<void> {
  const value = () => page.evaluate(() => (document.activeElement as HTMLSelectElement).value);
  const before = await value();
  const label = await page.evaluate(() => {
    const select = document.activeElement as HTMLSelectElement;
    const other = [...select.options].find((option) => !option.disabled && option.value !== select.value);
    return other?.text.trim() ?? "";
  });
  await page.keyboard.type(label.slice(0, 6));
  expect(await value()).not.toBe(before);
}

test("a material override picks its part in the view", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair"]));
  const pick = page.getByTestId("field-model-materials-pick");
  await expect(pick).toBeVisible(READY);
  const point = await pointOn(page, "armchair");
  await pick.click();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-pick-part", "1");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("scene-view")).not.toHaveAttribute("data-pick-part");
  // The click names a mesh of the armchair, keeps the selection, and adds its override as one step.
  const keys = () =>
    page.evaluate(() =>
      Object.keys(
        (globalThis.__scenity?.document().entities.armchair?.components.model as { materials?: object } | undefined)
          ?.materials ?? {},
      ),
    );
  await expect.poll(keys).toEqual([expect.stringMatching(/^mesh:/)]);
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual(["armchair"]);
  await page.evaluate(() => globalThis.__scenity?.undo());
  await expect.poll(keys).toEqual([]);
});

test("the lighting steps in the Lighting window: a map, the exposure, the fog, a preset, a light", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.lighting"));
  const panel = page.getByTestId("lighting-panel");
  await expect(panel).toBeVisible();
  const environment = () =>
    page.evaluate(() => (globalThis.__scenity?.document().environment ?? {}) as Record<string, unknown>);
  // The environment map from its picture.
  await panel.getByTestId("lighting-map-none").click();
  await expect.poll(async () => (await environment()).map).toBeUndefined();
  await panel.getByTestId("lighting-map").first().click();
  await expect.poll(async () => (await environment()).map).toMatch(/^asset:/);
  const map = (await environment()).map;
  // The exposure and the fog: the fields of the environment with their previews.
  const exposure = panel.getByTestId("field-environment-exposure");
  await exposure.fill("1.4");
  await exposure.press("Enter");
  await expect.poll(async () => (await environment()).exposure).toBe(1.4);
  await panel.getByTestId("field-environment-fog-form").selectOption({ index: 1 });
  await expect.poll(async () => (await environment()).fog).toMatchObject({ type: "linear" });
  await expect(panel.locator('[data-testid="inspector-preview"][data-kind="fog"]')).toBeVisible();
  // A preset sets the look in one step and keeps the map. Undo restores the fog.
  await panel.locator('[data-testid="lighting-preset"][data-preset="evening"]').click();
  await expect(panel.locator('[data-testid="lighting-preset"][data-preset="evening"]')).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  expect(await environment()).toMatchObject({ toneMapping: "agx", exposure: 0.8, map });
  await page.evaluate(() => globalThis.__scenity?.undo());
  await expect.poll(async () => (await environment()).exposure).toBe(1.4);
  // The lights of the scene: the intensity of the sun.
  const sun = panel.getByTestId("lighting-intensity-sun");
  await sun.fill("3");
  await sun.press("Enter");
  await expect
    .poll(() =>
      page.evaluate(
        () => (globalThis.__scenity?.document().entities.sun?.components.light as { intensity?: number }).intensity,
      ),
    )
    .toBe(3);
});

test("a saved light preset applies to a second light, as one step", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const light = (id: string) =>
    page.evaluate((entity) => globalThis.__scenity?.document().entities[entity]?.components.light, id);
  const lantern = await light("lantern-light");
  const sun = await light("sun");
  // Save the light of the lantern as a preset: the card menu asks for the name.
  await page.evaluate(() => globalThis.__scenity?.select?.(["lantern-light"]));
  await page.getByTestId("inspector-menu-light").click();
  await page.getByRole("menuitem", { name: "Save as a preset" }).click();
  await page.getByTestId("command-prompt-input").fill("Warm lamp");
  await page.getByTestId("command-prompt-go").click();
  // The card menu of the sun lists the preset; the apply is one step of the history.
  await page.evaluate(() => globalThis.__scenity?.select?.(["sun"]));
  await page.getByTestId("inspector-menu-light").click();
  await page.getByRole("menuitem", { name: "Apply the preset Warm lamp" }).click();
  await expect.poll(() => light("sun")).toEqual(lantern);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(() => light("sun")).toEqual(sun);
  // An agent finds the preset as a command; the browser storage keeps it for a new page.
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-inspector", "1", READY);
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("preset.apply.warmLamp", { entity: "sun" }, { by: "claude" }),
  );
  await page.evaluate(() => {
    const api = globalThis.__scenity;
    for (const proposal of api?.proposals?.() ?? []) api?.accept?.(proposal.id);
  });
  await expect.poll(() => light("sun")).toEqual(lantern);
});
