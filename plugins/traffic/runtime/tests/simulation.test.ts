// SPDX-License-Identifier: Apache-2.0
// The traffic simulation: the phases of the signal after a press, the stop of a
// car at the line and its start on green, the decision at amber, the gap of a queue, the walk of a walker, the red
// entry of a car that does not stop, and seek equals play through the evaluator of @scenity/scene.
import { describe, expect, it } from "bun:test";
import { builtinRegistry } from "@scenity/scene";
import { createEvaluator, type SequenceDocument } from "@scenity/scene/sequence";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { phaseEnd, pressed, signalAt } from "../src/signals";
import { projectTraffic, reduceTraffic, trafficSimulation } from "../src/simulation";
import { DEFAULT_CONFIG, initialState, type TrafficState } from "../src/state";
import { settleTraffic, STEP_MS } from "../src/traffic";

const TIMING = DEFAULT_CONFIG.timing;
const SCENE: SceneDocument = { format: "scenity.scene/1", id: "road", entities: {} };
const registry = builtinRegistry();

/** A key of an action at a time, as the evaluator gives it. */
function key(t: number, action: string, entity: string | undefined, args: Record<string, string | number | boolean>) {
  return { t, track: 0, key: 0, entity, action, args };
}

/** The state after the keys in time order, settled to `t`. */
function run(keys: ReturnType<typeof key>[], t: number): TrafficState {
  let state = initialState(undefined);
  for (const item of keys) state = reduceTraffic(settleTraffic(state, item.t), item);
  return settleTraffic(state, t);
}

/** A sequence of action keys on the empty road scene. */
function sequence(tracks: SequenceDocument["tracks"], duration = 24000): SequenceDocument {
  return { format: "scenity.sequence/1", id: "test", scene: "road", duration, tracks };
}

describe("the signal of the crossing", () => {
  it("holds green with no press, and serves a press after the least green time", () => {
    const green = { phase: "green" as const, since: 0, request: null };
    expect(phaseEnd(green, TIMING)).toBeNull();
    expect(signalAt(green, TIMING, 100_000).phase).toBe("green");
    const asked = pressed(green, 2000);
    expect(signalAt(asked, TIMING, 5999).phase).toBe("green");
    expect(signalAt(asked, TIMING, 6000)).toEqual({ phase: "amber", since: 6000, request: null });
    expect(signalAt(asked, TIMING, 8000).phase).toBe("allRed");
    expect(signalAt(asked, TIMING, 9500).phase).toBe("walk");
    expect(signalAt(asked, TIMING, 13_500).phase).toBe("clearance");
    expect(signalAt(asked, TIMING, 18_500)).toEqual({ phase: "green", since: 18_500, request: null });
  });

  it("keeps a press of the clearance for the next cycle and ignores a press on walk", () => {
    const walk = { phase: "walk" as const, since: 0, request: null };
    expect(pressed(walk, 100)).toBe(walk);
    const clearance = pressed({ phase: "clearance", since: 0, request: null }, 1000);
    const green = signalAt(clearance, TIMING, TIMING.clearance);
    expect(green).toEqual({ phase: "green", since: TIMING.clearance, request: 1000 });
    expect(signalAt(green, TIMING, TIMING.clearance + TIMING.minGreen).phase).toBe("amber");
  });
});

