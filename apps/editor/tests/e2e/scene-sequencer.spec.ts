// SPDX-License-Identifier: Apache-2.0
// The sequencer of the scene page: the test keys a transform at two times and plays it. The spec uses a copy of the
// showroom with a new empty sequence. The record mode keys two drags of the table at 0 ms and at 2000 ms, and the base
// scene stays. The frame at 1000 ms shows the table between the two keys, and a play moves it. Save writes the
// sequence file, so a reload plays the same keys. The spec starts the dev server of the scene page on a temp folder,
// so the files of the repository never change. Run it alone under the GPU lock:
//   bunx --bun playwright test scene-sequencer --project=chromium --workers=1
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { LABS_ROOT } from "./builds";
import { startSpecServer, type SpecServer } from "./specServer";

const SHOWROOM = join(LABS_ROOT, "../../samples/showroom");
const SCENE = "scenes/main.scene.json";
const SEQUENCE = "sequences/edit.sequence.json";
const READY = { timeout: 60_000 };
const EMPTY = { format: "scenity.sequence/1", id: "edit", scene: "main", duration: 4000, tracks: [] };

test.describe.configure({ mode: "serial", timeout: 180_000 });

let dir = "";
let origin = "";
let server: SpecServer | null = null;
/** The key of the project in the page URLs. */
let key = "";

test.beforeAll(async ({ browserName }) => {
  if (browserName !== "chromium") return;
  dir = mkdtempSync(join(tmpdir(), "scenity-scene-sequencer-"));
  for (const part of ["assets", "build", "rights", "scenes", "scenity.project.json"]) {
    cpSync(join(SHOWROOM, part), join(dir, part), { recursive: true });
  }
  mkdirSync(join(dir, "sequences"));
  writeFileSync(join(dir, SEQUENCE), JSON.stringify(EMPTY));
  server = await startSpecServer({ seq: dir });
  origin = server.origin;
  key = server.keys.seq ?? "";
});

test.beforeEach(async ({ context }) => {
  await server?.signIn(context);
});

test.afterAll(async () => {
  await server?.stop();
  if (dir !== "") rmSync(dir, { recursive: true, force: true });
});

/** Open the copy in the edit mode with the sequence at 0 ms, paused, and show the sequencer tab. */
async function open(page: Page): Promise<void> {
  await page.goto(
    `${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json&sequence=${SEQUENCE}&t=0&paused=1`,
  );
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  await page.getByTestId("dock-tab-timeline").click();
  await expect(page.getByTestId("sequencer")).toBeVisible();
}

/** A canvas point (CSS pixels) on an entity: the first point of a grid where the pick finds it. */
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

/** Drag an entity by `dx` CSS pixels to the right and wait for the end of the drag. */
async function drag(page: Page, id: string, dx: number): Promise<void> {
  const start = await pointOn(page, id);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-drag", id);
  await page.mouse.move(start.x + dx, start.y, { steps: 8 });
  await page.mouse.up();
  await expect(page.getByTestId("scene-view")).not.toHaveAttribute("data-drag", id);
  await page.evaluate(() => globalThis.__scenity?.frame());
}

/** The position of an entity in the frame now (the inspect report of the core) and the time of that frame. */
async function shown(page: Page, id: string): Promise<{ at: number[]; t: number | null }> {
  return page.evaluate(async (entity) => {
    await globalThis.__scenity?.frame();
    const report = await globalThis.__scenity?.inspect?.();
    const found = report?.entities.find((item) => item.id === entity);
    return { at: [...(found?.transform.position ?? [])], t: report?.simMs ?? null };
  }, id);
}

/** The keys of the transform track of the table. */
function tableKeys(page: Page): Promise<{ t: number; position?: number[] }[]> {
  return page.evaluate(() => {
    const track = globalThis.__scenity?.sequence?.().tracks.find((item) => item.kind === "transform");
    return (track?.keys ?? []) as { t: number; position?: number[] }[];
  });
}

