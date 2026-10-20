// SPDX-License-Identifier: Apache-2.0
// The character controller of the physics plugin. The walk, stop and jump keys of a sequence move a character on the
// floor. The play mode keys (the input map of the plugin) move it too. A wall stops it. The character faces its walk.
// A replay of the same input events gives the same frames.
import { describe, expect, it } from "bun:test";
import type { InputEvent } from "@scenity/scene/input";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import physics from "../src/runtime";
import { facingRotation } from "../src/systems/character";
import { harness, playTimes } from "./harness";

const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "walk",
  entities: {
    floor: {
      parent: null,
      index: 0,
      components: { transform: {}, shape: { kind: "plane", size: [20, 0, 20] }, "physics.collider": {} },
    },
    wall: {
      parent: null,
      index: 1,
      components: {
        transform: { position: [0, 1, -3] },
        shape: { kind: "box", size: [8, 2, 0.2] },
        "physics.collider": {},
      },
    },
    hero: { parent: null, index: 2, components: { transform: {}, "physics.character": { speed: 2 } } },
    statue: {
      parent: null,
      index: 3,
      components: { transform: { position: [5, 0, 5] }, "physics.character": { keyboard: false } },
    },
    second: {
      parent: null,
      index: 4,
      components: {
        transform: { position: [-5, 0, 5] },
        "physics.character": { speed: 2, actions: { right: "second.east" } },
      },
    },
  },
};

const walkTo = (t: number, direction: [number, number]) => ({ t, action: "physics.walk", args: { direction } });

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "walk",
  scene: "walk",
  duration: 8000,
  tracks: [
    {
      kind: "action",
      entity: "hero",
      keys: [
        walkTo(500, [1, 0]),
        { t: 1500, action: "physics.stop" },
        { t: 2000, action: "physics.jump" },
        walkTo(3000, [0, -1]),
        { t: 6000, action: "physics.stop" },
      ],
    },
  ],
};

const position = (frame: ReturnType<ReturnType<typeof harness>["at"]>, id = "hero") =>
  frame[id]?.transform?.position ?? [Number.NaN, Number.NaN, Number.NaN];

describe("the character controller", () => {
  it("walks, stops, jumps and lands on the floor", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    expect(position(run.at(400))[1]).toBeCloseTo(0, 3);
    // One second of walk at 2 m/s along +X.
    const stopped = position(run.at(1900));
    expect(stopped[0]).toBeCloseTo(2, 1);
    expect(stopped[2]).toBeCloseTo(0, 3);
    expect(position(run.at(2300))[1]).toBeGreaterThan(0.3);
    expect(position(run.at(2990))[1]).toBeCloseTo(0, 3);
  });

  it("stops at a wall", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    // The wall face is at z = -2.9; the capsule radius is 0.3; the wall spans x in [-4, 4].
    const z = position(run.at(5900))[2];
    expect(z).toBeGreaterThan(-2.65);
    expect(z).toBeLessThan(-2.5);
  });

  it("faces the walk direction", () => {
    const run = harness([physics], SCENE, SEQUENCE);
    expect(run.at(400).hero?.transform?.rotation).toBeUndefined();
    const east = run.at(1000).hero?.transform?.rotation;
    expect(east?.[1]).toBeCloseTo(Math.SQRT1_2, 6);
    expect(east?.[3]).toBeCloseTo(Math.SQRT1_2, 6);
    // The facing stays after a stop.
    expect(run.at(1900).hero?.transform?.rotation).toEqual(east);
    expect(facingRotation([0, -1])).toEqual([0, 1, 0, 0]);
    expect(facingRotation([-1, 0])[1]).toBeCloseTo(-Math.SQRT1_2, 9);
  });

  it("walks with the play mode keys and replays them to the same frames", () => {
    const events: InputEvent[] = [
      { t: 100, kind: "press", action: "physics.left" },
      { t: 600, kind: "press", action: "physics.forward" },
      { t: 1100, kind: "release", action: "physics.left" },
      { t: 1100, kind: "release", action: "physics.forward" },
      { t: 1700, kind: "press", action: "second.east" },
      { t: 2000, kind: "release", action: "second.east" },
    ];
    const quiet: SequenceDocument = { ...SEQUENCE, tracks: [] };
    const live = harness([physics], SCENE, quiet, events);
    const times = playTimes(2000);
    const frames = times.map((t) => JSON.stringify(live.at(t)));
    const end = position(live.at(2000));
    // 0.5 s left at 2 m/s, then 0.5 s left and forward at 2 m/s along the diagonal.
    expect(end[0]).toBeCloseTo(-1 - Math.SQRT2 / 2, 1);
    expect(end[2]).toBeCloseTo(-Math.SQRT2 / 2, 1);
    // A character with `keyboard: false` does not move.
    expect(position(live.at(2000), "statue")[0]).toBeCloseTo(5, 3);
    // A character with its own action for "right" walks on it, and still takes the default actions of the others.
    const second = position(live.at(2000), "second");
    expect(second[0]).toBeCloseTo(-5 - 1 - Math.SQRT2 / 2 + 0.6, 1);
    expect(second[2]).toBeCloseTo(5 - Math.SQRT2 / 2, 1);
    const replay = harness([physics], SCENE, quiet, events);
    expect(times.map((t) => JSON.stringify(replay.at(t)))).toEqual(frames);
  });
});
