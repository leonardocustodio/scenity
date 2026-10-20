// SPDX-License-Identifier: Apache-2.0
// The input events of the play mode in the document core. An event applies at the first system step at or after its
// time, never at the time that the message comes. A late event makes the steps run again. A seek after a recording
// gives the frame of the live play. A simulation reduces the events as action keys. The plugin host checks the input
// actions, and the worker message "inputs" goes to the core. Three.js runs with no GPU.
import { describe, expect, it } from "bun:test";
import { Texture } from "three";
import { defineComponent, vec3Schema, type SceneDocument } from "@scenity/scene";
import { ACTION_PATTERN, defineSimulation, type InputEvent, type SequenceDocument } from "@scenity/scene/sequence";
import { DocumentCore } from "../src/core/documentCore";
import { stepTime } from "../src/core/systemSteps";
import {
  defineInputMap,
  defineRuntimePlugin,
  INPUT_ACTION_PATTERN,
  keyActions,
  PluginHost,
  pointerActions,
  type RuntimePlugin,
} from "../src/plugins";
import { defineSystem } from "../src/systems/index";
import { handleDocumentMessage, type InputsMessage } from "../src/worker/documentMessages";
import { coreOptions } from "./pickHelpers";
import { FakeAssets } from "./sceneHelpers";

const turnComponent = defineComponent({
  id: "turn.speed",
  schema: vec3Schema,
  defaults: [0, 90, 0],
  editor: { label: "Turn", fields: {} },
});

/** The memory of the test system: the angle, the speed factor and the stop flag. */
interface TurnMemory {
  readonly angle: number;
  readonly factor: number;
  readonly stopped: boolean;
}

/** A system that turns the wheel at 90 degrees per second. The input events toggle it and change its speed. */
function turnSystem() {
  let memory: TurnMemory = { angle: 0, factor: 1, stopped: false };
  return defineSystem<unknown, TurnMemory>({
    id: "turn.wheel",
    order: 0,
    reads: ["turn.speed"],
    update(ctx) {
      const inputs = ctx.inputs;
      const toggles = inputs?.pressed("turn.toggle").filter((press) => press.entity === "wheel").length ?? 0;
      const factor = memory.factor * 2 ** (inputs?.pressed("turn.faster").length ?? 0);
      const stopped = toggles % 2 === 1 ? !memory.stopped : memory.stopped;
      // A held boost key adds 90 degrees per second while it stays down.
      const boost = inputs?.held("turn.boost") === true ? 90 : 0;
      const speed = stopped ? 0 : 90 * factor + boost;
      memory = { angle: memory.angle + (speed * ctx.dt) / 1000, factor, stopped };
      const half = (memory.angle * Math.PI) / 360;
      ctx.out.setTransform("wheel", { rotation: [0, Math.sin(half), 0, Math.cos(half)] });
    },
    save: () => ({ ...memory }),
    restore: (saved) => {
      memory = { ...saved };
    },
  });
}

const turn: RuntimePlugin = defineRuntimePlugin({
  id: "turn",
  components: [turnComponent],
  systems: [turnSystem],
  inputMap: defineInputMap({
    keys: { "turn.faster": ["ArrowUp"], "turn.boost": ["KeyB"] },
    pointer: { "turn.toggle": { component: "turn.speed" } },
  }),
});

const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "turns",
  entities: {
    wheel: { name: "Wheel", parent: null, index: 0, components: { transform: {}, "turn.speed": [0, 90, 0] } },
  },
};

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "turns",
  scene: "turns",
  duration: 6000,
  tracks: [],
};

/** The events of a session: a toggle off, a toggle on, two speed keys and a held boost key. */
const EVENTS: readonly InputEvent[] = [
  { t: 600, kind: "press", action: "turn.toggle", entity: "wheel", point: [0, 0.5, 0] },
  { t: 640, kind: "release", action: "turn.toggle", entity: "wheel" },
  { t: 1405, kind: "press", action: "turn.toggle", entity: "wheel", point: [0.1, 0.4, 0] },
  { t: 2000, kind: "press", action: "turn.faster" },
  { t: 2000, kind: "press", action: "turn.faster" },
  { t: 3111, kind: "press", action: "turn.boost" },
  { t: 3707, kind: "release", action: "turn.boost" },
];

function core(clock: { t: number | null }, plugins: readonly RuntimePlugin[] = [turn]): DocumentCore {
  const made = new DocumentCore({
    ...coreOptions([]),
    clock: () => clock.t,
    flags: { reducedMotion: false, paused: true, visible: true },
    assetSource: () => new FakeAssets(),
    environmentMaps: () => ({
      fromEquirectangular: () => new Texture(),
      fromCubemap: () => new Texture(),
      dispose: () => undefined,
    }),
    plugins,
  });
  made.start();
  return made;
}

async function loaded(clock: { t: number | null }, plugins?: readonly RuntimePlugin[]): Promise<DocumentCore> {
  const made = core(clock, plugins);
  expect((await made.load({ documents: { scene: SCENE, sequence: SEQUENCE } })).ok).toBe(true);
  return made;
}

/** The yaw of the wheel in degrees after the frame at `t`. */
async function yawAt(made: DocumentCore, clock: { t: number | null }, t: number): Promise<number> {
  clock.t = t;
  await made.patch([]);
  const [, y = 0, , w = 1] = made.builder.entityObject("wheel")?.quaternion.toArray() ?? [];
  return (2 * Math.atan2(y, w) * 180) / Math.PI;
}

