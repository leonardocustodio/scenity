// SPDX-License-Identifier: Apache-2.0
// The hierarchy panel of the scene page: each action of the panel is a command with an undo step. The spec uses a copy
// of the showroom in the edit mode. A drag of a row changes the parent (the world transform stays, so the frame
// stays). A double-click renames, the eye hides, and ⌘Z undoes each one. A lock stops the pick and the drag of the
// viewport. A click of a row selects the entity of the viewport. Save and a reload keep the parent, the name and the
// hide, and the saved file holds no solo or lock. The spec starts the dev server of the scene page on a temp copy, so
// the files of the repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-hierarchy --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { worldTransform } from "@scenity/scene/world";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { diffFrames } from "../support/room3d-helpers";
import { sceneCanvasShot } from "../support/sceneCanvas";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SCENE = "scenes/main.scene.json";
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 150_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-hierarchy-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  // A scene of 10,000 entities: 100 groups of 99 entities, and the front camera of the page.
  writeFileSync(join(dir, BIG), `${JSON.stringify(bigScene())}\n`);
  server = await startSpecServer({ tree: dir });
  origin = server.origin;
  key = server.keys.tree ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy in the edit mode and wait for the first frame with every asset and for the panel. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-hierarchy", "1");
}

const row = (page: Page, id: string) => page.getByTestId(`hierarchy-row-${id}`);

const BIG = "scenes/big.scene.json";

/** A scene of 10,000 entities with a front camera. */
function bigScene(): object {
  const entities: Record<string, object> = {
    front: {
      name: "Front camera",
      parent: null,
      index: 0,
      components: { transform: { position: [0, 2, 8] }, camera: { fov: 50 } },
    },
  };
  for (let group = 0; group < 100; group += 1) {
    entities[`g${String(group)}`] = { name: `Group ${String(group)}`, parent: null, index: group + 1, components: {} };
    for (let item = 0; item < 99; item += 1) {
      entities[`g${String(group)}-${String(item)}`] = {
        name: `Item ${String(group)}.${String(item)}`,
        parent: `g${String(group)}`,
        index: item,
        components: {},
      };
    }
  }
  return { format: "scenity.scene/1", id: "big", entities };
}

/** A canvas point (CSS pixels) on an entity that no panel covers: the first point of a grid where the pick finds it. */
async function pointOn(page: Page, id: string): Promise<{ x: number; y: number }> {
  const [found] = await pointsOn(page, id, 1);
  if (found === undefined) throw new Error(`no point of the canvas shows ${id}`);
  return found;
}

/** Up to `count` canvas points on an entity that no panel covers, from a grid. */
function pointsOn(page: Page, id: string, count: number): Promise<{ x: number; y: number }[]> {
  return page.evaluate(
    async ({ entity, most }) => {
      const canvas = document.querySelector("canvas");
      const width = canvas?.clientWidth ?? 0;
      const height = canvas?.clientHeight ?? 0;
      // The canvas is in the Scene view panel, not at the corner of the page.
      const rect = canvas?.getBoundingClientRect();
      const found: { x: number; y: number }[] = [];
      for (let y = height * 0.3; y < height * 0.95 && found.length < most; y += 12) {
        for (let x = width * 0.05; x < width * 0.95 && found.length < most; x += 12) {
          if (document.elementFromPoint((rect?.left ?? 0) + x, (rect?.top ?? 0) + y) !== canvas) continue;
          if ((await globalThis.__scenity?.pick(x, y))?.entity === entity) found.push({ x, y });
        }
      }
      return found;
    },
    { entity: id, most: count },
  );
}

/** The entity that the pick finds at a canvas point, or null. */
function pickAt(page: Page, point: { x: number; y: number }): Promise<string | null> {
  return page.evaluate(async (at) => (await globalThis.__scenity?.pick(at.x, at.y))?.entity ?? null, point);
}

/** An entity of the document of the page. */
function entity(page: Page, id: string) {
  return page.evaluate((key) => {
    const value = globalThis.__scenity?.document().entities[key];
    return value === undefined
      ? null
      : { parent: value.parent, name: value.name ?? null, components: value.components };
  }, id);
}

/** The world position and rotation of an entity in the document of the page. */
async function world(page: Page, id: string): Promise<number[]> {
  const doc: SceneDocument | undefined = await page.evaluate(() => globalThis.__scenity?.document());
  const value = doc === undefined ? undefined : worldTransform(doc, id);
  return [...(value?.position ?? []), ...(value?.rotation ?? [])];
}

async function undo(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+KeyZ");
  await page.evaluate(() => globalThis.__scenity?.frame());
}