function mix(a: readonly number[], b: readonly number[], share: number): number[] {
  return a.map((value, index) => value + ((b[index] ?? value) - value) * share);
}

function expectClose(actual: readonly number[], expected: readonly number[], digits = 3): void {
  expect(actual).toHaveLength(expected.length);
  expected.forEach((value, index) => expect(actual[index]).toBeCloseTo(value, digits));
}

test("records a transform at two times, plays it, saves it, and a reload plays the same keys", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const base = readFileSync(join(dir, SCENE), "utf8");
  await page.getByTestId("sequencer-record").click();
  await expect(page.getByTestId("sequencer")).toHaveAttribute("data-recording", "1");
  // The first key at 0 ms, the second at 2000 ms.
  await drag(page, "table", 120);
  await page.evaluate(() => globalThis.__scenity?.seek?.(2000));
  await expect(page.getByTestId("sequencer")).toHaveAttribute("data-time", "2000");
  await drag(page, "table", 140);
  const keys = await tableKeys(page);
  expect(keys.map((key) => key.t)).toEqual([0, 2000]);
  const [first, second] = keys.map((key) => key.position ?? []);
  if (first === undefined || second === undefined) throw new Error("no keys");
  expect(second[0]).toBeGreaterThan((first[0] ?? 0) + 0.05);
  await expect(page.getByTestId("sequencer-key-0-1")).toBeVisible();
  // The base scene stays: the document of the page has the place of the file.
  const doc = await page.evaluate(() => globalThis.__scenity?.document().entities.table?.components.transform);
  expect(doc).toEqual({ position: [1.6, 0, -0.9] });
  // The frame between the keys shows the table between them.
  await page.evaluate(() => globalThis.__scenity?.seek?.(1000));
  expectClose((await shown(page, "table")).at, mix(first, second, 0.5));
  // A play moves the table; the frame of the time where it stops is the mix of that time.
  await page.evaluate(() => globalThis.__scenity?.seek?.(0));
  await page.getByTestId("sequencer-play").click();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.time?.() ?? 0)).toBeGreaterThan(400);
  await page.getByTestId("sequencer-play").click();
  const played = await shown(page, "table");
  const share = Math.min(1, (played.t ?? 0) / 2000);
  expect(share).toBeGreaterThan(0);
  expectClose(played.at, mix(first, second, share), 2);
  // Save writes the sequence file; the scene file stays.
  await page.getByTestId("scene-save").click();
  await expect(page.getByTestId("scene-state")).toHaveText("saved");
  expect(readFileSync(join(dir, SCENE), "utf8")).toBe(base);
  const file = JSON.parse(readFileSync(join(dir, SEQUENCE), "utf8")) as typeof EMPTY & { tracks: unknown[] };
  // The canonical writer rounds a number to its shortest form: the keys of the file are the keys of the page, rounded.
  const saved = (file.tracks[0] as { keys?: { t: number; position?: number[] }[] } | undefined)?.keys ?? [];
  expect(file.tracks).toEqual([{ kind: "transform", entity: "table", keys: saved }]);
  expect(saved.map((key) => key.t)).toEqual(keys.map((key) => key.t));
  saved.forEach((key, index) => expectClose(key.position ?? [], keys[index]?.position ?? [], 9));
  await page.reload();
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  expect(await tableKeys(page)).toEqual(saved);
  await page.evaluate(() => globalThis.__scenity?.seek?.(1000));
  expectClose((await shown(page, "table")).at, mix(first, second, 0.5));
});

