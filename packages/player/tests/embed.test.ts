// SPDX-License-Identifier: Apache-2.0
// The embed API of the player over fakes: the plugin input and its schema, the events for the plugin
// systems, the simulation source (recorded and live), the projected points of `watchPoints`, the `pick` event and the
// `time` event, with the document core and with a plugin core.
import { describe, expect, test } from "bun:test";
import { liveSource, recordedSource, type StreamDocument } from "@scenity/scene/sequence";
import type { DocumentClient, DocumentClientOptions } from "@scenity/runtime/documentClient";
import type { InputSchema, PickHit, ProjectedFrame, SceneStats } from "@scenity/runtime/protocol";
import { PLAYER_EVENTS } from "../src/attributes";
import { PlayerEmbed } from "../src/embed";
import { createPlayerWith } from "../src/player";
import type { Player, PlayerOptions, PlayerPick, PlayerPluginCore } from "../src/types";
import { fakeCanvas, fakeDeps, emptyLog } from "./kit";

const SCENE = { format: "scenity.scene/1", id: "room", entities: {} } as const;

/** A light schema: the input is an object with a number `level`. */
const levelSchema: InputSchema<{ level: number }> = {
  safeParse(value) {
    const level = (value as { level?: unknown } | null)?.level;
    if (typeof level === "number") return { success: true, data: { level } };
    return { success: false, error: { issues: [{ path: ["level"], message: "Expected a number" }] } };
  },
};

/** A recorded stream of the plugin `room`: a door opens at 1000 ms and closes at 3000 ms. */
const STREAM: StreamDocument = {
  format: "scenity.stream/1",
  id: "doors",
  plugin: "room",
  duration: 4000,
  samples: [
    { t: 0, set: { door: "closed" } },
    { t: 1000, set: { door: "open" } },
    { t: 3000, set: { door: "closed" } },
  ],
};

/** The calls of the fake client of these tests and its options, so a test can send core events. */
interface Fake {
  options: DocumentClientOptions | null;
  inputs: unknown[];
  points: (readonly string[])[];
  pointers: [number, number, string][];
  loads: number;
  hit: PickHit | null;
  /** The input events of the channel of the client and their `replace` flags. */
  events: [unknown[], boolean][];
}

function fakeFor(fake: Fake) {
  return (_canvas: HTMLCanvasElement, options: DocumentClientOptions): Promise<DocumentClient> => {
    fake.options = options;
    options.link?.({ mode: "main", core: { setInputs: () => undefined } } as never);
    const client: Partial<DocumentClient> = {
      mode: "main",
      setInput: (input) => fake.inputs.push(input),
      load: () => {
        fake.loads += 1;
        return Promise.resolve({ ok: true, entities: 0, warnings: [] });
      },
      patch: () => Promise.resolve({ ok: true, warnings: [] }),
      useCamera: () => Promise.resolve(true),
      pickEntity: () => Promise.resolve(fake.hit),
      setPoints: (refs) => fake.points.push(refs),
      pointer: (x, y, kind) => fake.pointers.push([x, y, kind]),
      setSurface: () => undefined,
      setTier: () => undefined,
      stats: () => Promise.resolve({ mode: "main", frames: 1, assets: "ready" } as SceneStats),
      dispose: () => undefined,
    };
    return Promise.resolve(client as DocumentClient);
  };
}

function newFake(): Fake {
  return { options: null, inputs: [], points: [], pointers: [], loads: 0, hit: null, events: [] };
}

/** A player over the fakes; the press function stands for a press on the canvas. */
function open(options: Omit<PlayerOptions, "scene">, fake: Fake) {
  let press: ((event: { button: number; offsetX: number; offsetY: number }) => void) | null = null;
  const canvas = Object.assign(fakeCanvas(), {
    addEventListener: (type: string, listener: typeof press) => {
      if (type === "pointerdown") press = listener;
    },
  });
  const { deps, manual } = fakeDeps(emptyLog(), {
    createClient: fakeFor(fake),
    inputLink: () => (events, replace) => fake.events.push([[...events], replace]),
  });
  const player = createPlayerWith(canvas, { ...options, scene: SCENE }, deps);
  const pressAt = (x: number, y: number): void => {
    press?.({ button: 0, offsetX: x, offsetY: y });
  };
  return { player, manual, pressAt };
}

function frame(points: ProjectedFrame["points"]): ProjectedFrame {
  return { seq: 1, width: 640, height: 360, points };
}

function collect<T>(player: Player, name: "pick" | "points" | "time"): T[] {
  const out: T[] = [];
  player.on(name, (detail) => out.push(detail as T));
  return out;
}

