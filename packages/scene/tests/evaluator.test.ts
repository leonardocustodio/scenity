// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import {
  applyEase,
  applyLayers,
  bezierEase,
  createEvaluator,
  overridesOf,
  qslerp,
  type SceneOp,
  type Vec3,
} from "../src/index";
import { deepFreeze, fixture, registry } from "./helpers";
import { doorsPlugin, shopPlugin } from "./sequenceKit";

const workshop = deepFreeze(fixture("workshop.scene.json", "scene"));
const walkthrough = deepFreeze(fixture("walkthrough.sequence.json", "sequence"));
const simulations = [doorsPlugin, shopPlugin];

function evaluator(extra: Partial<Parameters<typeof createEvaluator>[0]> = {}) {
  return createEvaluator({ scene: workshop, sequence: walkthrough, registry, simulations, ...extra });
}

describe("createEvaluator: the scene of a frame", () => {
  test("the evaluated scene at t equals the base scene with the expected ops", () => {
    const frame = evaluator().at(10000);
    const rotation = qslerp([0, 0, 0, 1], [0, 0.707107, 0, 0.707107], bezierEase([0.25, 0.1, 0.25, 1], 0.5));
    const intensity = 1 + 2 * applyEase("in", 10000 / 15000);
    const colour: Vec3 = [255, 255 - 55 / 3, 255 - 105 / 3];
    const ops: SceneOp[] = [
      { op: "set", path: "/entities/cart/components/transform/position", value: [1.5, 0, -1] },
      { op: "set", path: "/entities/cart/components/transform/rotation", value: rotation },
      { op: "set", path: "/entities/cart/components/transform/scale", value: [1, 1, 1] },
      { op: "set", path: "/entities/key/components/light/intensity", value: intensity },
      { op: "set", path: "/entities/key/components/light/colour", value: colour },
      { op: "set", path: "/entities/note/components/visibility/visible", value: false },
    ];
    const expected = applyLayers(workshop, [overridesOf("workshop", ops)], registry);
    expect(expected.report).toEqual([]);
    expect(frame.report).toEqual([]);
    expect(frame.scene).toEqual(expected.doc);
  });

  test("an entity with no component of the track gets the component", () => {
    const sequence = {
      ...walkthrough,
      tracks: [{ kind: "visibility" as const, entity: "cart", keys: [{ t: 0, visible: false }] }],
    };
    const frame = createEvaluator({ scene: workshop, sequence, registry }).at(0);
    expect(frame.scene.entities.cart?.components.visibility).toEqual({ visible: false });
    expect(workshop.entities.cart?.components.visibility).toBeUndefined();
  });

  test("the layers apply in order: the layers under, the sequence values, the layers over", () => {
    const position = "/entities/cart/components/transform/position";
    const intensity = "/entities/key/components/light/intensity";
    const under = overridesOf("workshop", [
      { op: "set", path: position, value: [9, 9, 9] },
      { op: "set", path: "/entities/bench/components/transform/position", value: [7, 0, 7] },
    ]);
    const top = overridesOf("workshop", [
      { op: "set", path: intensity, value: 5 },
      { op: "set", path: "/entities/ghost/components/transform/position", value: [0, 0, 0] },
    ]);
    const frame = evaluator({ layers: [under], topLayers: [top] }).at(10000);
    const cart = frame.scene.entities.cart?.components.transform as { position: Vec3 };
    expect(cart.position).toEqual([1.5, 0, -1]);
    expect((frame.scene.entities.bench?.components.transform as { position: Vec3 }).position).toEqual([7, 0, 7]);
    expect((frame.scene.entities.key?.components.light as { intensity: number }).intensity).toBe(5);
    // The layer index counts the layer under (0), the sequence layer (1) and the top layer (2).
    expect(frame.report).toEqual([{ layer: 2, op: 1, reason: 'the entity "ghost" does not exist' }]);
  });

  test("a track of a missing entity gives a report entry and a warning, not a crash", () => {
    const tour = fixture("tour.sequence.json", "sequence");
    const main = fixture("main.scene.json", "scene");
    const result = createEvaluator({ scene: main, sequence: tour, registry });
    expect(result.warnings).toEqual([
      'track 1: the scene has no entity "robot"',
      'track 2: the scene has no entity "box"',
      'no simulation plugin "doors" for the action keys "doors.*"',
    ]);
    const frame = result.at(4000);
    expect((frame.scene.entities.front?.components.camera as { fov: number }).fov).toBeCloseTo(
      45 - 15 * applyEase("inOut", 0.5),
      9,
    );
    expect(frame.attach).toEqual({});
    expect(result.at(6000).attach).toEqual({ box: "entity:robot#hand_r" });
  });
});

describe("createEvaluator: the other parts of a frame", () => {
  test("the camera, the attach parents and the active clips", () => {
    const frame = evaluator().at(31000);
    expect(frame.camera).toBe("entity:top");
    expect(frame.attach).toEqual({ screen: "entity:bench" });
    expect(frame.animations).toEqual({
      drill: [{ clip: "asset:clip_drill_spin", start: 30000, time: 1500, speed: 1.5, loop: true, weight: 1 }],
    });
    expect(frame.tracks).toHaveLength(walkthrough.tracks.length);
  });

  test("the keys of a play step: (since, t] in the stable order", () => {
    const at = evaluator().at(30000, 29999);
    expect(at.fired.map((key) => [key.kind, key.name, key.track, key.key])).toEqual([
      ["event", "drill-start", 5, 1],
      ["event", "caption", 5, 2],
      ["action", "shop.drill-on", 7, 0],
    ]);
    expect(evaluator().at(30000).fired).toEqual([]);
    expect(evaluator().at(30001, 30000).fired).toEqual([]);
    expect(evaluator().at(0, -1).fired).toEqual([]);
  });

  test("a step of a loop wraps at the end of the time line", () => {
    const names = evaluator()
      .firedBetween(35000, 13000)
      .map((key) => `${String(key.t)} ${key.name}`);
    expect(names).toEqual(["36000 shop.drill-off", "40000 doors.open", "12000 door-chime", "12000 doors.open"]);
    const once = createEvaluator({ scene: workshop, sequence: { ...walkthrough, loop: false }, registry });
    expect(once.firedBetween(35000, 13000)).toEqual([]);
  });

  test("the simulation states and projections", () => {
    const result = evaluator();
    expect(result.warnings).toEqual([]);
    const open = result.at(13000);
    expect(open.simulations.doors).toMatchObject({ opens: 1, open: ["door"], closeAfter: 3000 });
    expect(open.projections).toEqual({ doors: { open: 1, since: [1000] } });
    expect(result.at(15500).simulations.doors).toMatchObject({ opens: 1, open: [] });
    expect(result.at(60000).simulations.doors).toMatchObject({ opens: 2, open: [] });
    expect(result.simulationsAt(41000).doors).toMatchObject({ opens: 2, open: ["door-2"] });
  });

  test("the time is an integer and is clamped to the time line", () => {
    const result = evaluator();
    expect(() => result.at(1.5)).toThrow(RangeError);
    expect(result.at(-100).t).toBe(0);
    expect(result.at(99999).t).toBe(60000);
  });

  test("two plugins with one ID and a bad checkpoint step are errors", () => {
    expect(() => evaluator({ simulations: [doorsPlugin, doorsPlugin] })).toThrow('"doors"');
    expect(() => evaluator({ checkpointMs: 0 })).toThrow(RangeError);
  });
});
