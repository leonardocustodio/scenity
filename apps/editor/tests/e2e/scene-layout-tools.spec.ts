// SPDX-License-Identifier: Apache-2.0
// The generic layout tools of the scene page on the showroom. The spec copies the showroom and the characters sample
// to temp folders and opens them in the edit mode. It measures two props (two selected entities, then two picks on the
// canvas) and shows the clearance of the table. On the pickup scene of the characters, it shows the walk path and the
// reach sphere of the robot. A tool with no input says why. Each tool draws on the overlay canvas. The files of the
// repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-layout-tools --project=chromium --workers=1
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SAMPLES = join(LABS_ROOT, "../../samples");
const READY = { timeout: 60_000 };

// The panels of the edit mode (the hierarchy, the inspector and the asset dock) cover the sides of the canvas.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 120_000 });

const dirs: string[] = [];
let origin = "";
let server: SpecServer | null = null;

/** The key of a project of the spec in the page URLs. */
const key = (name: string): string => server?.keys[name] ?? name;

/** Copy the parts of a sample to a temp folder. */
function copy(sample: string, parts: readonly string[]): string {
  const dir = mkdtempSync(join(tmpdir(), `scenity-layout-tools-${sample}-`));
  for (const part of parts) cpSync(join(SAMPLES, sample, part), join(dir, part), { recursive: true });
  dirs.push(dir);
  return dir;
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  const showroom = copy("showroom", ["assets", "build", "rights", "scenes", "scenity.project.json"]);
  const characters = copy("characters", ["assets", "rights", "scenes", "sequences", "scenity.project.json"]);
  server = await startSpecServer({ room: showroom, walkers: characters, road: join(SAMPLES, "sim-road") });
  origin = server.origin;
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true });
});

/** The main scene of the project when the query names no scene (`edit=1` with no `scene=` is the start screen). */
function mainScene(query: string): string {
  return query.includes("scene=") ? "" : "&scene=scenes/main.scene.json";
}