test("the clock keys also work from the clock of the toolbar, with no Timeline panel", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.goto(
    `${origin}/scene.html?project=${key}&camera=front&edit=1&scene=scenes/main.scene.json&sequence=${SEQUENCE}&t=0&paused=1`,
  );
  await expect(page.getByTestId("scene-view")).toHaveAttribute("data-ready", "1", READY);
  const clock = page.getByTestId("scene-clock");
  await expect(clock).toBeVisible();
  const time = () => page.evaluate(() => globalThis.__scenity?.time?.() ?? -1);
  const field = clock.getByTestId("clock-time");
  // The time field: type the seconds, then Enter.
  await field.fill("1");
  await field.press("Enter");
  await expect.poll(time).toBe(1000);
  await expect(field).toHaveValue("1.00");
  // Period and comma step 50 ms; the arrows of the toolbar do the same.
  await page.keyboard.press(".");
  await expect.poll(time).toBe(1050);
  await clock.getByTestId("clock-forward").click();
  await expect.poll(time).toBe(1100);
  await page.keyboard.press(",");
  await expect.poll(time).toBe(1050);
  await clock.getByTestId("clock-back").click();
  await expect.poll(time).toBe(1000);
  // [ and ] set the loop, \ clears it; A, B and Clear of the toolbar do the same.
  await page.keyboard.press("[");
  await field.fill("1.5");
  await field.press("Enter");
  await clock.getByTestId("clock-loop-b").click();
  await expect(clock.getByTestId("clock-loop")).toHaveText("Loop 1.00 s to 1.50 s");
  await expect(clock).toHaveAttribute("data-looping", "");
  await page.keyboard.press("\\");
  await expect(clock.getByTestId("clock-loop")).toHaveText("");
  await clock.getByTestId("clock-loop-a").click();
  await page.keyboard.press("]");
  await expect(clock.getByTestId("clock-loop")).toHaveText("Loop 1.50 s to 1.50 s");
  await clock.getByTestId("clock-loop-clear").click();
  await expect(clock.getByTestId("clock-loop-clear")).toBeDisabled();
  // Space plays and pauses; so does the play button of the toolbar.
  await page.keyboard.press("Space");
  await expect(clock.getByTestId("clock-toggle")).toHaveAttribute("aria-pressed", "true");
  await expect.poll(time).toBeGreaterThan(1600);
  await page.keyboard.press("Space");
  await expect(clock.getByTestId("clock-toggle")).toHaveAttribute("aria-pressed", "false");
  await clock.getByTestId("clock-toggle").click();
  await expect(clock.getByTestId("clock-toggle")).toHaveAttribute("aria-pressed", "true");
  await clock.getByTestId("clock-toggle").click();
  await expect(clock.getByTestId("clock-toggle")).toHaveAttribute("aria-pressed", "false");
  // The speed of the clock, and To the start.
  await clock.getByTestId("clock-speed").selectOption("2");
  await expect(clock.getByTestId("clock-speed")).toHaveValue("2");
  await clock.getByTestId("clock-start").click();
  await expect.poll(time).toBe(0);
});

