// SPDX-License-Identifier: Apache-2.0
// The play mode of the scene page: an edit during the play mode does not change the document unless the owner keeps
// it. The spec uses a copy of the characters sample. Play runs the sequence from 0 ms (the robot walks, and the gizmo
// follows the posed robot). A gizmo move of the floor in the play mode changes only the play state. Stop restores the
// edit state (the same document, the file as it was, no dirty state, no undo step). A second play, a move and Keep put
// the change into the document as one undo step. "Play in a window" opens the player page and keeps the edit view as
// it is. The spec starts the dev server of the scene page on a temp folder, so the files of the repository never
// change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-play --project=chromium --workers=1
import { cpSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const CHARACTERS = join(LABS_ROOT, "../../samples/characters");
const SCENE = "scenes/main.scene.json";
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 240_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-play-"));
  for (const part of ["assets", "rights", "scenes", "sequences", "scenity.project.json"]) {
    cpSync(join(CHARACTERS, part), join(dir, part), { recursive: true });
  }
  server = await startSpecServer({ play: dir });
  origin = server.origin;
  key = server.keys.play ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy in the edit mode at 0 ms, paused (the sequence is the first one of the project: walk-wave). */
async function open(page: Page): Promise<void> {
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json&t=0&paused=1`);
  const view = page.getByTestId("scene-view");
  await expect(view).toHaveAttribute("data-ready", "1", READY);
  for (const mark of ["data-inspector", "data-gizmo"]) await expect(view).toHaveAttribute(mark, "1", READY);
  await expect(page.getByTestId("play-start")).toBeVisible();
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
  if (found === null) throw new Error(`the handle ${id} is not on the canvas`);
  return found;
}

/** Select an entity, drag the X arrow of its gizmo with a typed value of `metres`, and clear the selection. */
async function moveX(page: Page, id: string, metres: string): Promise<void> {
  await page.evaluate((entity) => globalThis.__scenity?.select?.([entity]), id);
  const start = await handlePoint(page, "x");
  const view = page.getByTestId("scene-view");
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(view).toHaveAttribute("data-gizmo-drag", "x");
  await page.mouse.move(start.x + 40, start.y, { steps: 4 });
  await page.keyboard.type(metres);
  await page.mouse.up();
  await expect(view).not.toHaveAttribute("data-gizmo-drag", "x");
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
}

/** The document of the page as JSON text. */
function documentText(page: Page): Promise<string> {
  return page.evaluate(() => JSON.stringify(globalThis.__scenity?.document()));
}

/** The transform of the floor in the document of the page. */
function floor(page: Page): Promise<unknown> {
  return page.evaluate(() => globalThis.__scenity?.document().entities.floor?.components.transform);
}

/** The x of the robot in the frame now (the inspect report of the core). */
function robotX(page: Page): Promise<number> {
  return page.evaluate(async () => {
    await globalThis.__scenity?.frame();
    const report = await globalThis.__scenity?.inspect?.();
    return report?.entities.find((item) => item.id === "robot")?.transform.position[0] ?? Number.NaN;
  });
}

function time(page: Page): Promise<number> {
  return page.evaluate(() => globalThis.__scenity?.time?.() ?? 0);
}

/** Start the play mode with the button and wait until the clock is past `t`. */
async function playUntil(page: Page, t: number): Promise<void> {
  await page.getByTestId("play-start").click();
  await expect(page.locator("body")).toHaveAttribute("data-play", "1");
  await expect(page.getByTestId("play-stop")).toBeVisible();
  // Play moves the Game view to the front. The edits of the play mode continue in the Scene view (⌘1).
  await expect(page.getByTestId("game-view")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+1");
  // The control fits in the toolbar (the clock group is in its centre): its last button is not clipped.
  const fits = await page.evaluate(() => {
    const bar = document.querySelector(".studio-top")?.getBoundingClientRect();
    const last = document.querySelector('[data-testid="play-window"]')?.getBoundingClientRect();
    return bar !== undefined && last !== undefined && last.right <= bar.right && last.width > 0;
  });
  expect(fits).toBe(true);
  await expect.poll(() => time(page), READY).toBeGreaterThan(t);
}

test("an edit during the play mode leaves the document; stop gives back the edit state; keep is one undo step", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const disk = readFileSync(join(dir, SCENE), "utf8");
  const edit = await documentText(page);
  const editFloor = await floor(page);
  const startX = await robotX(page);
  // Play runs the sequence from 0 ms: the robot walks, and the sounds start (the click on Play is the user gesture).
  await playUntil(page, 2500);
  await expect.poll(() => robotX(page), READY).toBeGreaterThan(startX + 0.5);
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.audioState?.()), READY).toBe("running");
  // The posed view: the gizmo of the selected robot stands on the robot of the frame, not on its base place.
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot"]));
  const gizmoAt = await page.evaluate(() => globalThis.__scenity?.gizmo?.().origin ?? null);
  expect(gizmoAt?.[0] ?? Number.NaN).toBeGreaterThan(startX + 0.5);
  await page.evaluate(() => globalThis.__scenity?.select?.([]));
  // A gizmo move of the floor during the play mode changes the play state only.
  await moveX(page, "floor", "0.5");
  expect(await floor(page)).not.toEqual(editFloor);
  const changes = await page.evaluate(() => globalThis.__scenity?.playMode?.().changes.map((change) => change.id));
  expect(changes).toEqual(["floor/transform"]);
  await expect(page.getByTestId("scene-bar")).toHaveAttribute("data-dirty", "0");
  expect(await page.evaluate(() => globalThis.__scenity?.save().then((result) => result.ok))).toBe(false);
  // Stop: the edit state returns exactly, the file and the dirty state stay, and no undo step stays.
  await page.getByTestId("play-stop").click();
  await expect(page.locator("body")).not.toHaveAttribute("data-play", /./);
  expect(await documentText(page)).toBe(edit);
  expect(await page.evaluate(() => globalThis.__scenity?.file().dirty)).toBe(false);
  await expect(page.getByTestId("scene-bar")).toHaveAttribute("data-dirty", "0");
  expect(await time(page)).toBe(0);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(false);
  expect(readFileSync(join(dir, SCENE), "utf8")).toBe(disk);
  // A second play, a move and Keep: the change goes into the document as one undo step.
  await playUntil(page, 300);
  await moveX(page, "floor", "0.5");
  const moved = await floor(page);
  await page.getByTestId("play-keep").click();
  await expect(page.getByTestId("play-keep-list")).toBeVisible();
  await expect(page.locator('[data-testid="play-change"][data-change="floor/transform"]')).toBeVisible();
  await page.getByTestId("play-keep-apply").click();
  await expect(page.locator("body")).not.toHaveAttribute("data-play", /./);
  expect(await floor(page)).toEqual(moved);
  await expect(page.getByTestId("scene-bar")).toHaveAttribute("data-dirty", "1");
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  expect(await documentText(page)).toBe(edit);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(false);
  expect(await page.evaluate(() => globalThis.__scenity?.redo())).toBe(true);
  expect(await floor(page)).toEqual(moved);
  expect(readFileSync(join(dir, SCENE), "utf8")).toBe(disk);
});

test("play in a window opens the player with the documents now and leaves the edit view", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The draft of the first test: discard it, so the edit view starts from the file.
  const discard = page.getByTestId("draft-discard");
  if (await discard.isVisible()) await discard.click();
  const edit = await documentText(page);
  const popup = page.waitForEvent("popup");
  await page.getByTestId("play-window").click();
  const player = await popup;
  await expect(player.getByTestId("play-stage")).toHaveAttribute("data-state", "ready", READY);
  const played = () =>
    player.evaluate(() => (globalThis as { __scenityPlay?: { readonly time: number } }).__scenityPlay?.time ?? 0);
  await expect.poll(played, READY).toBeGreaterThan(500);
  expect(await page.evaluate(() => globalThis.__scenity?.playMode?.().active)).toBe(false);
  expect(await documentText(page)).toBe(edit);
  await player.close();
});

test("the toolbar works by keyboard: the tools, Play, Pause, Step and the time of the clock", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.(["floor"]));
  const handles = (): Promise<string[]> =>
    page.evaluate(() => Object.keys(globalThis.__scenity?.gizmo?.().handles ?? {}));
  // Q: the View tool shows no gizmo. W: the move gizmo returns. The bar shows the active tool.
  await page.keyboard.press("q");
  await expect(page.getByTestId("gizmo-mode-view")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(handles).toEqual([]);
  await page.keyboard.press("w");
  await expect(page.getByTestId("gizmo-mode-translate")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(handles).toContain("x");
  // Tab goes from tool to tool; Enter chooses the tool with the focus.
  await page.getByTestId("gizmo-mode-translate").focus();
  await page.keyboard.press("Tab");
  await expect(page.getByTestId("gizmo-mode-rotate")).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("gizmo-mode-rotate")).toHaveAttribute("aria-pressed", "true");
  await page.getByTestId("gizmo-mode-rotate").blur();
  // ⌘P plays; ⌘⇧P stops the clock; ⌥⌘P steps one frame; the time field shows the clock.
  const time = page.getByTestId("play-time");
  await page.keyboard.press("ControlOrMeta+p");
  await expect(page.getByTestId("play-stop")).toBeVisible();
  await expect(page.getByTestId("play-pause")).toBeVisible();
  await page.keyboard.press("ControlOrMeta+Shift+p");
  // The field shows the clock again after 100 ms at most.
  await page.waitForTimeout(250);
  const paused = await time.textContent();
  await page.waitForTimeout(300);
  expect(await time.textContent()).toBe(paused);
  await page.keyboard.press("ControlOrMeta+Alt+p");
  await expect.poll(() => time.textContent()).not.toBe(paused);
  await page.getByTestId("play-stop").click();
  await expect(page.getByTestId("play-start")).toBeVisible();
  await expect(page.getByTestId("play-pause")).toBeHidden();
});

test("the Game view plays the scene in the player path; Play brings it to the front; Preferences give the render options", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  const discard = page.getByTestId("draft-discard");
  if (await discard.isVisible()) await discard.click();
  // ⌘2 opens the Game view: the play page of the player in a frame, ready.
  await page.keyboard.press("ControlOrMeta+2");
  const view = page.getByTestId("game-view");
  await expect(view).toBeVisible();
  const stage = page.frameLocator('[data-testid="game-frame"]').getByTestId("play-stage");
  await expect(stage).toHaveAttribute("data-state", "ready", READY);
  // A preset keeps its aspect in the panel; the stats of the player show.
  await view.getByRole("combobox", { name: "Resolution" }).click();
  await page.getByRole("option", { name: "1280 × 720" }).click();
  const frame = view.getByTestId("game-frame");
  await expect(frame).toHaveAttribute("data-resolution", "1280x720");
  const width = Number(await frame.getAttribute("width"));
  const height = Number(await frame.getAttribute("height"));
  expect(width / height).toBeCloseTo(1280 / 720, 1);
  await view.getByTestId("game-stats-switch").check();
  await expect(view.getByTestId("game-stats")).toContainText("fps", READY);
  // The worker switch gives the player a new handoff with worker=0.
  const before = await frame.getAttribute("src");
  await view.getByTestId("game-worker").uncheck();
  await expect.poll(() => frame.getAttribute("src")).toContain("worker=0");
  expect(await frame.getAttribute("src")).not.toBe(before);
  // Play (⌘P) moves the Game view to the front with the documents of the play mode.
  await page.keyboard.press("ControlOrMeta+1");
  const handoff = await frame.getAttribute("src");
  await page.keyboard.press("ControlOrMeta+P");
  await expect.poll(() => frame.getAttribute("src")).not.toBe(handoff);
  await expect(view).toBeVisible();
  await page.keyboard.press("ControlOrMeta+P");
  // A render option of Preferences (no render worker) fills the URL option at the next open.
  await page.evaluate(() =>
    localStorage.setItem(
      "scenity.editor.user",
      JSON.stringify({ format: "scenity.editor/1", render: { worker: false } }),
    ),
  );
  await open(page);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-renderer", "main");
  await page.evaluate(() => localStorage.removeItem("scenity.editor.user"));
});

test("an audio key plays at its time in the play mode; the inspector previews the sound", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 900 });
  await open(page);
  // A press on the canvas is the user gesture that starts the audio context.
  await page.getByTestId("scene-view").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.audioState?.()), READY).toBe("running");
  const sounds = () => page.evaluate(() => [...(globalThis.__scenity?.sounds?.() ?? [])]);
  // The chirp of the robot has its play key at 5,200 ms (0.24 s long) in walk-wave.
  expect(await page.evaluate(() => globalThis.__scenity?.startPlay?.(undefined, { view: "scene" }))).toBeNull();
  await expect.poll(async () => (await sounds()).length, { timeout: 30_000 }).toBeGreaterThan(0);
  const [first] = await sounds();
  expect(first).toMatchObject({ entity: "robot" });
  expect(first?.t ?? 0).toBeGreaterThanOrEqual(5200);
  expect(first?.t ?? 0).toBeLessThan(5440);
  await page.evaluate(() => globalThis.__scenity?.stopPlay?.());
  // The inspector plays the sound of the robot once; a second press stops it.
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot"]));
  const preview = page.getByTestId("field-audioSource-asset-row-preview");
  await preview.click();
  await expect(preview).toHaveAttribute("data-playing", "1");
  await preview.click();
  await expect(preview).toHaveAttribute("data-playing", "0");
});

test("the animator of the characters sample can be edited and previewed", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot"]));
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.animator"));
  const panel = page.getByTestId("animator-panel");
  await expect(panel).toHaveAttribute("data-entity", "robot");
  const controller = () =>
    page.evaluate(
      () =>
        (
          globalThis.__scenity?.document().entities.robot?.components.animator as {
            controller: {
              parameters?: Record<string, unknown>;
              layers: { states: Record<string, unknown>; transitions?: unknown[] }[];
            };
          }
        ).controller,
    );
  // A parameter, a state that plays the Yes clip, and a transition from idle on the parameter: one step each.
  await panel.getByTestId("animator-new-parameter").fill("nod");
  await panel.getByRole("combobox", { name: "The type of the new parameter" }).selectOption("bool");
  await panel.getByTestId("animator-add-parameter").click();
  await expect.poll(async () => (await controller()).parameters?.nod).toEqual({ type: "bool", default: false });
  await panel.getByTestId("animator-new-state").fill("yes");
  await panel.getByRole("combobox", { name: "The clip of the new state" }).click();
  await page.getByRole("option", { name: "Yes", exact: true }).click();
  await panel.getByTestId("animator-add-state").click();
  await expect
    .poll(async () => (await controller()).layers[0]?.states.yes)
    .toEqual({ motion: { kind: "clip", clip: "Yes" } });
  await panel.getByRole("combobox", { name: "From" }).click();
  await page.getByRole("option", { name: "idle", exact: true }).click();
  await panel.getByRole("combobox", { name: "To" }).click();
  await page.getByRole("option", { name: "yes", exact: true }).click();
  await panel.getByTestId("animator-add-transition").click();
  // The row of the new transition shows after the change is in the document.
  await expect
    .poll(async () => JSON.stringify((await controller()).layers[0]?.transitions?.at(-1)))
    .toBe('{"from":"idle","to":"yes"}');
  const last = panel.locator('[data-testid="animator-transition"][data-transition="idle>yes"]');
  await expect(last).toHaveCount(1);
  const conditions = last.getByTestId("animator-conditions");
  await conditions.fill('[{"parameter":"nod","op":"eq","value":true}]');
  await conditions.press("Enter");
  await conditions.blur();
  await expect
    .poll(async () => JSON.stringify((await controller()).layers[0]?.transitions?.at(-1)))
    .toBe('{"from":"idle","to":"yes","when":[{"parameter":"nod","op":"eq","value":true}]}');
  // The preview: with nod on, the robot plays the yes state at 500 ms (it stands until 1000 ms in walk-wave).
  await page.evaluate(() => globalThis.__scenity?.seek?.(500));
  const state = (name: string) => panel.locator(`[data-testid="animator-state"][data-state="${name}"]`);
  await expect(state("idle")).toHaveAttribute("data-active", "1", READY);
  await panel.locator('[data-parameter="nod"]').getByTestId("animator-parameter-value").check();
  await expect(state("yes")).toHaveAttribute("data-active", "1", READY);
});
