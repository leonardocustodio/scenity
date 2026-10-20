// SPDX-License-Identifier: Apache-2.0
// The prefab UI of the scene page: the apply and the revert of an override. The spec copies the showroom to a temp
// folder and adds a small stool prefab (a seat and a lantern) with two instances in the main scene. In the edit mode,
// the runtime draws and picks the prefab entities, and the hierarchy shows them under their instances. A change of the
// seat of one instance is an override. "Apply to prefab" writes it into the prefab, and the other instance changes (in
// the document and in the boxes that the core draws). One undo restores both. A second change and "Revert" give the
// prefab value again. Save writes the scene and the prefab file, and a reload shows the same values. "Open prefab"
// opens the prefab file in the prefab mode, and an edit there shows in both instances. The files of the repository
// never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-prefabs --project=chromium --workers=1
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ScenePageApi } from "../../src/scene/main";
import type { PrefabApi } from "../../src/scene/prefabs/prefabTools";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const MAIN = "scenes/main.scene.json";
const PREFAB = "scenes/stool.prefab.json";
const OTTOMAN = "asset:01M4ZPXYG3Y8BZ2M38RFM5YFTB";
const LANTERN = "asset:01M4ZPXYG26FPR940EDPJM9FCD";
const READY = { timeout: 60_000 };

// The panels of the edit mode (the hierarchy, the inspector and the asset dock) cover the sides of the canvas.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

/** The stool prefab and its two instances in the main scene of the copy. */
function writePrefab(): void {
  const prefab = {
    format: "scenity.prefab/1",
    id: "stool",
    name: "Stool",
    root: "base",
    entities: {
      base: { name: "Stool", parent: null, index: 0, components: { transform: { position: [0, 0, 0] } } },
      seat: { name: "Seat", parent: "base", index: 0, components: { transform: {}, model: { asset: OTTOMAN } } },
      lamp: {
        name: "Lamp",
        parent: "base",
        index: 1,
        components: { transform: { position: [0, 0.42, 0] }, model: { asset: LANTERN } },
      },
    },
  };
  writeFileSync(join(dir, PREFAB), `${JSON.stringify(prefab, null, 2)}\n`);
  const main = JSON.parse(readFileSync(join(dir, MAIN), "utf8")) as { entities: Record<string, unknown> };
  const count = Object.keys(main.entities).filter((id) => (main.entities[id] as { parent: unknown }).parent === null);
  const instance = (name: string, x: number, index: number) => ({
    name,
    parent: null,
    index,
    components: { transform: { position: [x, 0, 1.6] }, prefab: { source: "stool.prefab.json" } },
  });
  main.entities["stool-a"] = instance("Stool A", 1.1, count.length);
  main.entities["stool-b"] = instance("Stool B", 2.3, count.length + 1);
  writeFileSync(join(dir, MAIN), `${JSON.stringify(main, null, 2)}\n`);
}

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-prefabs-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  writePrefab();
  server = await startSpecServer({ prefabs: dir });
  origin = server.origin;
  key = server.keys.prefabs ?? "";
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