describe("the plugin input of the player", () => {
  test("the schema checks the input; a refused input keeps the input before it; null removes it", async () => {
    const fake = newFake();
    const { player } = open({ schemas: { room: levelSchema } }, fake);
    await player.ready;
    expect(player.setInput("room", { level: 2 })).toEqual({ ok: true });
    expect(fake.inputs.at(-1)).toEqual({ room: { level: 2 } });
    const refused = player.setInput("room", { level: "high" });
    expect(refused).toEqual({
      ok: false,
      problems: [{ plugin: "room", path: "/level", message: "Expected a number" }],
    });
    expect(fake.inputs.at(-1)).toEqual({ room: { level: 2 } });
    // A plugin with no schema in the player: the core checks its input.
    expect(player.setInput("doors", { open: true }).ok).toBe(true);
    expect(fake.inputs.at(-1)).toEqual({ doors: { open: true }, room: { level: 2 } });
    player.setInput("room", null);
    expect(fake.inputs.at(-1)).toEqual({ doors: { open: true } });
  });

  test("an input before the first frame goes to the core with the load", async () => {
    const fake = newFake();
    const { player } = open({}, fake);
    player.setInput("room", { level: 1 });
    await player.ready;
    expect(fake.inputs[0]).toEqual({ room: { level: 1 } });
  });
});

describe("the events of the player", () => {
  test("send checks the event, gives it the clock time and sends it over the input channel", async () => {
    const fake = newFake();
    const { player } = open({ source: recordedSource(STREAM) }, fake);
    // An event before the first frame goes to the core with the client.
    expect(player.send({ kind: "press", action: "doors.open" }).ok).toBe(true);
    await player.ready;
    expect(fake.events).toEqual([[[{ t: 0, kind: "press", action: "doors.open" }], false]]);
    await player.seek(1500);
    expect(player.send({ kind: "press", action: "Doors" }).ok).toBe(false);
    expect(player.send({ kind: "hold" as "press", action: "doors.open" }).ok).toBe(false);
    expect(player.send({ kind: "press", action: "doors.open", point: [1, Number.NaN, 0] }).ok).toBe(false);
    const sent = player.send({ kind: "release", action: "doors.open", entity: "door", point: [1, 2, 3] });
    expect(sent).toEqual({ ok: true });
    expect(fake.events.at(-1)).toEqual([
      [{ t: 1500, kind: "release", action: "doors.open", entity: "door", point: [1, 2, 3] }],
      false,
    ]);
    expect(player.events.map((event) => event.t)).toEqual([0, 1500]);
    // The events are not a part of the plugin input.
    expect(fake.inputs.at(-1)).toEqual({ room: { door: "open" } });
  });
});

describe("the simulation source of the player", () => {
  test("a recorded source with no sequence gives the time line; the input changes with its samples", async () => {
    const fake = newFake();
    const { player, manual } = open({ source: recordedSource(STREAM), start: 500 }, fake);
    const times = collect<{ t: number; playing: boolean }>(player, "time");
    await player.ready;
    expect(player.duration).toBe(4000);
    expect(fake.inputs).toEqual([{ room: { door: "closed" } }]);
    player.play();
    const sent = fake.inputs.length;
    manual.advance(100);
    // No new sample: the play step sends no input.
    expect(fake.inputs.length).toBe(sent);
    manual.advance(500);
    expect(fake.inputs.at(-1)).toEqual({ room: { door: "open" } });
    expect(times.at(-1)).toEqual({ t: 1100, playing: true });
    await player.seek(3500);
    expect(fake.inputs.at(-1)).toEqual({ room: { door: "closed" } });
    expect(times.at(-1)).toEqual({ t: 3500, playing: false });
  });

  test("a live source moves the clock to the time of each push, and each push sends its input", async () => {
    const fake = newFake();
    const source = liveSource<{ hr: number }>({ id: "room" });
    const { player } = open({}, fake);
    await player.ready;
    player.setSource(source);
    source.push(12_000, { hr: 80 });
    expect(player.time).toBe(12_000);
    expect(player.playing).toBe(true);
    expect(fake.inputs.at(-1)).toEqual({ room: { hr: 80 } });
    source.push(12_050, { hr: 82 });
    expect(fake.inputs.at(-1)).toEqual({ room: { hr: 82 } });
    player.setSource(null);
    source.push(13_000, { hr: 90 });
    expect(fake.inputs.at(-1)).toEqual(null);
  });
});