/** Open a page of the scene server in the edit mode and wait for the frame and the layout tools. */
async function open(page: Page, query: string): Promise<void> {
  await page.goto(`${origin}/scene.html?${query}&edit=1${mainScene(query)}`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-layout-tools", "1", READY);
  await expect(page.getByTestId("scene-layout-tools")).toBeVisible();
}

/** Click a tool of the menu and wait for its readout. */
async function useTool(page: Page, tool: string, state: "ok" | "none" = "ok"): Promise<string[]> {
  await page.getByTestId(`layout-tool-${tool}`).click();
  await expect(page.getByTestId(`layout-tool-${tool}`)).toHaveAttribute("aria-pressed", "true");
  const readout = page.getByTestId("scene-layout-readout");
  await expect(readout).toHaveAttribute("data-state", state);
  return readout.locator("li").allTextContents();
}

/** The lines that the overlay drew (after the next frame of the page). */
async function drawnLines(page: Page): Promise<number> {
  await page.evaluate(() => globalThis.__scenity?.frame());
  return page.evaluate(() => globalThis.__scenity?.layoutTools?.().drawn.lines ?? 0);
}

/** The value of the first metric of the result now. */
function firstValue(page: Page): Promise<number | null> {
  return page.evaluate(() => globalThis.__scenity?.layoutTools?.().result?.metrics[0]?.result?.value ?? null);
}

/** A page point (CSS pixels) on an entity: the first point of a grid where the pick finds it. */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(async (entity) => {
    const canvas = document.querySelector("canvas");
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    // The canvas is in the Scene view panel, not at the corner of the page.
    const rect = canvas?.getBoundingClientRect();
    // The panels, the menus and the readout cover a part of the canvas; a point under them does not reach the canvas.
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

test("measure two props of the showroom and show the clearance of the table", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, `project=${key("room")}&camera=front&sel=armchair,ottoman`);
  // The tools are in the Tools overlay. The readout is an overlay of the Scene view while a tool is active.
  await expect(page.getByTestId("overlay-tools").getByTestId("layout-tool-measure")).toBeVisible();
  await expect(page.getByTestId("overlay-layout-readout")).toBeHidden();
  const measure = await useTool(page, "measure");
  await expect(page.getByTestId("overlay-layout-readout").getByTestId("scene-layout-readout")).toBeVisible();
  expect(measure[0]).toMatch(/^entity:armchair to entity:ottoman: 2\.02 m \(floor 2\.02 m, rise 0\.0 cm\)$/);
  expect(await firstValue(page)).toBeCloseTo(Math.hypot(1.4, 1.45), 3);
  expect(await drawnLines(page)).toBeGreaterThanOrEqual(3);
  // With no selection, two clicks on the canvas pick the ends.
  await page.evaluate(() => globalThis.__scenity?.select?.(null));
  const readout = page.getByTestId("scene-layout-readout");
  await expect(readout).toContainText("Click a point on the canvas (1 of 2).");
  for (const id of ["coffee-table", "table"]) {
    const at = await pointOn(page, id);
    await page.mouse.click(at.x, at.y);
    if (id === "coffee-table") await expect(readout).toContainText("(2 of 2)");
  }
  await expect(readout.locator("li").first()).toHaveText(/^\(.*\) to \(.*\): \d+\.\d\d m \(floor /);
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual([]);
  expect(await firstValue(page)).toBeGreaterThan(2);
  // The clearance of the table: its nearest neighbour, the gap and the walkway through it.
  await page.evaluate(() => globalThis.__scenity?.select?.("table"));
  const clearance = await useTool(page, "clearance");
  expect(clearance).toEqual([expect.stringMatching(/^table to coffee-table: 1\.4\d m, walkway 1\.4\d m$/)]);
  expect(await page.evaluate(() => globalThis.__scenity?.layoutTools?.().result?.subjects)).toEqual([
    "table",
    "coffee-table",
  ]);
  // The 12 edges of the box of the table (2 rings and 4 posts) and the gap line.
  expect(await drawnLines(page)).toBe(7);
  // The showroom has no character and no walker: the tools say why.
  expect((await useTool(page, "reach", "none"))[0]).toContain("character component or a stand point");
  expect((await useTool(page, "walk", "none"))[0]).toContain("locomotion");
  await page.getByTestId("layout-tool-clear").click();
  await expect(readout).toBeHidden();
  await expect(page.getByTestId("overlay-layout-readout")).toBeHidden();
  expect(await drawnLines(page)).toBe(0);
});

test("Save as a rule: a measure becomes a distance rule with its value now as the limit", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, `project=${key("room")}&camera=front&sel=armchair,ottoman`);
  await useTool(page, "measure");
  const value = await firstValue(page);
  await page.getByTestId("layout-save-rule").click();
  const form = page.getByTestId("rule-editor");
  await expect(form).toBeVisible();
  await expect(form.getByTestId("rule-metric")).toHaveValue("distance");
  await expect(form.getByTestId("rule-arg-from")).toHaveValue("entity:armchair");
  await expect(form.getByTestId("rule-arg-to")).toHaveValue("entity:ottoman");
  const limit = Math.round((value ?? 0) * 1000) / 1000;
  const side = (await form.getByTestId("rule-max").inputValue()) === "" ? "min" : "max";
  await expect(form.getByTestId(`rule-${side}`)).toHaveValue(String(limit));
  await form.getByTestId("rule-id").fill("armchairToOttoman");
  await form.getByTestId("rule-save").click();
  await expect(form).toHaveCount(0);
  const rules = await page.evaluate(() => globalThis.__scenity?.document().rules ?? []);
  expect(rules.find((rule) => rule.id === "armchairToOttoman")).toMatchObject({
    metric: "distance",
    args: { from: "entity:armchair", to: "entity:ottoman" },
    [side]: limit,
  });
});

test("the Performance panel shows each value of stats() and the cost of each entity", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, `project=${key("room")}&camera=front`);
  // The render item of the status bar opens the panel.
  await page.getByTestId("status-render").click();
  const panel = page.getByTestId("performance-panel");
  await expect(panel).toBeVisible();
  await expect(panel.getByTestId("perf-stat").first()).toBeVisible(READY);
  const keys = await page.evaluate(async () => Object.keys((await globalThis.__scenity?.stats()) ?? {}));
  expect(keys.length).toBeGreaterThan(10);
  await expect
    .poll(async () => {
      const shown = await panel.getByTestId("perf-stat").evaluateAll((items) => items.map((item) => item.dataset.key));
      return keys.filter((key) => !shown.includes(key));
    }, READY)
    .toEqual([]);
  // The cost of each entity: the most triangles first; a click selects the entity.
  const first = panel.getByTestId("perf-cost").first();
  await expect(first).toBeVisible();
  const id = await first.getAttribute("data-entity");
  await first.locator("button").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.() ?? [])).toEqual([id]);
});

test("each generic debug layer toggles from the View options overlay", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, `project=${key("room")}&camera=front`);
  const part = page.getByTestId("overlay-view").getByTestId("scene-debug-layers");
  await part.locator("summary").click();
  await expect(part).toHaveAttribute("data-layers", /^\d+$/, READY);
  const generic = ["bounds", "sockets", "obstacles", "paths", "skeleton", "wireframe", "normals", "lights", "cameras"];
  for (const name of generic) await expect(part.getByTestId(`scene-debug-${name}`)).toHaveCount(1);
  for (const name of generic) {
    await part.getByTestId(`scene-debug-${name}`).check();
    await expect
      .poll(async () => (await page.evaluate(() => globalThis.__scenity?.inspect?.()))?.layers.on ?? [])
      .toContain(name);
    expect(new URL(page.url()).searchParams.get("debug")?.split(",")).toContain(name);
    await part.getByTestId(`scene-debug-${name}`).uncheck();
    await expect
      .poll(async () => (await page.evaluate(() => globalThis.__scenity?.inspect?.()))?.layers.on ?? [])
      .not.toContain(name);
  }
});