/** Open a document of the copy in the edit mode and wait for the first frame, the inspector and the hierarchy. */
async function open(page: Page, query = "&camera=front"): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&edit=1${mainScene(query)}${query}`);
  await waitReady(page);
}

async function waitReady(page: Page): Promise<void> {
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-inspector", "1", READY);
  await expect(view).toHaveAttribute("data-hierarchy", "1", READY);
}

/** The transform of an entity of the expanded document (the prefab entities too). */
function shownTransform(page: Page, id: string): Promise<Record<string, unknown> | undefined> {
  return page.evaluate((entity) => {
    // The edit mode adds `prefabs` to the script API (scene/prefabs/prefabTools.ts).
    const api = globalThis.__scenity as (ScenePageApi & Partial<PrefabApi>) | undefined;
    const expanded = (api?.prefabs?.().expanded ?? api?.document())?.entities;
    return expanded?.[entity]?.components.transform as Record<string, unknown> | undefined;
  }, id);
}

/** The height of the box that the core draws for an entity (the inspect report of the last frame). */
async function drawnHeight(page: Page, id: string): Promise<number> {
  const height = await page.evaluate(async (entity) => {
    const report = await globalThis.__scenity?.inspect?.();
    const box = report?.entities.find((item) => item.id === entity)?.bounds;
    return box === null || box === undefined ? null : box.max[1] - box.min[1];
  }, id);
  if (height === null) throw new Error(`the core draws no box for ${id}`);
  return height;
}

/** The overrides of an instance in the document of the page. */
function overrides(page: Page, id: string): Promise<unknown> {
  return page.evaluate(
    (entity) =>
      (globalThis.__scenity?.document().entities[entity]?.components.prefab as { overrides?: unknown } | undefined)
        ?.overrides,
    id,
  );
}

/** A page point (CSS pixels) on an entity: the first point of a grid where the pick finds it. */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(async (entity) => {
    const canvas = document.querySelector("canvas");
    const width = canvas?.clientWidth ?? 0;
    const height = canvas?.clientHeight ?? 0;
    // The canvas is in the Scene view panel, not at the corner of the page.
    const rect = canvas?.getBoundingClientRect();
    for (let y = height * 0.2; y < height * 0.95; y += 10) {
      for (let x = width * 0.05; x < width * 0.95; x += 10) {
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

/** Write a part of the scale of the selected entity in the inspector. */
async function setScaleY(page: Page, value: string): Promise<void> {
  await page.getByTestId("field-transform-scale-1").fill(value);
  await page.getByTestId("field-transform-scale-1").press("Enter");
}

test("an instance change applies to the prefab and reverts; save and reload keep the values", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The runtime draws and picks the prefab entities; the hierarchy shows them under their instances.
  await expect(page.getByTestId("hierarchy-prefab-stool-a")).toBeVisible();
  await expect(page.getByTestId("hierarchy-row-stool-b/seat")).toHaveAttribute("data-kind", "prefab");
  const before = await drawnHeight(page, "stool-b/seat");
  expect(before).toBeGreaterThan(0.2);
  const point = await pointOn(page, "stool-a/seat");
  await page.mouse.click(point.x, point.y);
  await expect(page.getByTestId("inspector-title")).toHaveText("Seat");
  await page.screenshot({ path: test.info().outputPath("prefab-instance.png") });

  // A change of the seat of stool A is an override of stool A only.
  await setScaleY(page, "1.5");
  await expect
    .poll(() => overrides(page, "stool-a"))
    .toEqual([{ op: "set", path: "/entities/seat/components/transform/scale", value: [1, 1.5, 1] }]);
  await expect(page.getByTestId("hierarchy-override-stool-a/seat")).toHaveText("1");
  await expect(page.getByTestId("field-transform-scale-row-revert")).toBeVisible();
  expect((await shownTransform(page, "stool-b/seat"))?.scale).toBeUndefined();

  // Apply to prefab: the override goes into the prefab, and stool B changes in the document and in the core.
  await page.getByTestId("inspector-prefab-apply").click();
  await expect.poll(() => overrides(page, "stool-a")).toBeUndefined();
  await expect.poll(async () => (await shownTransform(page, "stool-b/seat"))?.scale).toEqual([1, 1.5, 1]);
  // The first frame with the selection outline loads its pipeline: a cold dev server takes some seconds for it.
  await expect.poll(() => drawnHeight(page, "stool-b/seat"), READY).toBeCloseTo(before * 1.5, 2);
  await expect(page.getByTestId("hierarchy-override-stool-a/seat")).toHaveCount(0);
  await expect(page.getByTestId("field-transform-scale-1")).toHaveValue("1.5");
  // One undo restores the scene and the prefab. A redo applies again.
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(async () => (await shownTransform(page, "stool-b/seat"))?.scale).toBeUndefined();
  expect(await overrides(page, "stool-a")).toHaveLength(1);
  await expect.poll(() => drawnHeight(page, "stool-b/seat"), READY).toBeCloseTo(before, 2);
  expect(await page.evaluate(() => globalThis.__scenity?.redo())).toBe(true);
  await expect.poll(async () => (await shownTransform(page, "stool-b/seat"))?.scale).toEqual([1, 1.5, 1]);

  // A second change, then Revert of the component: the instance shows the prefab value again.
  await setScaleY(page, "2");
  await expect.poll(async () => (await shownTransform(page, "stool-a/seat"))?.scale).toEqual([1, 2, 1]);
  await page.getByTestId("inspector-revert-transform").click();
  await expect.poll(() => overrides(page, "stool-a")).toBeUndefined();
  await expect(page.getByTestId("field-transform-scale-1")).toHaveValue("1.5");
  expect((await shownTransform(page, "stool-a/seat"))?.scale).toEqual([1, 1.5, 1]);
  // The revert is one undo step; a field revert and an entity revert go through the same command.
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect(page.getByTestId("field-transform-scale-1")).toHaveValue("2");
  await page.getByTestId("inspector-prefab-revert").click();
  await expect(page.getByTestId("field-transform-scale-1")).toHaveValue("1.5");

  // Save writes the scene and the prefab file (the canonical form); a reload shows the same values.
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const scene = JSON.parse(readFileSync(join(dir, MAIN), "utf8")) as {
    entities: Record<string, { components: Record<string, unknown> }>;
  };
  expect(scene.entities["stool-a"]?.components.prefab).toEqual({ source: "stool.prefab.json" });
  const prefabText = readFileSync(join(dir, PREFAB), "utf8");
  expect(JSON.parse(prefabText)).toMatchObject({
    entities: { seat: { components: { transform: { scale: [1, 1.5, 1] } } } },
  });
  expect(prefabText.startsWith('{\n  "entities": {\n    "base": {')).toBe(true);
  await open(page, "&camera=front&sel=stool-b/seat");
  await expect(page.getByTestId("inspector-title")).toHaveText("Seat");
  await expect(page.getByTestId("field-transform-scale-1")).toHaveValue("1.5");
  await expect.poll(() => drawnHeight(page, "stool-b/seat")).toBeCloseTo(before * 1.5, 2);
});

test("Open prefab edits the prefab file with the editor tools; both instances show the change", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page, "&camera=front&sel=stool-a");
  await expect(page.getByTestId("inspector-title")).toHaveText("Stool A");
  await page.getByTestId("inspector-prefab-open").click();
  await page.waitForURL(/scene=scenes%2Fstool\.prefab\.json/);
  await waitReady(page);
  await expect(page.getByTestId("scene-file")).toHaveText(PREFAB);
  // The prefab mode edits the prefab document: its entities are the rows of the hierarchy.
  await expect(page.getByTestId("hierarchy-row-lamp")).toBeVisible();
  await page.getByTestId("hierarchy-row-lamp").click();
  await expect(page.getByTestId("inspector-title")).toHaveText("Lamp");
  await page.getByTestId("field-transform-position-1").fill("0.5");
  await page.getByTestId("field-transform-position-1").press("Enter");
  await page.screenshot({ path: test.info().outputPath("prefab-mode.png") });
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const prefab = JSON.parse(readFileSync(join(dir, PREFAB), "utf8")) as {
    format: string;
    entities: Record<string, { components: { transform: { position: number[] } } }>;
  };
  expect(prefab.format).toBe("scenity.prefab/1");
  expect(prefab.entities.lamp?.components.transform.position).toEqual([0, 0.5, 0]);
  // Return to the scene: both instances show the new place of the lamp.
  await page.getByTestId("prefab-back").click();
  await page.waitForURL(/scene=scenes%2Fmain\.scene\.json/);
  await waitReady(page);
  for (const id of ["stool-a/lamp", "stool-b/lamp"]) {
    expect((await shownTransform(page, id))?.position).toEqual([0, 0.5, 0]);
  }
});

/** The expanded document of the page (the prefab entities too). */
function expanded(page: Page): Promise<Record<string, { name?: string; components: Record<string, unknown> }>> {
  return page.evaluate(() => {
    const api = globalThis.__scenity as (ScenePageApi & Partial<PrefabApi>) | undefined;
    return (api?.prefabs?.().expanded ?? api?.document())?.entities ?? {};
  }) as Promise<Record<string, { name?: string; components: Record<string, unknown> }>>;
}

test("a prefab from two entities, two instances, an override applied to the prefab changes both", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const run = (id: string, args: Record<string, unknown>) =>
    page.evaluate(([command, given]) => globalThis.__scenity?.command?.(command, given), [id, args] as const);
  // Make a prefab of the armchair and the ottoman: the two become one instance in their place.
  await page.evaluate(() => globalThis.__scenity?.select?.(["armchair", "ottoman"]));
  await run("prefab.create", { name: "Lounge" });
  await expect.poll(() => existsSync(join(dir, "prefabs/lounge.prefab.json"))).toBe(true);
  const doc = await page.evaluate(() => globalThis.__scenity?.document().entities ?? {});
  expect(doc.armchair).toBeUndefined();
  expect(doc.lounge?.components.prefab).toEqual({ source: "../prefabs/lounge.prefab.json" });
  await expect
    .poll(async () =>
      Object.keys(await expanded(page))
        .filter((id) => id.startsWith("lounge/"))
        .sort(),
    )
    .toEqual(["lounge/armchair", "lounge/lounge", "lounge/ottoman"]);
  // A second instance from the Create preset.
  await run("entity.create.prefab", { name: "Lounge B", source: "../prefabs/lounge.prefab.json", x: 2 });
  await expect.poll(async () => (await expanded(page))["lounge-b/armchair"] !== undefined).toBe(true);
  // An override in the first instance: a rename and a move of a prefab entity (the hierarchy and the gizmo commands).
  await page.evaluate(() => globalThis.__scenity?.select?.(["lounge/ottoman"]));
  await run("entity.rename", { entity: "lounge/ottoman", name: "Footrest" });
  await run("entity.move", { entity: "lounge/ottoman", x: 0.5 });
  expect(await overrides(page, "lounge")).toEqual([
    expect.objectContaining({ path: "/entities/ottoman/name", value: "Footrest" }),
    expect.objectContaining({ path: expect.stringContaining("/entities/ottoman/components/transform") }),
  ]);
  expect((await expanded(page))["lounge-b/ottoman"]?.name).toBe("Ottoman");
  // Apply to the prefab: both instances change, and the first one has no override left.
  await run("prefab.apply", { instance: "lounge" });
  expect(await overrides(page, "lounge")).toBeUndefined();
  await expect.poll(async () => (await expanded(page))["lounge-b/ottoman"]?.name).toBe("Footrest");
  // Save writes the prefab; unpack makes the second instance plain entities.
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const prefab = JSON.parse(readFileSync(join(dir, "prefabs/lounge.prefab.json"), "utf8")) as {
    entities: Record<string, { name?: string }>;
  };
  expect(prefab.entities.ottoman?.name).toBe("Footrest");
  await run("prefab.unpack", { instance: "lounge-b" });
  const unpacked = await page.evaluate(() => globalThis.__scenity?.document().entities ?? {});
  expect(unpacked["lounge-b"]?.components.prefab).toBeUndefined();
  expect(unpacked["lounge-b-ottoman"]?.name).toBe("Footrest");
  // Hierarchy rows that drop on a folder of the Project window become a prefab there.
  await page.evaluate(() => globalThis.__scenity?.select?.(["shelf"]));
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.project"));
  const folder = page.locator('[data-testid="project-folder"][data-path=""]');
  const transfer = await page.evaluateHandle(() => {
    const data = new DataTransfer();
    data.setData("application/x-scenity-entities", "shelf");
    return data;
  });
  await folder.dispatchEvent("dragover", { dataTransfer: transfer });
  await folder.dispatchEvent("drop", { dataTransfer: transfer });
  await page.getByTestId("command-prompt-input").fill("Book shelf");
  await page.getByTestId("command-prompt-go").click();
  await expect.poll(() => existsSync(join(dir, "book-shelf.prefab.json"))).toBe(true);
  await expect
    .poll(() => page.evaluate(() => globalThis.__scenity?.document().entities["book-shelf"]?.components.prefab))
    .toEqual({
      source: "../book-shelf.prefab.json",
    });
});

test("a variant of a prefab overrides one part; the instance uses it as one step", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const run = (id: string, args: Record<string, unknown>) =>
    page.evaluate(([command, given]) => globalThis.__scenity?.command?.(command, given), [id, args] as const);
  // One part of the first stool moves up: an override of the instance. An earlier test can change the prefab.
  const kept = (await shownTransform(page, "stool-b/lamp"))?.position;
  await page.evaluate(() => globalThis.__scenity?.select?.(["stool-a/lamp"]));
  await run("entity.move", { entity: "stool-a/lamp", y: 0.8 });
  const moved = (await shownTransform(page, "stool-a/lamp"))?.position;
  expect(await overrides(page, "stool-a")).toHaveLength(1);
  // The variant beside the stool prefab keeps the override; the instance uses the variant with no override.
  await page.evaluate(() => globalThis.__scenity?.select?.(["stool-a"]));
  await run("prefab.variant", { name: "Tall stool" });
  await expect.poll(() => existsSync(join(dir, "scenes/tall-stool.prefab.json"))).toBe(true);
  const variant = JSON.parse(readFileSync(join(dir, "scenes/tall-stool.prefab.json"), "utf8")) as {
    root: string;
    entities: Record<string, { components: { prefab?: { source: string; overrides?: unknown[] } } }>;
  };
  expect(variant.root).toBe("tall-stool");
  expect(variant.entities["tall-stool"]?.components.prefab).toMatchObject({ source: "stool.prefab.json" });
  expect(variant.entities["tall-stool"]?.components.prefab?.overrides).toHaveLength(1);
  const stool = await page.evaluate(() => globalThis.__scenity?.document().entities["stool-a"]?.components.prefab);
  expect(stool).toEqual({ source: "tall-stool.prefab.json" });
  // The expanded scene and the core show the moved part of the variant; the second stool keeps the prefab.
  await expect.poll(async () => (await shownTransform(page, "stool-a/tall-stool/lamp"))?.position).toEqual(moved);
  expect((await shownTransform(page, "stool-b/lamp"))?.position).toEqual(kept);
  const bottom = (id: string) =>
    page.evaluate(async (entity) => {
      const report = await globalThis.__scenity?.inspect?.();
      return report?.entities.find((item) => item.id === entity)?.bounds?.min[1] ?? null;
    }, id);
  await expect
    .poll(async () => ((await bottom("stool-a/tall-stool/lamp")) ?? 0) - ((await bottom("stool-b/lamp")) ?? 0), READY)
    .toBeGreaterThan(0.2);
  // One undo step restores the stool prefab with its override.
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  expect(await overrides(page, "stool-a")).toHaveLength(1);
});