describe("the points and the picks of the player", () => {
  test("the document core: watchPoints sets the references, and a frame gives the points event", async () => {
    const fake = newFake();
    const { player, pressAt } = open({}, fake);
    const points = collect<ProjectedFrame>(player, "points");
    const picks = collect<PlayerPick>(player, "pick");
    await player.ready;
    player.watchPoints(["entity:cart", "entity:cart#top", "entity:cart"]);
    expect(fake.points).toEqual([["entity:cart", "entity:cart#top"]]);
    fake.options?.onAnchors?.(frame([{ id: "entity:cart#top", at: [10, 20, 0.5], visible: true }]));
    expect(points).toEqual([frame([{ id: "entity:cart#top", at: [10, 20, 0.5], visible: true }])]);
    fake.hit = { entity: "cart", component: null, target: null, sub: "entity:cart#top", point: [1, 2, 3], distance: 4 };
    pressAt(12, 34);
    await Promise.resolve();
    await Promise.resolve();
    expect(picks).toEqual([{ x: 12, y: 34, entity: "cart", sub: "top", point: [1, 2, 3] }]);
  });

  test("a plugin core: its client and worker, its input as it is, its points by reference, its hits as picks", async () => {
    const fake = newFake();
    const core: PlayerPluginCore = {
      plugin: "room",
      input: levelSchema,
      workerUrl: "/assets/roomWorker.js",
      createClient: fakeFor(fake),
      refOf: (id) => (id === "lamp" ? null : `entity:member-${id}`),
    };
    const { player, pressAt } = open({ core }, fake);
    const points = collect<ProjectedFrame>(player, "points");
    const picks = collect<PlayerPick>(player, "pick");
    expect(player.setInput("room", { level: "x" }).ok).toBe(false);
    expect(player.setInput("room", { level: 3 }).ok).toBe(true);
    expect(player.send({ kind: "press", action: "room.tap" })).toEqual({
      ok: false,
      problems: [{ plugin: "room", path: "", message: "the plugin core takes no events" }],
    });
    await player.ready;
    expect(fake.events).toEqual([]);
    expect(fake.options?.workerUrl).toBe("/assets/roomWorker.js");
    expect(fake.loads).toBe(0);
    expect(fake.inputs).toEqual([{ level: 3 }]);
    // The clock of a plugin core goes with its client: a seek sends no input when it did not change.
    await player.seek(100);
    expect(fake.inputs).toHaveLength(1);
    player.watchPoints(["entity:member-ada"]);
    expect(fake.points).toEqual([]);
    fake.options?.onAnchors?.(
      frame([
        { id: "ada", at: [5, 6, 0], visible: true },
        { id: "sam", at: [7, 8, 0], visible: true },
        { id: "lamp", at: [1, 1, 0], visible: true },
      ]),
    );
    expect(points.at(-1)?.points).toEqual([{ id: "entity:member-ada", at: [5, 6, 0], visible: true }]);
    pressAt(40, 50);
    expect(fake.pointers).toEqual([[40, 50, "down"]]);
    fake.options?.onHit?.("sam", "down");
    fake.options?.onHit?.("sam", "move");
    expect(picks).toEqual([{ x: 40, y: 50, entity: "member-sam", sub: null, point: null }]);
  });
});

describe("the events of a plugin core", () => {
  test("a plugin core with sendEvents gets the events of send, also those before its first frame", async () => {
    const fake = newFake();
    const got: [unknown[], boolean][] = [];
    const core: PlayerPluginCore = {
      plugin: "room",
      workerUrl: null,
      createClient: fakeFor(fake),
      sendEvents: (_client, events, replace) => got.push([[...events], replace]),
    };
    const { player } = open({ core, source: recordedSource(STREAM) }, fake);
    expect(player.send({ kind: "press", action: "room.tap" })).toEqual({ ok: true });
    await player.ready;
    expect(got).toEqual([[[{ t: 0, kind: "press", action: "room.tap" }], false]]);
    await player.seek(200);
    player.send({ kind: "release", action: "room.tap", entity: "lamp" });
    expect(got.at(-1)).toEqual([[{ t: 200, kind: "release", action: "room.tap", entity: "lamp" }], false]);
    expect(fake.events).toEqual([]);
  });
});

describe("the embedding state alone", () => {
  test("no input, no source and no event: the message is null", () => {
    const embed = new PlayerEmbed(null);
    expect(embed.message(0, null)).toEqual({ value: null, changed: true });
    expect(embed.message(0, null)).toEqual({ value: null, changed: false });
    expect(embed.points(frame([]))).toBeNull();
  });

  test("the order of the parts: page input, then the source, then the simulation", () => {
    const embed = new PlayerEmbed(null);
    embed.setInput("room", { from: "page" });
    embed.setSource(recordedSource(STREAM));
    expect(embed.message(0, null).value).toEqual({ room: { door: "closed" } });
    expect(embed.message(0, { id: "room", value: { from: "simulation" } }).value).toEqual({
      room: { from: "simulation" },
    });
  });

  test("the element and the Vue component send the events of the embedding API again", () => {
    expect(PLAYER_EVENTS).toContain("pick");
    expect(PLAYER_EVENTS).toContain("points");
    expect(PLAYER_EVENTS).toContain("time");
  });
});
