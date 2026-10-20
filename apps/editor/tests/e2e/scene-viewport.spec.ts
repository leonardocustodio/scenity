// SPDX-License-Identifier: Apache-2.0
// The viewport of the scene page: the test frames a selected entity. The spec copies the showroom to a temp folder and
// opens it in the edit mode. It selects the armchair and presses F: the target of the editor camera is the centre of
// the box of the armchair, and the box fills a large part of the canvas. It also checks the orbit, the pan, the zoom
// and the fly of the editor camera, and the camera menu (a document camera and then the editor camera). It checks the
// view modes and the grid, the icons of the lights and the cameras, and the camera preview. The files of the
// repository never change.
// Run it alone under the GPU lock:
//   bunx --bun playwright test scene-viewport --project=chromium --workers=1
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import type { ViewportInfo } from "../../src/scene/viewport/viewportTypes";
import { sceneCanvasShot } from "../support/sceneCanvas";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const READY = { timeout: 60_000 };
const ENTITY = "armchair";

test.use({ viewport: { width: 1600, height: 1000 } });

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-viewport-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ viewport: dir });
  origin = server.origin;
  key = server.keys.viewport ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy in the edit mode and wait for the frame, the gizmos and the viewport. */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  await expect(view).toHaveAttribute("data-gizmo", "1", READY);
  await expect(view).toHaveAttribute("data-viewport", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.frame());
}

function viewport(page: Page): Promise<ViewportInfo> {
  return page.evaluate(() => {
    const info = globalThis.__scenity?.viewport?.();
    if (info === undefined) throw new Error("no viewport");
    return info;
  });
}

/** A page point of the canvas (no panel over it) whose pick finds no movable entity: an orbit starts there. */
async function freePoint(page: Page): Promise<{ x: number; y: number }> {
  const found = await page.evaluate(async () => {
    const canvas = document.querySelector("canvas");
    const box = canvas?.getBoundingClientRect();
    if (canvas === null || box === undefined) return null;
    for (let y = box.height * 0.3; y < box.height * 0.8; y += 20) {
      for (let x = box.width * 0.3; x < box.width * 0.7; x += 20) {
        if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
        const hit = await globalThis.__scenity?.pick(x, y);
        const entity = hit === null || hit === undefined ? null : globalThis.__scenity?.document().entities[hit.entity];
        if (entity?.components.model === undefined) return { x: box.left + x, y: box.top + y };
      }
    }
    return null;
  });
  if (found === null) throw new Error("no free point on the canvas");
  return found;
}

/** Drag from a point by (dx, dy) with a button (and Shift), then wait for the frame. */
async function drag(page: Page, dx: number, dy: number, options: { button?: "left" | "middle"; shift?: boolean } = {}) {
  const start = await freePoint(page);
  if (options.shift === true) await page.keyboard.down("Shift");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button: options.button ?? "left" });
  await page.mouse.move(start.x + dx, start.y + dy, { steps: 8 });
  const during = await viewport(page);
  await page.mouse.up({ button: options.button ?? "left" });
  if (options.shift === true) await page.keyboard.up("Shift");
  await page.evaluate(() => globalThis.__scenity?.frame());
  return during;
}

type V3 = [number, number, number];

const sub = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const dot = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: V3, b: V3): V3 => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const norm = (a: V3): V3 => {
  const length = Math.hypot(...a);
  return [a[0] / length, a[1] / length, a[2] / length];
};
const vec = (values: readonly number[] | null | undefined): V3 => [
  values?.[0] ?? 0,
  values?.[1] ?? 0,
  values?.[2] ?? 0,
];

