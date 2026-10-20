// SPDX-License-Identifier: Apache-2.0
// The transform gizmos of the scene page: the test moves, turns and scales an entity on three axes. The spec copies the
// showroom to a temp folder and selects the coffee table in the edit mode (the panels of the page leave it in view).
// It drags each handle of the move, turn and scale gizmos with a typed value. It checks the document, the inspector
// fields, the steps of the history and the saved file. A drag with no typed value goes on the grid. The files of the
// repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-gizmo --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { qfromAxisAngle, qmul, type Quat } from "@scenity/scene/math";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SCENE = "scenes/main.scene.json";
const READY = { timeout: 60_000 };
/** The entity of the test and its transform in the showroom. */
const ENTITY = "coffee-table";
const START = { position: [-1.2, 0, 0.3], rotation: [0, 0.707107, 0, 0.707107] };

// The panels of the edit mode (the hierarchy, the inspector and the asset dock) cover the sides of the canvas.
test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-gizmo-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ gizmo: dir });
  origin = server.origin;
  key = server.keys.gizmo ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

interface Transform {
  readonly position?: number[];
  readonly rotation?: number[];
  readonly scale?: number[];
}

/** Open the copy in the edit mode with the table selected and wait for the frame, the inspector and the gizmos. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json&sel=${ENTITY}`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-gizmo", "1", READY);
  await expect(view).toHaveAttribute("data-inspector", "1", READY);
}

/** The transform of an entity (default: the entity of the test) in the document of the page. */
function transform(page: Page, id = ENTITY): Promise<Transform> {
  return page.evaluate(
    (entity) => (globalThis.__scenity?.document().entities[entity]?.components.transform ?? {}) as Transform,
    id,
  );
}

/** The page point of a handle of the gizmo now; it must be a point of the canvas (no panel over it). */
async function handlePoint(page: Page, id: string): Promise<{ x: number; y: number }> {
  const found = await page.evaluate((handle) => {
    const point = (globalThis.__scenity?.gizmo?.().handles as Record<string, { x: number; y: number }> | undefined)?.[
      handle
    ];
    const canvas = document.querySelector("canvas");
    if (point === undefined || canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    return document.elementFromPoint(box.left + point.x, box.top + point.y) === canvas
      ? { x: box.left + point.x, y: box.top + point.y }
      : null;
  }, id);
  if (found === null) {
    const info = await page.evaluate(() => JSON.stringify(globalThis.__scenity?.gizmo?.()));
    throw new Error(`the handle ${id} is not on the canvas: ${info}`);
  }
  return found;
}

/** Drag a handle by (dx, dy) pixels, type a value during the drag (or none) and release. */
async function dragHandle(page: Page, id: string, typed: string | null, dx = 30, dy = -20): Promise<void> {
  const start = await handlePoint(page, id);
  const view = page.getByTestId("scene-view");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(view).toHaveAttribute("data-gizmo-drag", id);
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 6 });
  if (typed !== null) {
    await page.keyboard.type(typed);
    await expect(page.getByTestId("gizmo-typed")).toContainText(typed);
  }
  await page.mouse.up();
  await expect(view).not.toHaveAttribute("data-gizmo-drag", id);
  await page.evaluate(() => globalThis.__scenity?.frame());
}

function closeTo(actual: readonly number[] | undefined, expected: readonly number[]): void {
  expect(actual?.length).toBe(expected.length);
  expected.forEach((value, index) => {
    expect(actual?.[index]).toBeCloseTo(value, 5);
  });
}

/** The quaternion with w ≥ 0 (the page writes each turn so). */
function positive(q: Quat): Quat {
  return q[3] < 0 ? [-q[0], -q[1], -q[2], -q[3]] : q;
}

const DEG = Math.PI / 180;

