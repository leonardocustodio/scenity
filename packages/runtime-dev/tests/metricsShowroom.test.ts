// SPDX-License-Identifier: Apache-2.0
// The metric library on the showroom sample: the metrics of place, view, route and budget run on the scene of a
// document core with the built models and no render. Each metric has a value that passes a limit and a value that fails
// it (after a patch of the scene, or with other arguments).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createMetricRegistry, inLimit, type MetricContext, type MetricResult } from "@scenity/rules";
import { MetricScene, sampleProject, sampleScene, ShowroomAssets } from "./metricHelpers";

const registry = createMetricRegistry();
const project = sampleProject("showroom/scenity.project.json");
const FURNITURE = ["armchair", "coffee-table", "ottoman", "shelf", "table", "lantern"];
/** A straight walk through the gap between the armchair and the coffee table (46.5 cm wide). */
const GAP_ROUTE = { points: [[-1.92, 0, 1.6] as const, [-1.92, 0, -0.9] as const] };
/** A floor path from the window side to the shelf, around the obstacles. */
const OPEN_ROUTE = { from: [2.5, 0, 1.5] as const, to: [-0.5, 0, -2.4] as const };

let scene: MetricScene;
let ctx: MetricContext;

function measure(id: string, args: unknown, context: MetricContext = ctx): MetricResult {
  const outcome = registry.evaluate(id, context, args);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.result;
}

beforeAll(async () => {
  scene = await new MetricScene(new ShowroomAssets()).load(sampleScene("showroom/scenes/main.scene.json"));
  ctx = scene.context({ project });
});

afterAll(() => {
  scene.dispose();
});

describe("the metrics of place on the showroom", () => {
  it("distance: the socket of the table top to the lantern on it", () => {
    const result = measure("distance", { from: "entity:table#top", to: "entity:lantern" });
    expect(result.value).toBeCloseTo(Math.hypot(0.35, 0.05), 3);
    expect(result.unit).toBe("m");
    expect(inLimit(result.value, { max: 0.5 })).toBe(true);
    expect(
      inLimit(measure("distance", { from: "entity:table", to: "entity:shelf", plane: "floor" }).value, { max: 0.5 }),
    ).toBe(false);
    expect(measure("distance", { from: "entity:table#nothing", to: "entity:lantern" }).value).toBeNull();
  });

  it("overlap: the furniture stands apart, and an ottoman pushed into the coffee table overlaps it", async () => {
    const apart = measure("overlap", { a: FURNITURE });
    expect(apart.value).toBe(0);
    // The lantern stands in the subtree of the table: the pair does not count.
    expect(apart.items?.map((item) => item.subject)).not.toContain("table+lantern");
    expect(apart.items).toHaveLength(14);
    const other = new MetricScene(new ShowroomAssets());
    await other.load(sampleScene("showroom/scenes/main.scene.json"));
    await other.core.patch([
      { op: "set", path: "/entities/ottoman/components/transform/position", value: [-1.2, 0, 0.6] },
    ]);
    const pushed = other.context();
    const boxes = measure("overlap", { a: "ottoman", b: ["coffee-table", "armchair"] }, pushed);
    expect(boxes.detail).toStartWith("ottoman+coffee-table");
    expect(boxes.value).toBeGreaterThan(0.3);
    expect(inLimit(boxes.value, { max: 0.01 })).toBe(false);
    // The mesh parts are inside the boxes of the entities: their overlap is not deeper.
    const meshes = measure("overlap", { a: "ottoman", b: "coffee-table", mode: "meshes" }, pushed);
    expect(meshes.value ?? 1).toBeLessThanOrEqual((boxes.value ?? 0) + 1e-9);
    expect(measure("overlap", { a: "ottoman", b: "coffee-table", mode: "floor" }, pushed).value).toBeGreaterThan(0.3);
    other.dispose();
  });

  it("belowFloor: the models stand on the floor; a clearance of 1 cm fails", () => {
    const models = { entity: "component:model", floor: "floor" };
    const result = measure("belowFloor", models);
    expect(result.items?.map((item) => item.subject).sort()).toEqual([...FURNITURE].sort());
    expect(inLimit(result.value, { max: 0.001 })).toBe(true);
    expect(inLimit(measure("belowFloor", { ...models, clearance: 0.01 }).value, { max: 0.001 })).toBe(false);
  });
});