/** The canvas points of the corners of a box through the view of the viewport (the projection of dragMath.ts). */
function corners(info: ViewportInfo, box: { min: V3; max: V3 }, width: number, height: number) {
  const position = vec(info.position);
  const forward = norm(sub(vec(info.target), position));
  const right = norm(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  const tan = Math.tan(((info.fov ?? 50) * Math.PI) / 360);
  const points: { x: number; y: number }[] = [];
  for (const x of [box.min[0], box.max[0]])
    for (const y of [box.min[1], box.max[1]])
      for (const z of [box.min[2], box.max[2]]) {
        const offset = sub([x, y, z], position);
        const depth = dot(offset, forward);
        const ndcX = dot(offset, right) / (depth * tan * (width / height));
        const ndcY = dot(offset, up) / (depth * tan);
        points.push({ x: ((ndcX + 1) / 2) * width, y: ((1 - ndcY) / 2) * height });
      }
  return points;
}

test("F frames the selected entity with the editor camera", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  expect((await viewport(page)).camera).toBe("front");
  const before = await sceneCanvasShot(page);
  await page.evaluate((id) => globalThis.__scenity?.select?.([id]), ENTITY);
  await page.keyboard.press("f");
  await expect.poll(async () => (await viewport(page)).camera).toBe("editor");
  await page.evaluate(() => globalThis.__scenity?.frame());
  const info = await viewport(page);
  const report = await page.evaluate(
    (id) =>
      globalThis.__scenity
        ?.inspect?.()
        .then((made) => made?.entities.find((entity) => entity.id === id)?.bounds ?? null),
    ENTITY,
  );
  expect(report).not.toBeNull();
  const box = { min: vec(report?.min), max: vec(report?.max) };
  box.min.forEach((min, axis) => expect(info.target?.[axis]).toBeCloseTo((min + (box.max[axis] ?? 0)) / 2, 3));
  const size = await page.evaluate(() => {
    const canvas = document.querySelector("canvas");
    return { width: canvas?.clientWidth ?? 0, height: canvas?.clientHeight ?? 0 };
  });
  const points = corners(info, box, size.width, size.height);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  // Each corner is on the canvas, and the box covers between a third and all of the height or the width.
  expect(Math.min(...xs)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...xs)).toBeLessThanOrEqual(size.width);
  expect(Math.min(...ys)).toBeGreaterThanOrEqual(0);
  expect(Math.max(...ys)).toBeLessThanOrEqual(size.height);
  const share = Math.max(
    (Math.max(...xs) - Math.min(...xs)) / size.width,
    (Math.max(...ys) - Math.min(...ys)) / size.height,
  );
  expect(share).toBeGreaterThan(0.33);
  expect(share).toBeLessThan(1);
  // The core draws the editor camera, and the entity is under the centre of the canvas.
  expect((await sceneCanvasShot(page)).equals(before)).toBe(false);
  const centre = await page.evaluate(({ width, height }) => globalThis.__scenity?.pick(width / 2, height / 2), size);
  expect(centre?.entity).toBe(ENTITY);
  // The editor camera is not in the document.
  expect(await page.evaluate(() => globalThis.__scenity?.file().dirty)).toBe(false);
});

test("orbit, pan, zoom and fly move the editor camera; the camera menu opens a document camera and back", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const during = await drag(page, 160, 40);
  expect(during.moving).toBe(true);
  const orbited = await viewport(page);
  expect(orbited.camera).toBe("editor");
  expect(orbited.moving).toBe(false);
  await drag(page, 120, -60, { shift: true });
  const panned = await viewport(page);
  expect(panned.target).not.toEqual(orbited.target);
  expect(panned.position).not.toEqual(orbited.position);
  await drag(page, -80, 30, { button: "middle" });
  const pannedAgain = await viewport(page);
  expect(pannedAgain.target).not.toEqual(panned.target);
  // The orbit keeps the target; the wheel keeps the target and changes the distance.
  const distance = (info: ViewportInfo) =>
    Math.hypot(...(info.position ?? []).map((value, axis) => value - (info.target?.[axis] ?? 0)));
  const point = await freePoint(page);
  await page.mouse.move(point.x, point.y);
  await page.mouse.wheel(0, 400);
  await expect.poll(async () => distance(await viewport(page))).toBeGreaterThan(distance(pannedAgain) * 1.2);
  await expect.poll(async () => (await viewport(page)).moving).toBe(false);
  // Fly: the right button down, W moves the camera along the view; E does not change the gizmo mode then.
  const beforeFly = await viewport(page);
  await page.mouse.down({ button: "right" });
  await page.keyboard.down("w");
  await page.keyboard.press("e");
  await page.waitForTimeout(400);
  await page.keyboard.up("w");
  await page.mouse.up({ button: "right" });
  await page.evaluate(() => globalThis.__scenity?.frame());
  const flown = await viewport(page);
  expect(flown.position).not.toEqual(beforeFly.position);
  expect(await page.evaluate(() => globalThis.__scenity?.gizmo?.().settings.mode)).toBe("translate");
  // The menu: the top camera, then the editor camera at its last view.
  const editorShot = await sceneCanvasShot(page);
  await page.getByTestId("scene-camera-menu").selectOption("top");
  await expect.poll(async () => (await viewport(page)).camera).toBe("top");
  const topShot = await sceneCanvasShot(page);
  expect(topShot.equals(editorShot)).toBe(false);
  await page.getByTestId("scene-camera-menu").selectOption("editor");
  await expect.poll(async () => (await viewport(page)).camera).toBe("editor");
  expect((await viewport(page)).position).toEqual(flown.position);
  // The number keys: 1 opens the first document camera (front), 0 the editor camera.
  await page.keyboard.press("1");
  await expect.poll(async () => (await viewport(page)).camera).toBe("front");
  await page.keyboard.press("0");
  await expect.poll(async () => (await viewport(page)).camera).toBe("editor");
  // The script API of the document cameras disables the editor camera.
  await page.evaluate(() => globalThis.__scenity?.camera("top"));
  expect((await viewport(page)).camera).toBe("top");
});