test("the gizmos move, turn and scale an entity on three axes; each drag is one step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  expect(await transform(page)).toEqual(START);
  const info = await page.evaluate(() => globalThis.__scenity?.gizmo?.());
  expect(info?.targets).toEqual([ENTITY]);
  expect(info?.settings.mode).toBe("translate");
  // A picture of the gizmo for the owner (test-results).
  await page.screenshot({ path: test.info().outputPath("gizmo-move.png") });

  // A pointer drag of the x arrow with no typed value: the change goes on the 1 cm grid, y and z stay.
  await dragHandle(page, "x", null, 60, 0);
  const free = (await transform(page)).position ?? [];
  expect(free[0]).not.toBe(-1.2);
  expect(Math.abs(Math.round((free[0] ?? 0) * 100) - (free[0] ?? 0) * 100)).toBeLessThan(1e-6);
  expect([free[1], free[2]]).toEqual([0, 0.3]);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  expect(await transform(page)).toEqual(START);

  // Move on x, y and z with typed values; the inspector fields follow.
  await dragHandle(page, "x", "0.5");
  await dragHandle(page, "y", "0.25");
  await dragHandle(page, "z", "-0.4");
  closeTo((await transform(page)).position, [-0.7, 0.25, -0.1]);
  await expect(page.getByTestId("field-transform-position-0")).toHaveValue("-0.7");
  await expect(page.getByTestId("field-transform-position-2")).toHaveValue("-0.1");
  // One drag is one step of the history.
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  closeTo((await transform(page)).position, [-0.7, 0.25, 0.3]);
  expect(await page.evaluate(() => globalThis.__scenity?.redo())).toBe(true);

  // Turn the table about x, y and z (world axes) with typed degrees.
  await page.keyboard.press("e");
  await expect(page.getByTestId("gizmo-mode-rotate")).toHaveAttribute("aria-pressed", "true");
  await page.screenshot({ path: test.info().outputPath("gizmo-turn.png") });
  await dragHandle(page, "x", "90");
  await dragHandle(page, "y", "45");
  await dragHandle(page, "z", "30");
  const turns = qmul(
    qfromAxisAngle([0, 0, 1], 30 * DEG),
    qmul(qfromAxisAngle([0, 1, 0], 45 * DEG), qfromAxisAngle([1, 0, 0], 90 * DEG)),
  );
  closeTo((await transform(page)).rotation, positive(qmul(turns, START.rotation as Quat)));
  closeTo((await transform(page)).position, [-0.7, 0.25, -0.1]);

  // Scale on x, y and z (the local axes of the entity) with typed factors.
  await page.keyboard.press("r");
  await page.screenshot({ path: test.info().outputPath("gizmo-scale.png") });
  await dragHandle(page, "x", "2");
  await dragHandle(page, "y", "0.5");
  await dragHandle(page, "z", "1.5");
  closeTo((await transform(page)).scale, [2, 0.5, 1.5]);

  // A typed value with no pointer: W, then X, a number and Enter.
  await page.keyboard.press("w");
  await page.keyboard.press("x");
  await page.keyboard.type("0.1");
  await page.keyboard.press("Enter");
  closeTo((await transform(page)).position, [-0.6, 0.25, -0.1]);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  closeTo((await transform(page)).position, [-0.7, 0.25, -0.1]);

  // Save: the file has the values of the document.
  const saved = await transform(page);
  // The turned table goes below the floor: the block rule `showroom.onFloor` asks for a reason.
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-notice")).toHaveAttribute("data-kind", "rules");
  await expect(page.getByTestId("scene-notice")).toContainText("showroom.onFloor");
  await page.getByTestId("rules-reason").fill("the gizmo test turns the table into the floor");
  await page.getByTestId("rules-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  const disk = JSON.parse(readFileSync(join(dir, SCENE), "utf8")) as {
    entities: Record<string, { components: { transform: Transform } }>;
  };
  expect(disk.entities[ENTITY]?.components.transform).toEqual(saved);
  closeTo(saved.scale, [2, 0.5, 1.5]);
});