test("the debug layer of a plugin toggles from the View options overlay", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, `project=${key("road")}&camera=front&scene=scenes/road.scene.json`);
  const part = page.getByTestId("overlay-view").getByTestId("scene-debug-layers");
  await part.locator("summary").click();
  // The traffic plugin gives the layer of the gaps between its vehicles (its dev face).
  const layer = part.getByTestId("scene-debug-traffic-gaps");
  await expect(layer).toHaveCount(1, READY);
  await layer.check();
  await expect
    .poll(async () => (await page.evaluate(() => globalThis.__scenity?.inspect?.()))?.layers.on ?? [])
    .toContain("traffic-gaps");
  await layer.uncheck();
  await expect
    .poll(async () => (await page.evaluate(() => globalThis.__scenity?.inspect?.()))?.layers.on ?? [])
    .not.toContain("traffic-gaps");
});

test("Find a place: a search places a chair that passes three rules", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, `project=${key("room")}&camera=front&sel=armchair`);
  // Three rules on the armchair, and a start that fails them: the armchair stands against the coffee table.
  const rules = [
    {
      id: "chair.awayFromTable",
      metric: "distance",
      args: { from: "entity:armchair", to: "entity:coffee-table" },
      min: 1.4,
      level: "block",
    },
    { id: "chair.clearOfOttoman", metric: "overlap", args: { a: "armchair", b: "ottoman" }, max: 0, level: "block" },
    { id: "chair.onFloor", metric: "belowFloor", args: { entity: "armchair" }, max: 0.001, level: "block" },
  ];
  const before = await page.evaluate(
    ([list]) =>
      globalThis.__scenity?.apply([
        { op: "set", path: "/rules", value: list },
        { op: "set", path: "/entities/armchair/components/transform/position", value: [-1.7, 0, 0.3] },
      ]),
    [rules] as const,
  );
  expect(before).toBeNull();
  const search = page.getByTestId("layout-search");
  await search.getByTestId("layout-search-run").click();
  await expect(search).toHaveAttribute("data-variants", /^[1-9]/, READY);
  const result = await page.evaluate(() => globalThis.__scenity?.layoutSearch?.("armchair", 2));
  const first = result?.variants[0];
  expect(first?.results).toMatchObject({
    "chair.awayFromTable": "pass",
    "chair.clearOfOttoman": "pass",
    "chair.onFloor": "pass",
  });
  await search.getByTestId(`layout-search-apply-${first?.id ?? "v1"}`).click();
  const at = await page.evaluate(
    () => (globalThis.__scenity?.document().entities.armchair?.components.transform as { position: number[] }).position,
  );
  expect(at).toEqual(first?.position);
  // The page check of the rules at the new place: the three pass.
  await page.getByTestId("dock-tab-rules").click();
  for (const rule of rules) {
    await expect(page.locator(`[data-testid="rules-check"][data-rule="${rule.id}"]`)).toHaveAttribute(
      "data-status",
      "pass",
      READY,
    );
  }
});

test("the walk path and the reach sphere of the robot", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  const scene = "scene=scenes/pickup.scene.json&sequence=sequences/pickup.sequence.json";
  await open(page, `project=${key("walkers")}&${scene}&camera=front&t=3800&paused=1&sel=robot`);
  const walk = await useTool(page, "walk");
  expect(walk[0]).toMatch(/^robot leg 0: \d\.\d\d m long, .* free, no solid within 10\.0 cm$/);
  expect(await firstValue(page)).toBe(0);
  expect(await drawnLines(page)).toBeGreaterThanOrEqual(1);
  // The reach of the robot at the table: the sphere of its arm bones, and the cup in reach.
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot", "cup"]));
  const reach = await useTool(page, "reach");
  expect(reach[0]).toMatch(/^robot: the (left|right) arm: \d+\.\d cm from the shoulder$/);
  expect(reach[1]).toMatch(/^entity:cup: in reach: /);
  expect(await firstValue(page)).toBeGreaterThanOrEqual(0);
  // Three great circles, the floor ring, the post and the line to the target.
  expect(await drawnLines(page)).toBeGreaterThanOrEqual(6);
  const labels = await page.evaluate(() => globalThis.__scenity?.layoutTools?.().drawn.labels);
  expect(labels?.[0]).toMatch(/^robot reach \d+\.\d cm$/);
  // At the start of the take the cup is out of reach: the tool runs again after a seek.
  await page.evaluate(() => globalThis.__scenity?.seek?.(0));
  await expect(page.getByTestId("scene-layout-readout")).toContainText("out of reach by", READY);
});
