// SPDX-License-Identifier: Apache-2.0
// The physics plugin. The world steps at the fixed step of the systems, and two runs give the same bits. A seek gives
// the frame of a play (the Rapier snapshot in the system memory). A kinematic body follows its sequence track. An
// impulse key applies one time, and the plugin host accepts the plugin.
import { describe, expect, it } from "bun:test";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { PluginHost } from "@scenity/runtime/plugins";
import physics from "../src/runtime";
import { decodeBytes, encodeBytes } from "../src/systems/snapshot";
import { harness, playTimes } from "./harness";

const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "drop",
  entities: {
    floor: {
      parent: null,
      index: 0,
      components: {
        transform: { position: [0, 0, 0] },
        shape: { kind: "plane", size: [10, 0, 10] },
        "physics.collider": {},
      },
    },
    box: {
      parent: null,
      index: 1,
      components: {
        transform: { position: [0, 2, 0], rotation: [0.2, 0.1, 0, 0.974679] },
        shape: { kind: "box", size: [0.5, 0.5, 0.5] },
        "physics.collider": { restitution: 0.2 },
        "physics.rigidBody": { mass: 1 },
      },
    },
    ball: {
      parent: null,
      index: 2,
      components: {
        transform: { position: [0.1, 3.5, 0.05] },
        shape: { kind: "sphere", size: [0.4, 0.4, 0.4] },
        "physics.collider": { restitution: 0.6 },
        "physics.rigidBody": { mass: 0.5, velocity: [0.5, 0, 0], angularVelocity: [0, 90, 0] },
      },
    },
    gate: {
      parent: null,
      index: 3,
      components: {
        transform: { position: [-2, 0.5, 0] },
        shape: { kind: "box", size: [0.2, 1, 2] },
        "physics.collider": {},
        "physics.rigidBody": { type: "kinematic" },
      },
    },
  },
};

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "drop",
  scene: "drop",
  duration: 6000,
  tracks: [
    {
      kind: "transform",
      entity: "gate",
      keys: [
        { t: 3000, position: [-2, 0.5, 0] },
        { t: 5000, position: [1, 0.5, 0] },
      ],
    },
    { kind: "action", entity: "ball", keys: [{ t: 4000, action: "physics.impulse", args: { impulse: [0, 3, 0] } }] },
  ],
};

/** The outputs of a fresh harness at each time, in order. */
function play(times: readonly number[]) {
  const run = harness([physics], SCENE, SEQUENCE);
  return times.map((t) => run.at(t));
}

describe("the physics world", () => {
  it("drops the box and the ball onto the floor", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    const start = run.at(0);
    expect(start.box?.transform?.position).toEqual([0, 2, 0]);
    // A fixed body and a kinematic body get no output: the document places them.
    expect(start.floor).toBeUndefined();
    expect(start.gate).toBeUndefined();
    const rest = run.at(2900);
    // The box rests on a face: its centre is half its size over the floor.
    expect(rest.box?.transform?.position?.[1]).toBeCloseTo(0.25, 2);
    expect(rest.ball?.transform?.position?.[1]).toBeLessThan(0.5);
  });

  it("gives the same bits in two runs", () => {
    const times = playTimes(6000);
    const first = play(times);
    const second = play(times);
    expect(JSON.stringify(second)).toBe(JSON.stringify(first));
  });

  it("steps at whole steps: frames between two steps show the same step", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    run.at(990);
    // Step 60 is at 1000 ms, step 61 at 1017 ms.
    expect(run.at(1000)).toEqual(run.at(1016));
    expect(JSON.stringify(run.at(1017))).not.toBe(JSON.stringify(run.at(1000)));
  });

  it("gives a seek the frame of a play", () => {
    const times = playTimes(6000);
    const played = play(times);
    const byTime = new Map(times.map((t, index) => [t, JSON.stringify(played[index])]));
    const run = harness([physics], SCENE, SEQUENCE);
    for (const t of [5800, 1234, 4000, 2501, 0, 3333, 5999]) {
      const near = times.reduce((best, time) => (time <= t ? time : best), 0);
      expect(JSON.stringify(run.at(near))).toBe(byTime.get(near) ?? "");
    }
    // A play again after the seeks gives the frames of the first play.
    for (const [index, t] of times.entries()) {
      if (index % 17 === 0) expect(JSON.stringify(run.at(t))).toBe(byTime.get(t) ?? "");
    }
  });

  it("moves a kinematic body along its track, and it pushes the box", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    const before = run.at(2900).box?.transform?.position?.[0] ?? 0;
    const after = run.at(5500).box?.transform?.position?.[0] ?? 0;
    expect(after).toBeGreaterThan(before + 0.5);
  });

  it("applies an impulse key one time", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    const rest = run.at(3990).ball?.transform?.position?.[1] ?? 0;
    const up = run.at(4200).ball?.transform?.position?.[1] ?? 0;
    expect(up).toBeGreaterThan(rest + 0.1);
    // The ball falls again: the key does not push at each step.
    expect(run.at(5900).ball?.transform?.position?.[1]).toBeLessThan(up);
  });

  it("refuses a bad component value: the entity gets no body", () => {
    const bad: SceneDocument = {
      ...SCENE,
      entities: {
        ...SCENE.entities,
        box: {
          ...SCENE.entities.box!,
          components: { ...SCENE.entities.box!.components, "physics.rigidBody": { mass: -1 } },
        },
      },
    };
    const run = harness([physics], bad, SEQUENCE);
    expect(run.at(1000).box?.transform).toBeUndefined();
  });

  it("is a valid plugin for the plugin host", () => {
    const host = new PluginHost([physics]);
    expect(host.simulations.map((simulation) => simulation.id)).toEqual(["physics"]);
    expect(host.components.get("physics.collider")).toBeDefined();
  });

  it("keeps the snapshot bytes through the text form", () => {
    const bytes = new Uint8Array(100_000).map((_, index) => (index * 7919) % 256);
    expect(decodeBytes(encodeBytes(bytes))).toEqual(bytes);
  });
});