test("local axes, the centre pivot and Escape", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The entity of the first test is turned: a move on its local x follows its turn.
  const before = await transform(page);
  await page.getByTestId("gizmo-space").click();
  await expect(page.getByTestId("gizmo-space")).toHaveAttribute("data-value", "local");
  const frame = await page.evaluate(() => globalThis.__scenity?.gizmo?.());
  expect(frame?.settings.space).toBe("local");
  await dragHandle(page, "x", "1");
  const after = await transform(page);
  const moved = (after.position ?? []).map((value, index) => value - (before.position?.[index] ?? 0));
  // The local x axis of the entity: the first column of its rotation.
  const [x, y, z, w] = (before.rotation ?? [0, 0, 0, 1]) as Quat;
  closeTo(moved, [1 - 2 * (y * y + z * z), 2 * (x * y + w * z), 2 * (x * z - w * y)]);
  // Escape during a drag restores the start and makes no step.
  const start = await handlePoint(page, "y");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await page.mouse.move(start.x, start.y - 40, { steps: 4 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  expect(await transform(page)).toEqual(after);
  // The centre pivot of two entities: a half turn about the world y swaps their places around the centre.
  await page.evaluate((entity) => globalThis.__scenity?.select?.([entity, "armchair"]), ENTITY);
  await page.getByTestId("gizmo-space").click();
  await expect(page.getByTestId("gizmo-space")).toHaveAttribute("data-value", "world");
  await page.keyboard.press("p");
  await page.keyboard.press("e");
  const a = (await transform(page)).position ?? [];
  const b = (await transform(page, "armchair")).position ?? [];
  const centre = a.map((value, index) => (value + (b[index] ?? 0)) / 2);
  closeTo((await page.evaluate(() => globalThis.__scenity?.gizmo?.().origin)) ?? [], centre);
  await dragHandle(page, "y", "180");
  const mirror = (p: readonly number[]): number[] =>
    p.map((value, index) => (index === 1 ? value : 2 * (centre[index] ?? 0) - value));
  closeTo((await transform(page)).position, mirror(a));
  closeTo((await transform(page, "armchair")).position, mirror(b));
});

/** The page point of a component handle that shows on a pixel of the canvas, or null. */
async function componentHandle(
  page: Page,
  ids: readonly string[],
): Promise<{ id: string; x: number; y: number } | null> {
  return page.evaluate((wanted) => {
    const canvas = document.querySelector("canvas");
    if (canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    for (const handle of globalThis.__scenity?.handles?.() ?? []) {
      if (!wanted.includes(handle.id) || handle.x === null || handle.y === null) continue;
      const [x, y] = [box.left + handle.x, box.top + handle.y];
      if (document.elementFromPoint(x, y) === canvas) return { id: handle.id, x, y };
    }
    return null;
  }, ids);
}

test("the handles of the components: the shadow box of the sun and the target of a camera, one step each", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const component = (id: string, name: string): Promise<unknown> =>
    page.evaluate(([entity, key]) => globalThis.__scenity?.document().entities[entity]?.components[key], [
      id,
      name,
    ] as const);
  const view = page.getByTestId("scene-view");
  const drag = async (point: { x: number; y: number }, dx: number, dy: number): Promise<void> => {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(view).toHaveAttribute("data-handle-drag");
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 6 });
    await page.mouse.up();
    await expect(view).not.toHaveAttribute("data-handle-drag");
    await page.evaluate(() => globalThis.__scenity?.frame());
  };
  // The sun: a side of its shadow box moves along its axis.
  await page.evaluate(() => globalThis.__scenity?.select?.(["sun"]));
  const sides = ["left", "right", "top", "bottom", "near"].map((side) => `light.shadowCamera.${side}`);
  await expect.poll(() => componentHandle(page, sides)).not.toBeNull();
  const side = await componentHandle(page, sides);
  if (side === null) throw new Error("no side of the shadow box on the canvas");
  const before = (await component("sun", "light")) as { shadowCamera: Record<string, number> };
  await drag(side, 40, 25);
  const field = side.id.split(".").pop() ?? "";
  const after = (await component("sun", "light")) as { shadowCamera: Record<string, number> };
  expect(after.shadowCamera[field]).not.toBe(before.shadowCamera[field]);
  expect({ ...after.shadowCamera, [field]: before.shadowCamera[field] }).toEqual(before.shadowCamera);
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(await component("sun", "light")).toEqual(before);
  // The top camera: its point target moves in the plane of the view.
  await page.evaluate(() => globalThis.__scenity?.select?.(["top"]));
  await expect.poll(() => componentHandle(page, ["camera.target"])).not.toBeNull();
  const target = await componentHandle(page, ["camera.target"]);
  if (target === null) throw new Error("no target on the canvas");
  await drag(target, 30, 0);
  const camera = (await component("top", "camera")) as { target: number[] };
  expect(camera.target[0]).toBeGreaterThan(0.05);
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(((await component("top", "camera")) as { target: number[] }).target).toEqual([0, 0, 0]);
});