describe("the cars and the walkers", () => {
  it("stops a car at the stop line on red and starts it on green", () => {
    const keys = [
      key(0, "traffic.button", undefined, { kind: "press" }),
      key(5000, "traffic.car", "car", { lane: "east" }),
    ];
    const lane = DEFAULT_CONFIG.lanes.east!;
    const waiting = run(keys, 15_000);
    expect(waiting.signal.phase).toBe("clearance");
    expect(waiting.cars.car?.s).toBeCloseTo(lane.stop, 6);
    expect(waiting.cars.car?.v).toBeCloseTo(0, 6);
    expect(run(keys, 21_000).cars.car?.s ?? 0).toBeGreaterThan(lane.stop + 5);
    expect(run(keys, 21_000).redEntries).toEqual([]);
  });

  it("lets a car that cannot stop at amber go on, and stops a car far from the line", () => {
    const lane = DEFAULT_CONFIG.lanes.east!;
    // At 9 m/s a car 2 m before the line needs 6.75 m with the hard brake: it goes on.
    const near = (lane.stop - 2) / 9;
    const press = key(0, "traffic.button", undefined, { kind: "press" });
    const late = run([press, key(Math.round(6000 - near * 1000), "traffic.car", "near", { lane: "east" })], 9000);
    expect(late.cars.near?.s ?? lane.exit).toBeGreaterThan(lane.stop);
    expect(late.redEntries).toEqual([]);
    const far = run([press, key(4000, "traffic.car", "far", { lane: "east" })], 9000);
    expect(far.cars.far?.s).toBeCloseTo(lane.stop, 6);
  });

  it("keeps the gap in a queue", () => {
    const { carLength, gap } = DEFAULT_CONFIG.motion;
    const keys = [
      key(0, "traffic.button", undefined, { kind: "press" }),
      key(6500, "traffic.car", "first", { lane: "east" }),
      key(7500, "traffic.car", "second", { lane: "east" }),
    ];
    const state = run(keys, 13_000);
    const first = state.cars.first?.s ?? 0;
    expect(first - (state.cars.second?.s ?? 0)).toBeCloseTo(carLength + gap, 3);
  });

  it("walks a walker to the kerb, presses the button, and crosses on walk", () => {
    const keys = [key(1000, "traffic.walker", "walker", { side: "south" })];
    const side = DEFAULT_CONFIG.sides.south!;
    const toKerb = Math.hypot(side.path[1][0] - side.path[0][0], side.path[1][1] - side.path[0][1]);
    const arrive = 1000 + Math.round((toKerb / DEFAULT_CONFIG.motion.walkSpeed) * 1000);
    // The press comes before the least green time ends, so amber starts at that time.
    expect(arrive).toBeLessThan(TIMING.minGreen);
    expect(run(keys, arrive + STEP_MS).signal.request).toBeCloseTo(arrive, -2);
    const waiting = run(keys, TIMING.minGreen);
    expect(waiting.walkers.walker).toMatchObject({ leg: 0 });
    expect(waiting.signal).toMatchObject({ phase: "amber", since: TIMING.minGreen });
    const walkAt = TIMING.minGreen + TIMING.amber + TIMING.allRed;
    expect(run(keys, walkAt - STEP_MS).walkers.walker?.leg).toBe(0);
    expect(run(keys, walkAt + 1000).walkers.walker?.leg).toBe(1);
    expect(run(keys, 40_000).walkers.walker).toBeUndefined();
  });

  it("logs a car that does not stop on red", () => {
    const keys = [
      key(0, "traffic.button", undefined, { kind: "press" }),
      key(7000, "traffic.car", "runner", { lane: "west", ignoresSignal: true }),
    ];
    expect(run(keys, 15_000).redEntries).toEqual(["runner"]);
  });

  it("ignores a release and keys with bad arguments", () => {
    const state = initialState(undefined);
    expect(reduceTraffic(state, key(0, "traffic.button", undefined, { kind: "release" }))).toBe(state);
    expect(reduceTraffic(state, key(0, "traffic.car", "car", { lane: "north" }))).toBe(state);
    expect(reduceTraffic(state, key(0, "traffic.walker", undefined, { side: "south" }))).toBe(state);
    expect(
      trafficSimulation.stateSchema.safeParse(run([key(0, "traffic.car", "c", { lane: "east" })], 900)).success,
    ).toBe(true);
  });

  it("places a car with its centre behind its front and turns the west lane round", () => {
    const state = run([key(0, "traffic.car", "c", { lane: "west" })], 1000);
    const placed = projectTraffic(state).cars.c;
    const lane = DEFAULT_CONFIG.lanes.west!;
    const s = state.cars.c?.s ?? 0;
    expect(placed?.position[0]).toBeCloseTo(lane.start[0] - (s - DEFAULT_CONFIG.motion.carLength / 2), 3);
    expect(placed?.rotation[1]).toBeCloseTo(1, 6);
  });
});

describe("the simulation in the evaluator", () => {
  const tracks: SequenceDocument["tracks"] = [
    { entity: "a", kind: "action", keys: [{ t: 500, action: "traffic.car", args: { lane: "east" } }] },
    { entity: "b", kind: "action", keys: [{ t: 6200, action: "traffic.car", args: { lane: "east" } }] },
    { entity: "c", kind: "action", keys: [{ t: 7300, action: "traffic.car", args: { lane: "west" } }] },
    { entity: "w", kind: "action", keys: [{ t: 1200, action: "traffic.walker", args: { side: "north" } }] },
  ];
  const doc = sequence(tracks);

  it("gives a seek the state of a play", () => {
    const play = createEvaluator({ scene: SCENE, sequence: doc, simulations: [trafficSimulation], registry });
    const played = new Map<number, string>();
    for (let t = 0; t <= doc.duration; t += 17) played.set(t, JSON.stringify(play.at(t).projections.traffic));
    const seek = createEvaluator({ scene: SCENE, sequence: doc, simulations: [trafficSimulation], registry });
    let seed = 7;
    for (let index = 0; index < 300; index += 1) {
      seed = (seed * 1_103_515_245 + 12_345) % 2_147_483_648;
      const t = 17 * (seed % Math.floor(doc.duration / 17));
      expect(JSON.stringify(seek.at(t).projections.traffic)).toBe(played.get(t) ?? "");
    }
  });

  it("reads the initial parameters of the sequence", () => {
    const slow = { ...doc, initial: { traffic: { timing: { minGreen: 12_000 } } } };
    const evaluator = createEvaluator({ scene: SCENE, sequence: slow, simulations: [trafficSimulation], registry });
    expect((evaluator.at(9000).projections.traffic as { phase: string }).phase).toBe("green");
    expect((evaluator.at(12_500).projections.traffic as { phase: string }).phase).toBe("amber");
  });
});
