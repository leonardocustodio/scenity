// SPDX-License-Identifier: Apache-2.0
// The navigation over a scene document (src/navigation.ts, src/walkPlan.ts, src/sceneWalks.ts): the table
// scene of the characters sample has a table with an `obstacle` and a stand point behind it. The robot walks around the
// table: no point of its walk is in the table, and the walk ends at the stand point with its facing.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, LOCOMOTION_DEFAULTS } from "@scenity/scene/components";
import { readDocument } from "@scenity/scene/read";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { floorObstacles, scenePath, standPlaces } from "../src/navigation";
import { crosses, pathLength, type FloorPoint } from "../src/path";
import type { FloorRect } from "../src/place";
import { sceneWalkers, WALK_DEFAULTS, withWalkers } from "../src/sceneWalks";
import { walkFrame, walkParameters } from "../src/walkPlan";
import { constantParameters } from "../src/animator/parameters";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
const registry = builtinRegistry();

function tableScene(): SceneDocument {
  const result = readDocument(readFileSync(join(SAMPLE, "scenes/table.scene.json"), "utf8"), "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

function inside(point: FloorPoint, rect: FloorRect): boolean {
  return point[0] > rect.minX && point[0] < rect.maxX && point[1] > rect.minZ && point[1] < rect.maxZ;
}

/** The points of a path at each centimetre. */
function samples(path: readonly FloorPoint[]): FloorPoint[] {
  const out: FloorPoint[] = [];
  for (let index = 1; index < path.length; index += 1) {
    const [a, b] = [path[index - 1] ?? [0, 0], path[index] ?? [0, 0]];
    const steps = Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 0.01);
    for (let step = 0; step <= steps; step += 1) {
      out.push([a[0] + ((b[0] - a[0]) * step) / steps, a[1] + ((b[1] - a[1]) * step) / steps]);
    }
  }
  return out;
}

describe("the floor of a scene document", () => {
  it("reads the table footprint from its shape and the stand point with its facing", () => {
    const scene = tableScene();
    expect(floorObstacles(scene)).toEqual([{ minX: -0.7, maxX: 0.7, minZ: -0.4, maxZ: 0.4 }]);
    const [spot] = standPlaces(scene);
    expect(spot?.entity).toBe("spot");
    expect(spot?.at[0]).toBeCloseTo(0, 9);
    expect(spot?.at[1]).toBeCloseTo(-1, 9);
    // The facing π of the stand point faces +z: the yaw of an actor there is 0.
    expect(Math.abs(Math.sin(spot?.yaw ?? 1))).toBeLessThan(1e-6);
  });

  it("turns a footprint with its entity, and reads a polygon and the bounds of a model from the host", () => {
    const scene: SceneDocument = {
      format: "scenity.scene/1",
      id: "floor",
      entities: {
        turned: {
          parent: null,
          index: 0,
          components: {
            transform: { position: [2, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2] },
            obstacle: { footprint: { kind: "rect", size: [1, 0.4] } },
          },
        },
        poly: {
          parent: null,
          index: 1,
          components: {
            obstacle: {
              footprint: {
                kind: "polygon",
                points: [
                  [0, 0],
                  [1, 0],
                  [0, 2],
                ],
              },
            },
          },
        },
        model: { parent: null, index: 2, components: { obstacle: {} } },
        skipped: { parent: null, index: 3, tags: ["low"], components: { obstacle: {}, shape: { kind: "box" } } },
      },
    };
    const bounds = (id: string) => (id === "model" ? { minX: 5, maxX: 6, minZ: 5, maxZ: 6 } : undefined);
    expect(floorObstacles(scene, { bounds, skipTags: ["low"] })).toEqual([
      { minX: 1.8, maxX: 2.2, minZ: -0.5, maxZ: 0.5 },
      { minX: 0, maxX: 1, minZ: 0, maxZ: 2 },
      { minX: 5, maxX: 6, minZ: 5, maxZ: 6 },
    ]);
    // With no host bounds, a model footprint gives no rectangle.
    expect(floorObstacles(scene, { skipTags: ["low"] })).toHaveLength(2);
  });
});

describe("the walk around the table", () => {
  const scene = tableScene();
  const obstacles = floorObstacles(scene);
  const [walker] = sceneWalkers(scene);
  if (walker === undefined) throw new Error("the table scene has no walker");
  const [leg] = walker.plan.legs;
  if (leg === undefined) throw new Error("the robot has no walk");

  it("goes around the table: no point of the path is in an obstacle, and the path ends at the stand point", () => {
    const path = scenePath(scene, [-2.2, 1.2], [0, -1]);
    expect(path).toEqual([...leg.path]);
    // The table is in the way of the straight line: the path has a corner.
    expect(path.length).toBeGreaterThan(2);
    for (const point of samples(path)) for (const rect of obstacles) expect(inside(point, rect)).toBe(false);
    for (let index = 1; index < path.length; index += 1) {
      for (const rect of obstacles) expect(crosses(path[index - 1] ?? [0, 0], path[index] ?? [0, 0], rect)).toBe(false);
    }
    expect(path[path.length - 1]).toEqual([0, -1]);
  });

  it("walks at the walk speed from the start time, then turns to the facing of the stand point", () => {
    expect(leg.startMs).toBe(1000);
    // 1 m/s: the walk speed of the Walking clip at the scale 0.25 of the robot.
    expect(walker.plan.speed).toBe(1);
    expect(leg.arriveMs - leg.startMs).toBe(Math.round(pathLength(leg.path) * 1000));
    expect(walkFrame(walker.plan, 500)).toEqual({
      at: [-2.2, 1.2],
      yaw: walker.plan.start.yaw,
      speed: 0,
      walking: false,
    });
    expect(walkFrame(walker.plan, 2000)).toMatchObject({ speed: 1, walking: true });
    const end = walkFrame(walker.plan, leg.endMs);
    expect(end).toMatchObject({ at: [0, -1], speed: 0, walking: false });
    expect(Math.abs(Math.sin(end.yaw))).toBeLessThan(1e-6);
    expect(leg.endMs).toBeGreaterThan(leg.arriveMs);
  });

  it("keeps the body out of the table at each frame and moves no faster than the walk speed", () => {
    let last = walkFrame(walker.plan, 0);
    for (let t = 10; t <= leg.endMs + 500; t += 10) {
      const frame = walkFrame(walker.plan, t);
      for (const rect of obstacles) expect(inside(frame.at, rect)).toBe(false);
      expect(Math.hypot(frame.at[0] - last.at[0], frame.at[1] - last.at[1])).toBeLessThan(0.0101);
      // The heading turns at most at the turn speed (plus a margin for the share of a corner window).
      const turn = Math.abs(Math.atan2(Math.sin(frame.yaw - last.yaw), Math.cos(frame.yaw - last.yaw)));
      expect(turn).toBeLessThan(0.01 * walker.plan.turnSpeed * 2 + 1e-9);
      last = frame;
    }
  });

  it("gives the animator the walk speed with changes only at the start and the arrival", () => {
    const parameters = walkParameters(walker.plan, walker.parameter, constantParameters({ speed: 0, wave: false }));
    expect(parameters.changes(0, 10_000)).toEqual([leg.startMs, leg.arriveMs]);
    expect(parameters.at(999)).toEqual({ speed: 0, wave: false });
    expect(parameters.at(1000)).toEqual({ speed: 1, wave: false });
    expect(parameters.at(leg.arriveMs)).toEqual({ speed: 0, wave: false });
  });

  it("puts the transform of the walk into the scene and keeps the other entities", () => {
    const at = withWalkers(scene, [walker], leg.endMs + 100);
    expect(at.entities.table).toBe(scene.entities.table);
    const transform = at.entities.robot?.components.transform as { position: number[]; scale: number[] };
    expect(transform.position[0]).toBeCloseTo(0, 9);
    expect(transform.position[2]).toBeCloseTo(-1, 9);
    expect(transform.scale).toEqual([0.25, 0.25, 0.25]);
  });

  it("has the defaults of the locomotion component", () => {
    const { speed, turnSpeed, parameter } = LOCOMOTION_DEFAULTS;
    expect(WALK_DEFAULTS).toEqual({ speed, turnSpeed, parameter });
  });
});