test("the Timeline adds a track of each kind with a key, sets the sequence and zooms", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  const tracks = () =>
    page.evaluate(() =>
      (globalThis.__scenity?.sequence?.().tracks ?? []).map((track) => ({
        kind: track.kind,
        keys: track.keys,
      })),
    );
  const start = (await tracks()).length;
  // One track of each kind: an entity track names its entity; a camera, an event and an action track do not.
  const kinds: [string, string, string?][] = [
    ["transform", "shelf"],
    ["property", "sun", "light/intensity"],
    ["visibility", "lantern"],
    ["animation", "armchair"],
    ["attach", "ottoman"],
    ["audio", "lantern"],
    ["camera", ""],
    ["event", ""],
    ["action", ""],
  ];
  await page.evaluate(() => globalThis.__scenity?.seek?.(500));
  for (const [index, [kind, entity, path]] of kinds.entries()) {
    await page.getByTestId("sequencer-track-kind").selectOption(kind);
    if (entity !== "") await page.getByTestId("sequencer-track-entity").selectOption(entity);
    if (path !== undefined) await page.getByTestId("sequencer-track-path").fill(path);
    await page.getByTestId("sequencer-add-track").click();
    await expect.poll(async () => (await tracks()).length).toBe(start + index + 1);
    // "+" adds a key at the time of the clock, with a first value for a kind with no value of the frame.
    await page.getByTestId(`sequencer-key-add-${String(start + index)}`).click();
    await expect.poll(async () => (await tracks())[start + index]?.keys.length).toBe(1);
  }
  expect((await tracks()).slice(start).map((track) => track.kind)).toEqual(kinds.map(([kind]) => kind));
  expect((await tracks())[start + 6]?.keys[0]).toEqual({ t: 500, camera: "entity:front" });
  // The key form: an event name and an action with its arguments.
  await page.getByTestId(`sequencer-key-${String(start + 7)}-0`).click();
  const form = page.getByTestId("sequencer-key-form");
  await expect(form).toHaveAttribute("data-kind", "event");
  await form.getByTestId("sequencer-key-field-name").fill("door.open");
  await form.getByTestId("sequencer-key-t").fill("800");
  await form.getByTestId("sequencer-key-apply").click();
  await expect.poll(async () => (await tracks())[start + 7]?.keys[0]).toEqual({ t: 800, name: "door.open" });
  await page.getByTestId(`sequencer-key-${String(start + 8)}-0`).click();
  await form.getByTestId("sequencer-key-field-action").fill("traffic.button");
  await form.getByTestId("sequencer-key-field-args").fill('{"lane":2}');
  await form.getByTestId("sequencer-key-apply").click();
  await expect
    .poll(async () => (await tracks())[start + 8]?.keys[0])
    .toEqual({ t: 500, action: "traffic.button", args: { lane: 2 } });
  // The audio lane has its waveform canvas.
  await expect(page.getByTestId(`sequencer-lane-${String(start + 5)}`).getByTestId("sequencer-wave")).toHaveCount(1);
  // The head: the duration and the loop are steps of the history.
  await page.getByTestId("sequencer-duration").fill("6");
  await page.getByTestId("sequencer-duration").press("Enter");
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.sequence?.().duration)).toBe(6000);
  await page.getByTestId("sequencer-loop").check();
  await expect.poll(() => page.evaluate(() => globalThis.__scenity?.sequence?.().loop)).toBe(true);
  // The zoom: + shows half of the time line, Fit the whole of it.
  const list = page.getByTestId("sequencer-tracks");
  await page.getByTestId("sequencer-zoom-in").click();
  await expect(list).toHaveAttribute("data-to", "4500");
  await expect(list).toHaveAttribute("data-from", "1500");
  await page.getByTestId("sequencer-zoom-fit").click();
  await expect(list).toHaveAttribute("data-from", "0");
  await expect(list).toHaveAttribute("data-to", "6000");
});