async function redo(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+Shift+KeyZ");
  await page.evaluate(() => globalThis.__scenity?.frame());
}

test("reparent, rename and hide undo one step each; save and reload keep them, and no view state", async ({
  page,
  context,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // A drag of a row onto the middle of another row: the new parent. The world transform stays, so the frame stays.
  const before = await sceneCanvasShot(page);
  const place = await world(page, "ottoman");
  await row(page, "ottoman").dragTo(row(page, "table"));
  await expect.poll(async () => (await entity(page, "ottoman"))?.parent).toBe("table");
  await expect(row(page, "ottoman")).toHaveAttribute("aria-level", "2");
  const kept = await world(page, "ottoman");
  kept.forEach((value, index) => expect(value).toBeCloseTo(place[index] ?? Number.NaN, 5));
  // The draw order of the objects can change, so a few edge pixels can differ.
  expect((await diffFrames(context, before, await sceneCanvasShot(page))).differ).toBeLessThan(1500);
  await undo(page);
  expect((await entity(page, "ottoman"))?.parent).toBeNull();
  await redo(page);
  expect((await entity(page, "ottoman"))?.parent).toBe("table");
  // A double-click opens the rename field; Enter renames.
  await row(page, "armchair").dblclick();
  await page.getByTestId("hierarchy-rename").fill("Reading chair");
  await page.getByTestId("hierarchy-rename").press("Enter");
  await expect(row(page, "armchair")).toContainText("Reading chair");
  await undo(page);
  await expect(row(page, "armchair")).toContainText("Armchair");
  await redo(page);
  // The eye hides an entity: the pick goes through it.
  const point = await pointOn(page, "coffee-table");
  await page.getByTestId("hierarchy-hide-coffee-table").click();
  await page.evaluate(() => globalThis.__scenity?.frame());
  expect(await pickAt(page, point)).not.toBe("coffee-table");
  await undo(page);
  expect(await pickAt(page, point)).toBe("coffee-table");
  await redo(page);
  // A lock is a view value: no pick and no drag of the viewport; the file never holds it.
  const tablePoint = await pointOn(page, "table");
  await page.getByTestId("hierarchy-lock-table").click();
  await page.evaluate(() => globalThis.__scenity?.frame());
  expect(await pickAt(page, tablePoint)).not.toBe("table");
  expect(await page.evaluate(() => globalThis.__scenity?.view?.())).toEqual({ solo: [], locked: ["table"] });
  await expect(page.getByTestId("scene-state")).toHaveText("unsaved");
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const disk = JSON.parse(readFileSync(join(dir, SCENE), "utf8")) as {
    entities: Record<string, { parent: string | null; name?: string; components: Record<string, unknown> }>;
  };
  expect(disk.entities.ottoman?.parent).toBe("table");
  expect(disk.entities.armchair?.name).toBe("Reading chair");
  expect(disk.entities["coffee-table"]?.components.visibility).toEqual({ visible: false });
  expect(readFileSync(join(dir, SCENE), "utf8")).not.toContain("pickable");
  // The double-click of the rename selected the armchair: no selection, so no outline and no gizmo in the picture.
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  const saved = await sceneCanvasShot(page);
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-hierarchy", "1");
  expect((await entity(page, "ottoman"))?.parent).toBe("table");
  await expect(row(page, "armchair")).toContainText("Reading chair");
  await expect(page.getByTestId("hierarchy-hide-coffee-table")).toHaveAttribute("aria-pressed", "true");
  expect(await page.evaluate(() => globalThis.__scenity?.view?.())).toEqual({ solo: [], locked: [] });
  // The lock did not go to the file: the table takes the pick again (a point found again: the restored layout can
  // differ from the built one by one pixel after the round-off).
  expect(await pickAt(page, await pointOn(page, "table"))).toBe("table");
  expect((await diffFrames(context, saved, await sceneCanvasShot(page))).differ).toBeLessThan(400);
});

test("a click of a row selects in the viewport; a viewport pick selects the row; a lock stops the drag", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await row(page, "lantern").click();
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual(["lantern"]);
  await row(page, "shelf").click({ modifiers: ["ControlOrMeta"] });
  expect(await page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual(["lantern", "shelf"]);
  await expect(row(page, "shelf")).toHaveAttribute("aria-selected", "true");
  // The selection of a script or of a viewport pick shows in the panel.
  await page.evaluate(() => globalThis.__scenity?.select?.(["front"]));
  await expect(row(page, "front")).toHaveAttribute("aria-selected", "true");
  await expect(row(page, "lantern")).toHaveAttribute("aria-selected", "false");
  // A locked entity takes no drag: the press finds no entity to move. No selection: no gizmo over the point. The
  // pick goes through a locked entity, so the point is one with no model behind the ottoman (the drag moves models).
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  const candidates = await pointsOn(page, "ottoman", 60);
  await page.getByTestId("hierarchy-lock-ottoman").click();
  await page.evaluate(() => globalThis.__scenity?.frame());
  let point: { x: number; y: number } | undefined;
  for (const candidate of candidates) {
    const behind = await pickAt(page, candidate);
    const model = await page.evaluate(
      (id) => (id === null ? undefined : globalThis.__scenity?.document().entities[id]?.components.model),
      behind,
    );
    if (model !== undefined) continue;
    point = candidate;
    break;
  }
  if (point === undefined) throw new Error("no point of the ottoman with no model behind it");
  const box = await page.getByTestId("scene-view").boundingBox();
  const start = { x: (box?.x ?? 0) + point.x, y: (box?.y ?? 0) + point.y };
  const position = await entity(page, "ottoman");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x + 80, start.y, { steps: 8 });
  await page.mouse.up();
  await page.evaluate(() => globalThis.__scenity?.frame());
  // No entity moved: the document is the saved file.
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  expect((await entity(page, "ottoman"))?.components.transform).toEqual(position?.components.transform);
  // The drag that moves no entity turns the editor camera. The front camera draws again for the pick.
  expect(await page.evaluate(() => globalThis.__scenity?.viewport?.().camera)).toBe("editor");
  await page.evaluate(() => globalThis.__scenity?.camera("front"));
  // The undo of the lock: one step, and the pick finds the entity again.
  await undo(page);
  expect(await pickAt(page, point)).toBe("ottoman");
});