test("the handles of the view: the range of a light and the points of a path, one step per drag", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const view = page.getByTestId("scene-view");
  const drag = async (point: { x: number; y: number }, dx: number, dy: number): Promise<void> => {
    await page.mouse.move(point.x, point.y);
    await page.mouse.down();
    await expect(view).toHaveAttribute("data-handle-drag");
    await page.mouse.move(point.x + dx, point.y + dy, { steps: 6 });
    await page.mouse.up();
    await expect(view).not.toHaveAttribute("data-handle-drag");
    await page.evaluate(() => globalThis.__scenity?.frame());
  };
  const range = () =>
    page.evaluate(
      () => (globalThis.__scenity?.document().entities["lantern-light"]?.components.light as { range?: number }).range,
    );
  // The range of the lantern light: a drag of its handle along the axis (a range of 1 m keeps it in the view).
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("component.set", {
      entity: "lantern-light",
      component: "light",
      field: "range",
      value: "1",
    }),
  );
  await page.evaluate(() => globalThis.__scenity?.select?.(["lantern-light"]));
  await expect.poll(() => componentHandle(page, ["light.range"])).not.toBeNull();
  const handle = await componentHandle(page, ["light.range"]);
  if (handle === null) throw new Error("no range handle on the canvas");
  await drag(handle, -40, 0);
  expect(await range()).not.toBe(1);
  await page.evaluate(() => globalThis.__scenity?.undo());
  expect(await range()).toBe(1);
  // A path: the hollow handle in the middle of a segment adds a point, Alt and a press deletes it.
  await page.evaluate(() => globalThis.__scenity?.command?.("entity.create.path", { name: "Route", x: -0.5, z: 1 }));
  const points = () =>
    page.evaluate(() => {
      const doc = globalThis.__scenity?.document();
      const id = Object.keys(doc?.entities ?? {}).find((key) => doc?.entities[key]?.name === "Route") ?? "";
      return (doc?.entities[id]?.components.path as { points: number[][] } | undefined)?.points.length ?? 0;
    });
  expect(await points()).toBe(2);
  await expect.poll(() => componentHandle(page, ["path.points.add.0"])).not.toBeNull();
  const add = await componentHandle(page, ["path.points.add.0"]);
  if (add === null) throw new Error("no add handle on the canvas");
  await drag(add, 0, 20);
  expect(await points()).toBe(3);
  const middle = await componentHandle(page, ["path.points.1"]);
  if (middle === null) throw new Error("no middle point on the canvas");
  await page.keyboard.down("Alt");
  await page.mouse.click(middle.x, middle.y);
  await page.keyboard.up("Alt");
  await expect.poll(points).toBe(2);
  await page.evaluate(() => globalThis.__scenity?.undo());
  await expect.poll(points).toBe(3);
});
