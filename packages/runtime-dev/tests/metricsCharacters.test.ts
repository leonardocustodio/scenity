// SPDX-License-Identifier: Apache-2.0
// The metric library on the characters sample: the metrics of a body and of a walk run on the scene of a document core
// at the times of a sequence, with the robot model and no render. The pickup scene: the robot walks to the table
// (arrival at 3800 ms), reaches for the cup with an IK goal (its weight goes from 0 at 4100 ms to 1 at 4900 ms) and
// carries it from 5000 ms. The table scene: the robot walks around a table.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { createMetricRegistry, inLimit, type MetricContext, type MetricResult } from "@scenity/rules";
import { MetricScene, RobotAssets, sampleScene, sampleSequence } from "./metricHelpers";

const registry = createMetricRegistry();
const PICKUP = sampleScene("characters/scenes/pickup.scene.json");
const PICKUP_SEQUENCE = sampleSequence("characters/sequences/pickup.sequence.json");
/** The feet of the robot (node names: its rig profile maps the arms, not the legs). */
const FEET = ["FootL", "FootR"];

function measure(id: string, ctx: MetricContext, args: unknown = {}): MetricResult {
  const outcome = registry.evaluate(id, ctx, args);
  if (!outcome.ok) throw new Error(outcome.reason);
  return outcome.result;
}

let pickup: MetricScene;

beforeAll(async () => {
  pickup = await new MetricScene(new RobotAssets()).load(PICKUP, PICKUP_SEQUENCE, 0);
});

afterAll(() => {
  pickup.dispose();
});

describe("the metrics of a body on the pickup scene", () => {
  it("ikError: half way in the reach the hand is off its target; at full weight it is on it", async () => {
    const half = (await pickup.at(4500)).context();
    expect(half.ikGoals("robot")).toMatchObject([{ goal: "rightHand", weight: 0.5 }]);
    const off = measure("ikError", half);
    expect(off.items?.[0]?.subject).toBe("robot#rightHand");
    expect(inLimit(off.value, { max: 0.02 })).toBe(false);
    expect(measure("ikError", half, { minWeight: 0.99 }).value).toBeNull();
    const full = measure("ikError", (await pickup.at(4900)).context());
    expect(full.value).toBeLessThan(0.001);
    // Before the reach the goal has no weight: the metric does not apply.
    expect(measure("ikError", (await pickup.at(3800)).context()).value).toBeNull();
  });

  it("ikError: a cup out of the reach of the arm leaves the hand far from its target", async () => {
    const far = new MetricScene(new RobotAssets());
    await far.load(PICKUP, PICKUP_SEQUENCE, 4900);
    await far.core.patch([
      { op: "set", path: "/entities/cup/components/transform/position", value: [-0.2, 0.55, -1.4] },
    ]);
    const error = measure("ikError", far.context(), { goal: "rightHand" });
    expect(error.value).toBeGreaterThan(0.05);
    expect(inLimit(error.value, { max: 0.02 })).toBe(false);
    far.dispose();
  });

  it("jointAngle: the elbow is open in the reach and sharp in the carry", async () => {
    const reach = measure("jointAngle", (await pickup.at(4900)).context(), { limb: "elbow" });
    expect(reach.unit).toBe("deg");
    expect(inLimit(reach.value, { min: 60 })).toBe(true);
    const carry = measure("jointAngle", (await pickup.at(6500)).context(), { limb: "elbow" });
    expect(carry.value).toBeLessThan(reach.value ?? 0);
    expect(inLimit(carry.value, { min: 60 })).toBe(false);
    const knee = measure("jointAngle", pickup.context(), { chain: ["UpperLegL", "LowerLegL", "FootL"] });
    expect(knee.value).toBeGreaterThan(90);
    expect(registry.evaluate("jointAngle", pickup.context(), {}).ok).toBe(false);
  });

  it("reach: the cup is out of reach at the start and in reach at the table", async () => {
    const args = { entity: "robot", target: "entity:cup#grip", arm: 0.75 };
    const start = measure("reach", (await pickup.at(0)).context(), args);
    expect(start.detail).toContain("out of reach");
    expect(inLimit(start.value, { min: 0 })).toBe(false);
    const there = measure("reach", (await pickup.at(3800)).context(), args);
    expect(inLimit(there.value, { min: 0 })).toBe(true);
    expect(measure("reach", pickup.context(), { ...args, arm: 0.3 }).value).toBeLessThan(0);
  });

  it("distance: the right hand reaches the grip of the cup", async () => {
    const args = { from: "entity:robot#rightHand", to: "entity:cup#grip" };
    expect(measure("distance", (await pickup.at(3800)).context(), args).value).toBeGreaterThan(0.3);
    expect(measure("distance", (await pickup.at(4900)).context(), args).value).toBeLessThan(0.001);
  });

  it("belowFloor: the feet stay on the floor; a robot under the floor fails", async () => {
    const feet = { entity: "robot", joints: FEET };
    const ok = measure("belowFloor", (await pickup.at(2000)).context(), feet);
    expect(inLimit(ok.value, { max: 0.01 })).toBe(true);
    const sunk = new MetricScene(new RobotAssets());
    await sunk.load(PICKUP, PICKUP_SEQUENCE, 2000);
    await sunk.core.patch([{ op: "set", path: "/entities/robot/components/transform/position/1", value: -0.1 }]);
    const low = measure("belowFloor", sunk.context(), feet);
    expect(low.value).toBeGreaterThan(0.05);
    expect(inLimit(low.value, { max: 0.01 })).toBe(false);
    sunk.dispose();
  });
});

describe("the metrics of a walk on the characters sample", () => {
  it("walkway and routeClear: the walk to the table of the pickup scene", () => {
    const ctx = pickup.context();
    expect(ctx.walks("robot")).toHaveLength(1);
    const walkway = measure("walkway", ctx, { route: { walk: "robot" }, room: "floor" });
    expect(walkway.items?.[0]?.subject).toBe("robot leg 0");
    expect(inLimit(walkway.value, { min: 0.6 })).toBe(true);
    expect(measure("routeClear", ctx, { route: { walk: "robot" }, margin: 0.2 }).value).toBe(0);
  });

  it("walkway and routeClear: the walk around the table of the table scene", async () => {
    const table = new MetricScene(new RobotAssets());
    await table.load(
      sampleScene("characters/scenes/table.scene.json"),
      sampleSequence("characters/sequences/table-walk.sequence.json"),
      2000,
    );
    const ctx = table.context();
    const route = { walk: "robot" };
    expect(inLimit(measure("walkway", ctx, { route, room: "floor" }).value, { min: 0.6 })).toBe(true);
    // A narrow room of 1.2 m by 3 m around the walk leaves less free width than the limit.
    const room = { minX: -2.6, maxX: 0.4, minZ: -1.4, maxZ: 1.6 };
    expect(inLimit(measure("walkway", ctx, { route, room }).value, { min: 2.2 })).toBe(false);
    // The walk keeps the clearance of the path planner (28 cm) from the table: 20 cm is clear, 40 cm is not.
    expect(measure("routeClear", ctx, { route, margin: 0.2 }).value).toBe(0);
    const near = measure("routeClear", ctx, { route, margin: 0.4 });
    expect(near).toMatchObject({ value: 1, items: [{ subject: "table" }] });
    expect(inLimit(near.value, { max: 0 })).toBe(false);
    table.dispose();
  });
});