test("rename, move and delete work by keyboard only", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const doc = () => page.evaluate(() => globalThis.__scenity?.document().entities ?? {});
  const roots = async () =>
    Object.entries(await doc())
      .filter(([, item]) => item.parent === null)
      .sort(([, a], [, b]) => a.index - b.index)
      .map(([id]) => id);
  const order = await roots();
  const [firstRoot, secondRoot] = order;
  if (firstRoot === undefined || secondRoot === undefined) throw new Error("the scene has no two roots");
  // The focus goes to a row with no pointer; then only keys.
  await row(page, firstRoot).focus();
  await page.keyboard.press("Space");
  await page.keyboard.press("ArrowDown");
  const next = await page.evaluate(() => globalThis.__scenity?.selection?.()[0] ?? "");
  expect(next).not.toBe(firstRoot);
  // F2 renames the row with the focus.
  await page.keyboard.press("F2");
  await page.getByTestId("hierarchy-rename").fill("Renamed by keys");
  await page.keyboard.press("Enter");
  await expect.poll(async () => (await doc())[next]?.name).toBe("Renamed by keys");
  // Alt+↓ moves a root after the root after it.
  await row(page, firstRoot).focus();
  await page.keyboard.press("Alt+ArrowDown");
  await expect.poll(async () => (await roots()).indexOf(firstRoot)).toBe(1);
  // Alt+→ moves it into the root before it.
  await page.keyboard.press("Alt+ArrowRight");
  await expect.poll(async () => (await doc())[firstRoot]?.parent).toBe(secondRoot);
  // Delete deletes the entity of the row with the focus (and its children).
  await page.keyboard.press("Delete");
  await expect.poll(async () => (await doc())[firstRoot]).toBeUndefined();
});

test("10,000 entities scroll with few rows in the page and short frames", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=${BIG}`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", { timeout: 120_000 });
  const tree = page.getByTestId("hierarchy-tree");
  await expect(tree).toHaveAttribute("data-rows", "10001", READY);
  expect(await page.locator('[role="treeitem"]').count()).toBeLessThan(150);
  // Scroll the tree in steps; each step must give the next frame soon.
  const frames = await page.evaluate(async () => {
    const element = document.querySelector<HTMLElement>('[data-testid="hierarchy-tree"]');
    if (element === null) return [];
    const times: number[] = [];
    let last = performance.now();
    for (let step = 0; step < 120; step += 1) {
      element.scrollTop += 700;
      element.dispatchEvent(new Event("scroll"));
      await new Promise((done) => requestAnimationFrame(done));
      const now = performance.now();
      times.push(now - last);
      last = now;
    }
    return times.sort((a, b) => a - b);
  });
  expect(frames.length).toBe(120);
  const median = frames[Math.floor(frames.length / 2)] ?? Infinity;
  expect(median).toBeLessThan(34);
  expect(await page.locator('[role="treeitem"]').count()).toBeLessThan(150);
});