test("each ease of the format comes from the curve editor; all curves and Frame all", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const tracks = () => page.evaluate(() => globalThis.__scenity?.sequence?.().tracks ?? []);
  const index = (await tracks()).length;
  await page.getByTestId("sequencer-track-kind").selectOption("property");
  await page.getByTestId("sequencer-track-entity").selectOption("sun");
  await page.getByTestId("sequencer-track-path").fill("light/intensity");
  await page.getByTestId("sequencer-add-track").click();
  await expect.poll(async () => (await tracks()).length).toBe(index + 1);
  // Two keys: the value of the frame at 0 ms, then 3 at 2000 ms.
  await page.evaluate(() => globalThis.__scenity?.seek?.(0));
  await page.getByTestId(`sequencer-key-add-${String(index)}`).click();
  await page.evaluate(() => globalThis.__scenity?.seek?.(2000));
  await page.getByTestId(`sequencer-key-add-${String(index)}`).click();
  await page.getByTestId(`sequencer-key-${String(index)}-1`).click();
  await page.getByTestId("sequencer-key-field-value").fill("3");
  await page.getByTestId("sequencer-key-apply").click();
  const key = async () => ((await tracks())[index]?.keys[1] ?? {}) as { value?: number; ease?: unknown };
  await expect.poll(async () => (await key()).value).toBe(3);
  // The curve of the track; a press on the second point selects it, and the ease bar sets each ease.
  const curve = page.getByTestId("sequencer-curve");
  await curve.getByTestId("sequencer-curve-key-0-1").dispatchEvent("pointerdown", { button: 0, pointerId: 1 });
  await curve.getByTestId("sequencer-curve-key-0-1").dispatchEvent("pointerup", { button: 0, pointerId: 1 });
  const bar = curve.getByTestId("sequencer-ease-bar");
  for (const name of ["step", "linear", "in", "out", "inOut"]) {
    await bar.getByTestId(`sequencer-ease-${name}`).click();
    await expect.poll(async () => (await key()).ease).toBe(name);
    await expect(bar).toHaveAttribute("data-ease", name);
  }
  await bar.getByTestId("sequencer-ease-bezier").click();
  await expect.poll(async () => (await key()).ease).toEqual({ bezier: [0.42, 0, 0.58, 1] });
  // A drag of a tangent handle gives another Bézier.
  const handle = curve.getByTestId("sequencer-ease-handle-0");
  await handle.scrollIntoViewIfNeeded();
  const at = await handle.boundingBox();
  if (at === null) throw new Error("no tangent handle");
  await page.mouse.move(at.x + at.width / 2, at.y + at.height / 2);
  await page.mouse.down();
  await page.mouse.move(at.x + at.width / 2 + 40, at.y + at.height / 2 - 20, { steps: 4 });
  await page.mouse.up();
  await expect.poll(async () => JSON.stringify((await key()).ease)).not.toBe('{"bezier":[0.42,0,0.58,1]}');
  expect(((await key()).ease as { bezier: number[] }).bezier[0]).toBeGreaterThan(0.42);
  // All curves shows the lines of each number track; Frame all fits the keys of the lines.
  await curve.getByTestId("sequencer-curve-all").check();
  await curve.getByTestId("sequencer-curve-frame").click();
  await expect(curve).toHaveAttribute("data-from", "0");
  await expect(curve).toHaveAttribute("data-to", "2100");
});

test("the keys of the inspector only: a key mark adds a track and keys; Record keys an edit", async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const tracks = () => page.evaluate(() => globalThis.__scenity?.sequence?.().tracks ?? []);
  const start = (await tracks()).length;
  await page.evaluate(() => globalThis.__scenity?.select?.(["sun"]));
  const mark = page.getByTestId("field-light-intensity-row-key");
  await page.evaluate(() => globalThis.__scenity?.seek?.(0));
  await expect(mark).toHaveAttribute("data-mark", "none");
  // The mark adds the track and a key of the value at 0 ms.
  await mark.click();
  await expect(mark).toHaveAttribute("data-mark", "key");
  const keys = async () => ((await tracks())[start]?.keys ?? []) as { t: number; value?: unknown }[];
  expect((await tracks())[start]).toMatchObject({ kind: "property", entity: "sun", path: "light/intensity" });
  expect(await keys()).toEqual([{ t: 0, value: 2.2 }]);
  // At 1000 ms the track has no key: Record keys the edit of the field, and the base scene stays.
  await page.evaluate(() => globalThis.__scenity?.seek?.(1000));
  await expect(mark).toHaveAttribute("data-mark", "track");
  await page.getByTestId("inspector-record").click();
  await expect(page.getByTestId("inspector-record")).toHaveAttribute("aria-pressed", "true");
  const field = page.getByTestId("field-light-intensity");
  await field.fill("4");
  await field.press("Enter");
  await expect.poll(keys).toEqual([
    { t: 0, value: 2.2 },
    { t: 1000, value: 4 },
  ]);
  await expect(mark).toHaveAttribute("data-mark", "key");
  const base = await page.evaluate(
    () => (globalThis.__scenity?.document().entities.sun?.components.light as { intensity?: number }).intensity,
  );
  expect(base).toBe(2.2);
  // The field shows the posed value between the keys.
  await page.evaluate(() => globalThis.__scenity?.seek?.(500));
  await expect.poll(async () => Number(await field.inputValue())).toBeCloseTo(3.1, 1);
  await page.getByTestId("inspector-record").click();
});