test("the view modes and the grid change the frame; lit gives the frame back", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  expect((await viewport(page)).grid).toBe(true);
  const lit = await sceneCanvasShot(page);
  const shots = [lit];
  for (const mode of ["unlit", "wireframe", "normals"] as const) {
    await page.getByTestId("scene-view-mode").selectOption(mode);
    await expect.poll(async () => (await viewport(page)).viewMode).toBe(mode);
    await page.evaluate(() => globalThis.__scenity?.frame());
    const shot = await sceneCanvasShot(page);
    for (const other of shots) expect(shot.equals(other)).toBe(false);
    shots.push(shot);
  }
  await page.evaluate(() => globalThis.__scenity?.setViewport?.({ viewMode: "lit" }));
  expect((await sceneCanvasShot(page)).equals(lit)).toBe(true);
  await page.getByTestId("scene-grid").uncheck();
  await page.evaluate(() => globalThis.__scenity?.frame());
  expect((await sceneCanvasShot(page)).equals(lit)).toBe(false);
  // The view layers stay out of the URL.
  expect(new URL(page.url()).searchParams.get("debug")).toBeNull();
});

test("the icons select a light or a camera; the camera preview shows the selected camera", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The top camera looks at the room from above: the lights are in its view, and the camera of the eye has no icon.
  await page.evaluate(() => globalThis.__scenity?.camera("top"));
  await expect.poll(async () => (await viewport(page)).icons.length).toBeGreaterThan(1);
  const info = await viewport(page);
  expect(info.icons.some((icon) => icon.id === "top")).toBe(false);
  expect(info.icons.every((icon) => ["fill", "sun", "lantern-light", "front"].includes(icon.id))).toBe(true);
  const icon = await page.evaluate((icons) => {
    for (const each of icons) {
      const button = document.querySelector(`[data-testid="scene-icon-${each.id}"]`);
      const box = button?.getBoundingClientRect();
      if (box === undefined) continue;
      if (document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest("button") === button)
        return each.id;
    }
    return null;
  }, info.icons);
  expect(icon).not.toBeNull();
  await page.getByTestId(`scene-icon-${icon ?? ""}`).click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.selection?.())).toEqual([icon]);
  // The preview: the front camera selected, pictures of its view in the inset, and the canvas keeps the frame.
  await expect(page.getByTestId("scene-camera-preview")).toBeHidden();
  await page.evaluate(() => globalThis.__scenity?.select?.(["front"]));
  await expect(page.getByTestId("scene-camera-preview")).toBeVisible();
  // The caption names the camera entity (not its ID), and it follows a rename.
  const caption = page.getByTestId("scene-camera-preview").locator("figcaption");
  await expect(caption).toContainText("Front camera");
  await page.evaluate(() => globalThis.__scenity?.command?.("entity.rename", { entity: "front", name: "Door view" }));
  await expect(caption).toContainText("Door view");
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("entity.rename", { entity: "front", name: "Front camera" }),
  );
  await expect(caption).toContainText("Front camera");
  await expect.poll(async () => (await viewport(page)).preview.pictures).toBeGreaterThan(0);
  const shown = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="scene-camera-preview-canvas"]');
    const data = canvas?.getContext("2d")?.getImageData(0, 0, canvas.width, canvas.height).data ?? [];
    let lit = 0;
    for (let index = 0; index < data.length; index += 4) if ((data[index] ?? 0) + (data[index + 1] ?? 0) > 40) lit += 1;
    return { width: canvas?.width ?? 0, lit };
  });
  expect(shown.width).toBe(320);
  expect(shown.lit).toBeGreaterThan(1000);
  const first = await sceneCanvasShot(page);
  const count = (await viewport(page)).preview.pictures;
  await expect.poll(async () => (await viewport(page)).preview.pictures, { timeout: 10_000 }).toBeGreaterThan(count);
  expect((await sceneCanvasShot(page)).equals(first)).toBe(true);
  expect((await viewport(page)).camera).toBe("top");
});

