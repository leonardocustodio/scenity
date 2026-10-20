// SPDX-License-Identifier: Apache-2.0
// The ray casts of the physics plugin: a system of another plugin gets the queries of the physics world of its core,
// and the hits name the entity, the distance, the point and the normal.
import { describe, expect, it } from "bun:test";
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { defineSystem, type Json } from "@scenity/runtime/systems";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { physicsQueries, type RayHit } from "../src/queries";
import physics from "../src/runtime";
import { harness } from "./harness";

const SCENE: SceneDocument = {
  format: "scenity.scene/1",
  id: "rays",
  entities: {
    floor: {
      parent: null,
      index: 0,
      components: { transform: {}, shape: { kind: "plane", size: [10, 0, 10] }, "physics.collider": {} },
    },
    block: {
      parent: null,
      index: 1,
      components: {
        transform: { position: [2, 0.5, 0] },
        shape: { kind: "box", size: [1, 1, 1] },
        "physics.collider": {},
      },
    },
    zone: {
      parent: null,
      index: 2,
      components: {
        transform: { position: [-2, 1, 0] },
        "physics.collider": { shape: "sphere", size: [1, 1, 1], sensor: true },
      },
    },
  },
};

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "rays",
  scene: "rays",
  duration: 1000,
  tracks: [],
};

/** A plugin whose system casts rays in each update and writes the hits as values of the entity "floor". */
const prober = defineRuntimePlugin({
  id: "prober",
  systems: [
    (core?: unknown) =>
      defineSystem({
        id: "prober.rays",
        order: 0,
        update(ctx) {
          const queries = physicsQueries(core);
          const cast = (name: string, hit: RayHit | null | undefined) =>
            ctx.out.setValue("floor", name, (hit ?? null) as unknown as Json);
          cast("down", queries?.castRay([0, 3, 0], [0, -2, 0], 10));
          cast("block", queries?.castRay([0, 0.5, 0], [1, 0, 0], 10));
          cast("short", queries?.castRay([0, 0.5, 0], [1, 0, 0], 1));
          cast("sensorOff", queries?.castRay([-2, 3, 0], [0, -1, 0], 10));
          cast("sensorOn", queries?.castRay([-2, 3, 0], [0, -1, 0], 10, { sensors: true }));
          cast("exclude", queries?.castRay([2, 3, 0], [0, -1, 0], 10, { exclude: "block" }));
        },
      }),
  ],
});

describe("the ray casts of the physics world", () => {
  const run = harness([physics, prober], SCENE, SEQUENCE);
  const values = () => run.at(500).floor?.values ?? {};

  it("sees no collider before the first step", () => {
    expect(run.at(0).floor?.values.down).toBeNull();
  });

  it("hits the floor and the block with the entity, the distance, the point and the normal", () => {
    const hits = values();
    expect(hits.down).toEqual({ entity: "floor", distance: 3, point: [0, 0, 0], normal: [0, 1, 0] });
    expect(hits.block).toEqual({ entity: "block", distance: 1.5, point: [1.5, 0.5, 0], normal: [-1, 0, 0] });
  });

  it("stops at the maximum distance", () => {
    expect(values().short).toBeNull();
  });

  it("goes through a sensor unless the options ask for sensors", () => {
    const hits = values();
    expect((hits.sensorOff as unknown as RayHit).entity).toBe("floor");
    const sensor = hits.sensorOn as unknown as RayHit;
    expect(sensor.entity).toBe("zone");
    expect(sensor.distance).toBeCloseTo(1.5, 5);
  });

  it("does not hit the excluded entity", () => {
    expect((values().exclude as unknown as RayHit).entity).toBe("floor");
  });

  it("gives no queries for a core with no physics system", () => {
    expect(physicsQueries({})).toBeUndefined();
  });
});
