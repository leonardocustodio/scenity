// SPDX-License-Identifier: Apache-2.0
// The character setup of the robot on a copy of the pickup scene of the characters sample: the foot lock and the IK
// goals in the inspector, the look variant in the Character setup window, and a handle at the IK target of the look.
// A drag of the handle in the Scene view moves the target (one step of the history). The spec starts the dev server of
// the scene page on a temp folder, so the files of the repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-character --project=chromium --workers=1
import { cpSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const CHARACTERS = join(LABS_ROOT, "../../samples/characters");
const READY = { timeout: 60_000 };

test.describe.configure({ mode: "serial", timeout: 120_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-character-"));
  for (const part of ["assets", "rights", "scenes", "sequences", "scenity.project.json"])
    cpSync(join(CHARACTERS, part), join(dir, part), { recursive: true });
  server = await startSpecServer({ walkers: dir });
  origin = server.origin;
  key = server.keys.walkers ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

async function open(page: Page): Promise<void> {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(`${origin}/scene.html?project=${key}&camera=top&edit=1&scene=scenes/pickup.scene.json&t=0&paused=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-gizmo", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot"]));
}

/** A component of the robot in the document of the page. */
function robot<T>(page: Page, component: string): Promise<T | undefined> {
  return page.evaluate(
    (id) => globalThis.__scenity?.document().entities.robot?.components[id] as T | undefined,
    component,
  );
}

test("the inspector edits the foot lock and the IK goals of the robot", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The foot lock of the sample: two legs, the bone names of the model are the choices.
  const lock = page.getByTestId("field-animator-footLock");
  await expect(lock).toBeVisible(READY);
  await expect(page.getByTestId("field-animator-footLock-leg-0-upper")).toHaveValue("UpperLegL");
  await expect(page.getByTestId("field-animator-footLock-leg-1-follow")).toHaveValue("FootR");
  await expect.poll(() => lock.locator("datalist option").count(), READY).toBeGreaterThan(10);
  await page.getByTestId("field-animator-footLock-fade").fill("0.25");
  await page.getByTestId("field-animator-footLock-fade").press("Tab");
  await expect
    .poll(async () => (await robot<{ footLock: { fade?: number } }>(page, "animator"))?.footLock.fade)
    .toBe(0.25);
  // The look of the sample aims at the cup; the right hand at the grip socket of the cup.
  await expect(page.getByTestId("field-character-ik-look-target")).toHaveValue("cup");
  await expect(page.getByTestId("field-character-ik-rightHand-target-sub")).toHaveValue("grip");
  await page.getByTestId("field-character-ik-look-weight").fill("0.5");
  await page.getByTestId("field-character-ik-look-weight").press("Tab");
  type Ik = { ik: { look: { target: string; weight: number } } };
  await expect
    .poll(async () => (await robot<Ik>(page, "character"))?.ik.look)
    .toEqual({
      target: "entity:cup",
      weight: 0.5,
    });
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(async () => (await robot<Ik>(page, "character"))?.ik.look.weight).toBe(0);
});

test("the Character setup window sets the look variant and moves the IK target in the view", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.character"));
  const panel = page.getByTestId("character-panel");
  await expect(panel).toHaveAttribute("data-entity", "robot", READY);
  // The look variant: a variant of the robot, then the choice in the window.
  await expect(panel.getByTestId("character-variant")).toHaveCount(0);
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("component.set", {
      entity: "robot",
      component: "character",
      field: "variants",
      value: JSON.stringify({ red: {} }),
    }),
  );
  await panel.getByTestId("character-variant").click();
  await page.getByRole("option", { name: "red", exact: true }).click();
  await expect.poll(async () => (await robot<{ variant?: string }>(page, "character"))?.variant).toBe("red");
  await panel.getByTestId("character-variant").click();
  await page.getByRole("option", { name: "None", exact: true }).click();
  await expect.poll(async () => (await robot<{ variant?: string }>(page, "character"))?.variant).toBeUndefined();
  // The handle of the IK target: the cup (the grip socket of the right hand has no handle).
  const toggle = panel.getByTestId("character-ik-handles");
  await expect(toggle).toHaveAttribute("data-handles", "1");
  await toggle.check();
  const handle = page.locator('[data-testid="tool-handle"][data-handle="cup"]');
  await expect(handle).toHaveAttribute("aria-label", "The IK target of Look: Cup");
  const place = () =>
    page.evaluate(
      () =>
        (globalThis.__scenity?.document().entities.cup?.components.transform as { position?: number[] } | undefined)
          ?.position,
    );
  const before = await place();
  const box = await handle.boundingBox();
  if (box === null) throw new Error("the handle has no box");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + 60, box.y + 40, { steps: 6 });
  await page.mouse.up();
  // The cup moves on its level: x and z change, y stays. The move is one step of the history.
  await expect.poll(async () => (await place())?.[0]).not.toBe(before?.[0]);
  expect((await place())?.[1]).toBeCloseTo(before?.[1] ?? 0, 5);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(place).toEqual(before);
  await toggle.uncheck();
  await expect(page.getByTestId("tool-handle")).toHaveCount(0);
});

/** The world points of the bones of the robot in the inspect report of the frame (rounded to 0.1 mm), as text. */
function joints(page: Page): Promise<string> {
  return page.evaluate(async () => {
    const report = await globalThis.__scenity?.inspect?.();
    return JSON.stringify(report?.entities.find((entity) => entity.id === "robot")?.joints ?? null);
  });
}

/** Wait until the bones of the robot stay at the same points for two reports in a row, and give them. */
async function settledJoints(page: Page): Promise<string> {
  let last = await joints(page);
  await expect
    .poll(async () => {
      const next = await joints(page);
      const same = next === last && next !== "null";
      last = next;
      return same;
    }, READY)
    .toBe(true);
  return last;
}

/** A point of the canvas (CSS pixels) where a pick hits the robot, or null. */
function robotPoint(page: Page): Promise<{ x: number; y: number } | null> {
  return page.evaluate(async () => {
    const api = globalThis.__scenity;
    const canvas = document.querySelector("#scene");
    if (api === undefined || canvas === null) return null;
    const box = canvas.getBoundingClientRect();
    for (let y = box.height * 0.2; y < box.height * 0.9; y += 12) {
      for (let x = box.width * 0.2; x < box.width * 0.8; x += 12) {
        if (document.elementFromPoint(box.left + x, box.top + y) !== canvas) continue;
        if ((await api.pick(x, y))?.entity === "robot") return { x, y };
      }
    }
    return null;
  });
}

test("a clip dropped on the timeline plays in the Scene view; Preview plays a clip with no key", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // The main scene with its first sequence (walk-wave): the robot idles at 500 ms.
  await page.goto(
    `${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json&t=500&paused=1`,
  );
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.getByTestId("workspace-animate").click();
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot"]));
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.clips"));
  const panel = page.getByTestId("clips-panel");
  await expect(panel).toHaveAttribute("data-entity", "robot", READY);
  await expect.poll(async () => Number(await panel.getAttribute("data-clips")), READY).toBeGreaterThan(5);
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.timeline"));
  const idle = await settledJoints(page);
  // A drag of the Dance clip onto the lanes at the start of the time line: a new animation track of the robot.
  const dance = panel.locator('[data-testid="clip-row"][data-clip="Dance"]');
  const tracks = page.getByTestId("sequencer-tracks");
  await dance.dragTo(tracks, { targetPosition: { x: 180, y: 48 } });
  type Track = { kind: string; entity?: string; keys: { t: number; clip?: string; name?: string }[] };
  const animation = () =>
    page.evaluate(() =>
      (globalThis.__scenity?.sequence?.().tracks as Track[] | undefined)?.find((track) => track.kind === "animation"),
    );
  await expect.poll(async () => (await animation())?.keys[0]?.name).toBe("Dance");
  expect((await animation())?.entity).toBe("robot");
  expect((await animation())?.keys[0]?.t).toBeLessThan(500);
  // The robot dances at 500 ms: its bones move. Undo removes the track and the robot idles again.
  await expect.poll(async () => (await joints(page)) === idle, READY).toBe(false);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(async () => (await animation()) === undefined).toBe(true);
  await expect.poll(async () => (await joints(page)) === idle, READY).toBe(true);
  // A drop of the Wave clip on the robot in the view: a key at the time of the clock.
  const point = await robotPoint(page);
  if (point === null) throw new Error("no point of the robot in the view");
  const scene = page.getByTestId("scene-view");
  await panel.locator('[data-testid="clip-row"][data-clip="Wave"]').dragTo(scene, { targetPosition: point });
  await expect(scene).toHaveAttribute("data-clip-drop", "robot", READY);
  await expect
    .poll(async () => (await animation())?.keys[0])
    .toEqual({ t: 500, clip: expect.any(String), name: "Wave" });
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(async () => (await animation()) === undefined).toBe(true);
  // Preview plays the Wave clip in the view with no key; Stop ends it.
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.clips"));
  const wave = panel.locator('[data-testid="clip-row"][data-clip="Wave"]');
  await wave.getByTestId("clip-preview").click();
  await expect(wave.getByTestId("clip-preview")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await joints(page)) === idle, READY).toBe(false);
  expect(await animation()).toBeUndefined();
  await wave.getByTestId("clip-preview").click();
  await expect.poll(async () => (await joints(page)) === idle, READY).toBe(true);
});

test("the retarget preview of the Character setup plays a clip of the clip source on the robot", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  // At 2,000 ms the robot of the pickup scene walks. With the Rigify mannequin as its clip source (only an Idle clip,
  // retargeted through the bone map of the robot), the walk state has no clip.
  const scene = "scene=scenes/pickup.scene.json&sequence=sequences/pickup.sequence.json";
  await page.goto(`${origin}/scene.html?project=${key}&camera=front&edit=1&${scene}&t=2000&paused=1`);
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.evaluate(() => globalThis.__scenity?.select?.(["robot"]));
  await page.evaluate(() => globalThis.__scenity?.command?.("panel.open.character"));
  const panel = page.getByTestId("character-panel");
  await expect(panel).toHaveAttribute("data-entity", "robot", READY);
  await page.evaluate(() =>
    globalThis.__scenity?.command?.("component.set", {
      entity: "robot",
      component: "animator",
      field: "clipSource",
      value: JSON.stringify({ asset: "asset:01M518N6P8VF0Z4WYHJHSRFZHB" }),
    }),
  );
  const preview = panel.getByTestId("character-retarget-preview");
  await expect(preview).toBeVisible(READY);
  const before = await settledJoints(page);
  // The preview plays the Idle clip of the mannequin, retargeted onto the robot; Stop gives the pose of before.
  await preview.click();
  await expect(preview).toHaveAttribute("aria-pressed", "true");
  await expect.poll(async () => (await joints(page)) === before, READY).toBe(false);
  await preview.click();
  await expect(preview).toHaveAttribute("aria-pressed", "false");
  await expect.poll(async () => (await joints(page)) === before, READY).toBe(true);
});