test("the overlays dock to the edges, fold, and keep their places after a reload", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the viewport spec runs in Chromium");
  await open(page);
  const overlay = (id: string) => page.getByTestId(`overlay-${id}`);
  const edgeOf = (id: string) => overlay(id).getAttribute("data-edge");
  for (const id of ["view", "grid", "cameras", "orientation", "stats", "tools", "tool-settings"]) {
    await expect(overlay(id)).toBeVisible();
  }
  // The controls of the bar are in the overlays.
  await expect(overlay("view").getByTestId("scene-view-mode")).toBeVisible();
  await expect(overlay("cameras").getByTestId("scene-camera-menu")).toBeVisible();
  // A tool of the overlay does what the tool of the toolbar does.
  await page.getByTestId("overlay-tool-translate").click();
  await expect(page.getByTestId("gizmo-mode-translate")).toHaveAttribute("aria-pressed", "true");
  await expect(page.getByTestId("overlay-tool-translate")).toHaveAttribute("aria-pressed", "true");
  // Dock by the menu of the overlay, fold by its title, hide by the overlay menu (the backtick key).
  await page.getByTestId("overlay-stats-menu").click();
  await page.getByTestId("overlay-stats-dock-top").click();
  expect(await edgeOf("stats")).toBe("top");
  await page.getByTestId("overlay-cameras-fold").click();
  await expect(overlay("cameras")).toHaveAttribute("data-folded", "");
  const free = await freePoint(page);
  await page.mouse.click(free.x, free.y);
  await page.keyboard.press("Backquote");
  await page.getByTestId("overlay-menu-orientation").click();
  await expect(overlay("orientation")).toBeHidden();
  await page.keyboard.press("Escape");
  // A drag of the head docks the overlay to the nearest edge.
  const head = await overlay("tools").locator("header").boundingBox();
  const view = await page.getByTestId("scene-view").boundingBox();
  if (head === null || view === null) throw new Error("no boxes");
  await page.mouse.move(head.x + head.width - 4, head.y + head.height / 2);
  await page.mouse.down();
  await page.mouse.move(view.x + view.width - 10, view.y + view.height / 2, { steps: 8 });
  await page.mouse.up();
  expect(await edgeOf("tools")).toBe("right");
  // The places stay after a reload.
  await open(page);
  expect(await edgeOf("stats")).toBe("top");
  expect(await edgeOf("tools")).toBe("right");
  await expect(overlay("cameras")).toHaveAttribute("data-folded", "");
  await expect(overlay("orientation")).toBeHidden();
});

test("the six views and the projection switch work by mouse and by key", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the viewport spec runs in Chromium");
  await open(page);
  /** The direction from the target to the editor camera, rounded. */
  const side = async (): Promise<number[]> => {
    const info = await viewport(page);
    if (info.position === null || info.target === null) throw new Error("no editor camera");
    const offset = info.position.map((value, index) => value - (info.target?.[index] ?? 0));
    const length = Math.hypot(...offset);
    return offset.map((value) => Math.round((value / length) * 10) / 10 + 0);
  };
  const free = await freePoint(page);
  await page.mouse.click(free.x, free.y);
  const keys: [string, number[]][] = [
    ["Alt+1", [0, 0, 1]],
    ["Alt+Shift+1", [0, 0, -1]],
    ["Alt+3", [1, 0, 0]],
    ["Alt+Shift+3", [-1, 0, 0]],
    ["Alt+7", [0, 1, 0]],
    ["Alt+Shift+7", [0, -1, 0]],
  ];
  for (const [key, expected] of keys) {
    await page.keyboard.press(key);
    await expect.poll(side).toEqual(expected);
    expect((await viewport(page)).camera).toBe("editor");
  }
  // By mouse: the ends of the axes of the Orientation overlay. An axis along the view shows its two ends at the centre,
  // so each click goes to an axis across the view of the click before it.
  const ends: [string, number[]][] = [
    ["orientation-x", [1, 0, 0]],
    ["orientation-y", [0, 1, 0]],
    ["orientation-z", [0, 0, 1]],
    ["orientation--x", [-1, 0, 0]],
    ["orientation--y", [0, -1, 0]],
    ["orientation--z", [0, 0, -1]],
  ];
  for (const [testid, expected] of ends) {
    await page.getByTestId(testid).click();
    await expect.poll(side).toEqual(expected);
  }
  // The projection: the key and the button of the overlay.
  const before = await sceneCanvasShot(page);
  await page.mouse.click(free.x, free.y);
  await page.keyboard.press("Alt+5");
  await expect.poll(async () => (await viewport(page)).projection).toBe("orthographic");
  await expect(page.getByTestId("orientation-projection")).toHaveText("Ortho");
  await page.evaluate(() => globalThis.__scenity?.frame());
  expect((await sceneCanvasShot(page)).equals(before)).toBe(false);
  await page.getByTestId("orientation-projection").click();
  await expect.poll(async () => (await viewport(page)).projection).toBe("perspective");
});