describe("the metric visible on the showroom", () => {
  const SHELF = { at: [-2.2, 0.6, -2.55] as const, size: [0.8, 0.8] as const };

  it("the front camera sees the front of the shelf", () => {
    expect(measure("visible", { eye: "entity:front", ...SHELF }).value).toBe(1);
    expect(measure("visible", { eye: "entity:front", ...SHELF, grid: 4, occluders: "meshes" }).value).toBe(1);
  });

  it("an eye low behind the armchair: its box hides all, its meshes hide one corner", () => {
    const eye = [-2.5, 1, 2.5];
    const boxes = measure("visible", { eye, ...SHELF });
    expect(boxes).toMatchObject({ value: 0, detail: "0 of 4 points visible; 4 by armchair" });
    const meshes = measure("visible", { eye, ...SHELF, occluders: "meshes" });
    expect(meshes.value).toBe(0.75);
    expect(inLimit(meshes.value, { min: 1 })).toBe(false);
  });

  it("a rectangle that faces away from the eye is not visible", () => {
    const rect = { at: "entity:table#top", size: [0.6, 0.4], frame: "table" };
    expect(measure("visible", { eye: "entity:front", ...rect }).value).toBe(1);
    expect(measure("visible", { eye: [1.6, 1, -2.5], ...rect })).toMatchObject({ value: 0 });
  });
});

describe("the metrics of a route on the showroom", () => {
  it("walkway: an open floor path is wide, the gap between the armchair and the coffee table is narrow", () => {
    const open = measure("walkway", { route: OPEN_ROUTE, room: "floor" });
    expect(open.value).toBeGreaterThan(1.2);
    expect(inLimit(open.value, { min: 0.6 })).toBe(true);
    const gap = measure("walkway", { route: GAP_ROUTE, room: "floor" });
    expect(gap.value).toBeCloseTo(-1.6864 + 2.1515, 2);
    expect(inLimit(gap.value, { min: 0.6 })).toBe(false);
    // With the coffee table out of the obstacles, the gap is open to one side.
    expect(measure("walkway", { route: GAP_ROUTE, room: "floor", ignore: ["coffee-table"] }).value).toBeGreaterThan(1);
  });

  it("routeClear: the floor path keeps 20 cm from each obstacle, but not 50 cm from the table", () => {
    const near = measure("routeClear", { route: OPEN_ROUTE, margin: 0.2 });
    expect(near).toMatchObject({ value: 0, unit: "count" });
    const far = measure("routeClear", { route: OPEN_ROUTE, margin: 0.5 });
    expect(far.value).toBe(1);
    expect(far.items?.[0]?.subject).toBe("table");
  });

  it("routeClear: a cable on a path component goes through the box of the coffee table", async () => {
    const other = new MetricScene(new ShowroomAssets());
    await other.load(sampleScene("showroom/scenes/main.scene.json"));
    const points = [
      [0, 0.3, 0.5],
      [-2.8, 0.3, 0.5],
    ];
    await other.core.patch([{ op: "addComponent", id: "table", component: "path", value: { points } }]);
    const cable = other.context();
    const end = cable.point("entity:table#path.1") ?? [0, 0, 0];
    [-1.2, 0.3, -0.4].forEach((value, axis) => expect(end[axis]).toBeCloseTo(value, 6));
    const solids = ["coffee-table", "armchair", "ottoman"];
    const result = measure("routeClear", { route: { path: "table" }, solids }, cable);
    expect(result.value).toBe(1);
    expect(result.items).toEqual([{ subject: "coffee-table", value: 0, detail: "0.0 cm from the route" }]);
    expect(measure("routeClear", { route: { path: "table" }, solids: ["ottoman"] }, cable).value).toBe(0);
    other.dispose();
  });
});

describe("the metric triangleBudget on the showroom", () => {
  it("the scene is inside the budget of the project; the table and its lantern exceed a small budget", () => {
    const scene = measure("triangleBudget", { tier: "high" });
    expect(scene.value).toBe(ctx.totals().triangles);
    expect(scene.limit).toEqual({ max: 400_000 });
    expect(inLimit(scene.value, scene.limit ?? {})).toBe(true);
    const table = measure("triangleBudget", { entity: "table", budget: 10_000 });
    const own = (id: string) => ctx.entity(id)?.stats.triangles ?? 0;
    expect(table.value).toBe(own("table") + own("lantern"));
    expect(inLimit(table.value, table.limit ?? {})).toBe(false);
    expect(measure("triangleBudget", { tier: "low" }).limit).toBeUndefined();
  });
});