describe("the input events of the play mode", () => {
  it("apply at the first step at or after their time", async () => {
    const clock = { t: 0 };
    const made = await loaded(clock);
    made.setInputs([{ t: 1005, kind: "press", action: "turn.toggle", entity: "wheel" }], true);
    // The steps at 1000 and 1017 ms: the event at 1005 ms applies at 1017 ms, so the turn of that step is 0.
    expect(stepTime(60)).toBe(1000);
    expect(stepTime(61)).toBe(1017);
    expect(await yawAt(made, clock, 1000)).toBeCloseTo(90, 6);
    expect(await yawAt(made, clock, 1016)).toBeCloseTo(90, 6);
    expect(await yawAt(made, clock, 1017)).toBeCloseTo(90, 6);
    expect(await yawAt(made, clock, 1500)).toBeCloseTo(90, 6);
    made.dispose();
  });

  it("run the steps again for a late event, so the frame equals a replay", async () => {
    const live = { t: 0 };
    const late = await loaded(live);
    expect(await yawAt(late, live, 2000)).toBeCloseTo(180, 6);
    // The event at 1005 ms comes after the frame at 2000 ms: the steps from 1017 ms run again.
    late.setInputs([{ t: 1005, kind: "press", action: "turn.toggle", entity: "wheel" }], false);
    expect(await yawAt(late, live, 2000)).toBeCloseTo(90, 6);
    late.dispose();
  });

  it("give the frames of a live play to a seek after the recording", async () => {
    const live = { t: 0 };
    const play = await loaded(live);
    play.setInputs([], true);
    const frames = new Map<number, number>();
    let next = 0;
    for (let t = 0; t <= 5000; t += 23) {
      // Each event comes at the first frame after its time, as a page message does.
      const due: InputEvent[] = [];
      while (next < EVENTS.length && (EVENTS[next]?.t ?? 0) <= t) due.push(EVENTS[next++]!);
      if (due.length > 0) play.setInputs(due, false);
      frames.set(t, await yawAt(play, live, t));
    }
    const replay = { t: 0 };
    const seek = await loaded(replay);
    seek.setInputs(EVENTS, true);
    for (const t of [4991, 621, 2001, 0, 3404, 3404, 1403, 4002]) {
      expect(await yawAt(seek, replay, t)).toBeCloseTo(frames.get(t) ?? Number.NaN, 9);
    }
    // The step at 600 ms gets the first toggle, so the wheel turns 583 ms before it stops.
    expect(frames.get(1403)).toBeCloseTo(90 * (583 / 1000), 6);
    play.dispose();
    seek.dispose();
  });

  it("go to a plugin simulation as action keys", async () => {
    const seen: { t: number; action: string; args: unknown }[] = [];
    const counter = defineSimulation<number, number>({
      id: "turn",
      stateSchema: { safeParse: (value) => ({ success: true, data: value as number }) },
      initial: () => 0,
      reduce: (state, key) => {
        seen.push({ t: key.t, action: key.action, args: key.args });
        return state + 1;
      },
      settle: (state) => state,
      project: (state) => state,
    });
    const clock = { t: 0 };
    const made = await loaded(clock, [{ ...turn, simulation: counter }]);
    made.setInputs(EVENTS.slice(0, 2), true);
    await yawAt(made, clock, 1000);
    expect(seen.slice(-2)).toEqual([
      { t: 600, action: "turn.toggle", args: { kind: "press", entity: "wheel", point: [0, 0.5, 0] } },
      { t: 640, action: "turn.toggle", args: { kind: "release", entity: "wheel" } },
    ]);
    made.dispose();
  });

  it("come through the worker message, and a replace drops the events before", async () => {
    const clock = { t: 0 };
    const made = await loaded(clock);
    const message: InputsMessage = { type: "inputs", events: EVENTS.slice(0, 1), replace: true };
    expect(handleDocumentMessage(message, made)).toBe(true);
    expect(await yawAt(made, clock, 1000)).toBeCloseTo(90 * (583 / 1000), 6);
    expect(handleDocumentMessage({ type: "inputs", events: [], replace: true }, made)).toBe(true);
    expect(await yawAt(made, clock, 1000)).toBeCloseTo(90, 6);
    made.dispose();
  });
});

describe("the input maps of the plugins", () => {
  it("give the actions of a key and of a pointer press", () => {
    const maps = [turn.inputMap ?? {}];
    expect(keyActions(maps, "ArrowUp")).toEqual(["turn.faster"]);
    expect(keyActions(maps, "KeyQ")).toEqual([]);
    expect(pointerActions(maps, 0, ["transform", "turn.speed"])).toEqual(["turn.toggle"]);
    expect(pointerActions(maps, 0, ["transform"])).toEqual([]);
    expect(pointerActions(maps, 2, ["turn.speed"])).toEqual([]);
    expect(pointerActions(maps, 0, null)).toEqual([]);
    expect(pointerActions([{ pointer: { "turn.aim": {} } }], 0, null)).toEqual(["turn.aim"]);
  });

  it("refuse a bad action name and an action of another plugin", () => {
    expect(INPUT_ACTION_PATTERN.source).toBe(ACTION_PATTERN.source);
    expect(() => defineInputMap({ keys: { toggle: ["KeyT"] } })).toThrow('"toggle" is not an action name');
    const other = defineRuntimePlugin({ id: "other", inputMap: { keys: { "turn.faster": ["ArrowUp"] } } });
    expect(() => new PluginHost([other])).toThrow('the input action ID "turn.faster" does not start with "other."');
  });
});
