// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the saved turns. The before and after pictures and the one-row sheets of the turn window go into the state
 * folder. A new store on the same folder (a host restart) lists the turns with their pictures. The lab is a fake
 * surface. The shadow is a fake port that answers `item`, `time` and `sheet`.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { HmrRecord } from "../src/hmr";
import { PictureStore } from "../src/pictures";
import type { Capture, HostEvent, PictureRef, SurfaceState } from "../src/protocol";
import { checkoutHash } from "../src/state";
import type { Surface } from "../src/surfaces";
import type { SurfacePort } from "../src/tools/context";
import { TurnCapture } from "../src/turnCapture";
import { TurnPictureStore, sessionFolder } from "../src/turnPictures";
import { sheetCamera, spread, turnWindow } from "../src/turnSheets";
import { cleanup, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const checkout = tempDir("turn-pictures-checkout");
const state = tempDir("turn-pictures-state");
const roots = [join(checkout, "apps/editor/src")];
const START = "http://127.0.0.1:5400/?take=greet&t=6350&paused=1&camera=side";
afterAll(() => cleanup(checkout, state));

/** The picture store of the host. The turns keep the IDs of their pictures. */
const store = new PictureStore(state);

/** A small picture with a label in its bytes. */
function picture(label: string, simMs: number | null = 6350): Capture {
  return { simMs, width: 640, height: 400, mime: "image/webp", bytes: new TextEncoder().encode(label) };
}

/** The label of a picture of the store, by the ID of its reference. */
function label(ref: PictureRef | null): string | null {
  const stored = ref === null ? null : store.read(ref.id);
  return stored === null ? null : new TextDecoder().decode(stored.bytes);
}

/** The visible frame: before the edit it draws "old", after the update "new". */
function fakeSurface(url = START): { surface: Surface; edited: { value: boolean } } {
  const edited = { value: false };
  const surface: Surface = {
    id: "lab",
    get state(): SurfaceState {
      const server = { status: "ready" as const, port: 5400, error: null };
      return { id: "lab", kind: "scene", label: "Lab", capabilities: ["scene"], checkout, url, server, lastEdit: null };
    },
    lastHmr: null,
    consoleErrors: [],
    call: () => Promise.resolve(null),
    url: () => Promise.resolve(url),
    capture: () => Promise.resolve(picture(edited.value ? "after" : "before")),
    waitForHmr: (): Promise<HmrRecord> => {
      edited.value = true;
      return Promise.resolve({ files: [], at: Date.now(), reloaded: false });
    },
    clearConsole: () => undefined,
  };
  return { surface, edited };
}

/** The shadow frame: the calls and the sheets that it made. */
function fakeShadow(edited: { value: boolean }, item: { from: number; to: number } | null = null) {
  const sheets: unknown[] = [];
  const port: SurfacePort = {
    call: (name, args = []) => {
      if (name === "item") return Promise.resolve(item === null ? null : { scene: { window: item, camera: "chest" } });
      if (name === "time") return Promise.resolve(1000);
      if (name !== "sheet") return Promise.reject(new Error(`unexpected ${name}`));
      sheets.push(args[0]);
      const sheet = picture(edited.value ? "after sheet" : "before sheet", null);
      return Promise.resolve({ ...sheet, width: 1280, height: 260, take: "greet", cameras: ["side"] });
    },
  };
  return { port, sheets };
}

describe("the window of the sheets", () => {
  test("spread and the camera", () => {
    expect(spread(4350, 8350)).toEqual([4350, 5683, 7017, 8350]);
    expect(spread(5, 5)).toEqual([5]);
    expect(sheetCamera(START)).toBe("side");
    expect(sheetCamera("http://x/?view=1,2,3,0,0,0,40")).toBeNull();
    expect(sheetCamera("http://x/?take=greet")).toBe("overview");
  });

  test("the item window, else ±2 s round the time of the URL or the clock", async () => {
    const withItem = fakeShadow({ value: false }, { from: 12_000, to: 15_000 }).port;
    expect(await turnWindow(withItem, `${START}&item=clip_wave_hover`)).toMatchObject({
      from: 12_000,
      to: 15_000,
      source: "item",
      camera: "side",
    });
    const plain = fakeShadow({ value: false }).port;
    expect(await turnWindow(plain, START)).toEqual({
      from: 4350,
      to: 8350,
      times: [4350, 5683, 7017, 8350],
      camera: "side",
      source: "time",
    });
    expect(await turnWindow(plain, "http://x/?take=greet&camera=chest")).toMatchObject({ from: 0, to: 3000 });
  });
});

describe("the saved turns", () => {
  test("a turn saves the before, the after and both sheets; a new store lists them (a host restart)", async () => {
    const { surface, edited } = fakeSurface();
    const shadow = fakeShadow(edited);
    const events: HostEvent[] = [];
    const pictures = new TurnPictureStore(state, store);
    const capture = new TurnCapture({
      surface: () => surface,
      checkout: () => checkout,
      emit: (event) => events.push(event),
      roots: () => roots,
      settleMs: 10,
      pictures,
      store,
      shadow: () => shadow.port,
    });
    let number: (value: number) => void = () => undefined;
    const numbered = new Promise<number>((resolve) => (number = resolve));
    capture.begin("s1", 1, { prompt: "fix the reach", numbered });
    // The turn store gives the number 4 (earlier turns of the session).
    capture.renumber("s1", 4);
    number(4);
    capture.edit("s1", 4, join(roots[0] ?? "", "core/family.ts"));
    await until(() => events.some((event) => event.type === "agent.turn"), 3000, "the after capture");
    await capture.saved("s1");
    const saved = events.filter((event) => event.type === "agent.turnSaved");
    expect(saved.length).toBeGreaterThanOrEqual(4);
    expect(shadow.sheets).toEqual([
      { times: [4350, 5683, 7017, 8350], maxWidth: 1280, cameras: ["side"] },
      { times: [4350, 5683, 7017, 8350], maxWidth: 1280, cameras: ["side"] },
    ]);

    const again = new TurnPictureStore(state, new PictureStore(state));
    const [turn] = again.list(checkout);
    expect(turn).toMatchObject({
      session: "s1",
      turn: 4,
      prompt: "fix the reach",
      files: ["apps/editor/src/core/family.ts"],
      url: START,
      applied: true,
      window: { from: 4350, to: 8350, source: "time" },
    });
    expect([...(turn?.pictures ?? [])].sort()).toEqual(["after", "afterSheet", "before", "beforeSheet"]);
    const shown = again.pictures(checkout, "s1", 4);
    expect([label(shown.before), label(shown.after)]).toEqual(["before", "after"]);
    expect([label(shown.beforeSheet), label(shown.afterSheet)]).toEqual(["before sheet", "after sheet"]);
    expect(shown.afterSheet).toMatchObject({ width: 1280, height: 260, mime: "image/webp", simMs: null });
    expect(() => again.pictures(checkout, "s1", 9)).toThrow("No saved turn 9");
  });

  test("a second session keeps the turns of the first; the store keeps the newest turns only", () => {
    const folder = tempDir("turn-pictures-prune");
    const store = new TurnPictureStore(folder, new PictureStore(folder), { maxTurns: 2 });
    const facts = (session: string, turn: number, started: string) => ({
      ...{ session, turn, prompt: "", started, files: [], url: null },
      ...{ reloaded: false, applied: false, error: null, window: null },
    });
    store.saveFacts(checkout, facts("a", 1, "2026-10-12T22:00:00.000Z"));
    store.saveFacts(checkout, facts("b", 1, "2026-10-12T22:01:00.000Z"));
    expect(store.savePicture(checkout, "a", 1, "before", picture("a1"))?.pictures).toEqual(["before"]);
    expect(store.savePicture(checkout, "c", 1, "before", picture("c1"))).toBeNull();
    expect(store.list(checkout).map((turn) => `${turn.session}${String(turn.turn)}`)).toEqual(["b1", "a1"]);
    store.saveFacts(checkout, facts("a", 2, "2026-10-12T22:02:00.000Z"));
    expect(store.list(checkout).map((turn) => `${turn.session}${String(turn.turn)}`)).toEqual(["a2", "b1"]);
    expect(sessionFolder("")).toBe("none");
    expect(sessionFolder("../x")).toMatch(/^s-[0-9a-f]{16}$/);
  });
  test("a picture of an older host (a file in the turn folder) moves to the picture store at the first read", () => {
    const folder = tempDir("turn-pictures-legacy");
    const pictures = new PictureStore(folder);
    const turns = new TurnPictureStore(folder, pictures);
    turns.saveFacts(checkout, {
      ...{ session: "old", turn: 1, prompt: "", started: "2026-10-12T21:00:00.000Z", files: [], url: null },
      ...{ reloaded: false, applied: false, error: null, window: null },
    });
    const turnFolder = join(folder, "turns", checkoutHash(checkout), "pictures", "old", "1");
    mkdirSync(turnFolder, { recursive: true });
    writeFileSync(join(turnFolder, "before.webp"), "legacy bytes");
    writeFileSync(
      join(turnFolder, "before.json"),
      JSON.stringify({ simMs: 1, width: 2, height: 1, mime: "image/webp" }),
    );
    const shown = turns.pictures(checkout, "old", 1);
    expect(shown.before).toMatchObject({ simMs: 1, width: 2, height: 1, mime: "image/webp" });
    const stored = shown.before === null ? null : pictures.read(shown.before.id);
    expect(stored === null ? null : new TextDecoder().decode(stored.bytes)).toBe("legacy bytes");
    expect(existsSync(join(turnFolder, "before.webp"))).toBe(false);
    expect(turns.pictures(checkout, "old", 1).before?.id).toBe(shown.before?.id);
    cleanup(folder);
  });
});