test("an agent adds a camera move: its keys are ghosts until the owner accepts them", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await page.setViewportSize({ width: 1440, height: 1000 });
  await open(page);
  const tracks = () => page.evaluate(() => globalThis.__scenity?.sequence?.().tracks ?? []);
  const start = (await tracks()).length;
  const move = [
    { t: 0, position: [0, 1.6, 5] },
    { t: 2000, position: [1, 1.8, 3] },
  ];
  const agent = (keys: unknown) =>
    page.evaluate(
      (given) =>
        globalThis.__scenity?.command?.(
          "sequence.track.add",
          { kind: "transform", entity: "front", keys: JSON.stringify(given) },
          // The session of the agent names and colours the ghosts of its keys.
          { by: "claude", actor: { kind: "agent", name: "Cody", colour: "agent-3", session: "s9", turn: 1 } },
        ),
      keys,
    );
  await agent(move);
  // The move waits: the sequence has no new track, and the Timeline shows a ghost track with two ghost keys.
  await expect(page.getByTestId("sequencer-proposals")).toContainText("1 change of an agent waits");
  expect(await tracks()).toHaveLength(start);
  await expect(page.locator(`[data-testid="sequencer-track-${String(start)}"][data-ghost="1"]`)).toHaveCount(1);
  await expect(page.locator(`[data-testid^="sequencer-key-${String(start)}-"][data-ghost="1"]`)).toHaveCount(2);
  const ghost = page.locator(`[data-testid="sequencer-key-${String(start)}-0"]`);
  await expect(ghost).toHaveAttribute("data-actor", "Cody");
  await expect(ghost).toHaveAttribute("title", /proposed by Cody$/);
  // Accept: the keys are keys of the sequence, with no ghost. One undo removes them.
  await page.getByTestId("sequencer-accept-all").click();
  await expect(page.getByTestId("sequencer-proposals")).toHaveCount(0);
  await expect.poll(async () => (await tracks())[start]?.keys).toEqual(move);
  await expect(page.locator('[data-ghost="1"]')).toHaveCount(0);
  expect(await page.evaluate(() => globalThis.__scenity?.undo())).toBe(true);
  await expect.poll(async () => (await tracks()).length).toBe(start);
  // Reject: the owner rejects a second move, and the sequence stays.
  await agent(move);
  await expect(page.getByTestId("sequencer-proposals")).toBeVisible();
  await page.getByTestId("sequencer-reject-all").click();
  await expect(page.getByTestId("sequencer-proposals")).toHaveCount(0);
  expect(await tracks()).toHaveLength(start);
});

test("onion skins of five times show for a moving entity", async ({ page, browserName }) => {
  test.skip(browserName !== "chromium", "the dev server runs for Chromium only");
  await open(page);
  // The table moves from 0 ms to 2000 ms (the keys of the first test, saved in the sequence file).
  expect((await tableKeys(page)).map((key) => key.t)).toEqual([0, 2000]);
  const onion = () => page.evaluate(async () => (await globalThis.__scenity?.inspect?.())?.onion ?? 0);
  await page.evaluate(() => globalThis.__scenity?.seek?.(1000));
  await page.evaluate(() => globalThis.__scenity?.select?.(["table"]));
  await page.evaluate(() => globalThis.__scenity?.command?.("view.onion", { on: true }));
  // Five copies of each mesh of the table.
  await expect.poll(onion, READY).toBeGreaterThan(0);
  expect((await onion()) % 5).toBe(0);
  // A second entity selected as well: no onion skin (one entity only); the switch off removes the copies.
  await page.evaluate(() => globalThis.__scenity?.select?.(["table", "lantern"]));
  await expect.poll(onion).toBe(0);
  await page.evaluate(() => globalThis.__scenity?.select?.(["table"]));
  await expect.poll(onion).toBeGreaterThan(0);
  await page.evaluate(() => globalThis.__scenity?.command?.("view.onion", { on: false }));
  await expect.poll(onion).toBe(0);
});
