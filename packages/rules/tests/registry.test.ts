// SPDX-License-Identifier: Apache-2.0
// The registry and the context of the metric library with small facts: the IDs of the built-in and the plugin
// metrics, the check of the arguments, the description of each metric, the selectors, the references and the IK goals
// of a host. The tests of runtime-dev and cli use the metrics on the sample scenes.
import { describe, expect, it } from "bun:test";
import { z } from "zod";
import {
  BUILTIN_METRICS,
  boxOverlap,
  createMetricContext,
  createMetricRegistry,
  defineMetric,
  inLimit,
  MetricRegistry,
  segmentHitsBox,
  type EntityFacts,
  type SceneFacts,
} from "../src";

function entity(id: string, patch: Partial<EntityFacts> = {}): EntityFacts {
  return {
    id,
    parent: null,
    tags: [],
    components: ["transform"],
    visible: true,
    transform: { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    bounds: null,
    sockets: {},
    joints: null,
    stats: { triangles: 0, drawCalls: 0 },
    ...patch,
  };
}

function facts(entities: EntityFacts[]): SceneFacts {
  const triangles = entities.reduce((sum, item) => sum + item.stats.triangles, 0);
  return { simMs: 1200, entities, totals: { entities: entities.length, triangles, drawCalls: 0 } };
}

const crate = entity("crate", {
  tags: ["stack"],
  transform: { position: [1, 0, 0], rotation: [0, Math.SQRT1_2, 0, Math.SQRT1_2], scale: [1, 1, 1] },
  // The box of the crate holds its lid.
  bounds: { min: [0.5, 0, -0.5], max: [1.5, 1.1, 0.5] },
  sockets: { top: [1, 1, 0] },
  stats: { triangles: 12, drawCalls: 1 },
});
const lid = entity("lid", { parent: "crate", bounds: { min: [0.6, 1, -0.4], max: [1.4, 1.1, 0.4] } });
const actor = entity("actor", {
  components: ["character", "transform"],
  joints: { leftUpperArm: [0, 1.4, 0.2], leftLowerArm: [0, 1.1, 0.2], leftHand: [0, 0.8, 0.2] },
});
const ctx = createMetricContext({ facts: facts([crate, lid, actor]) });

describe("the registry of the metrics", () => {
  it("holds the eleven built-in metrics, each with a schema and a unit", () => {
    const registry = createMetricRegistry();
    expect(registry.ids()).toEqual([
      "distance",
      "overlap",
      "belowFloor",
      "ikError",
      "jointAngle",
      "reach",
      "visible",
      "walkway",
      "routeClear",
      "triangleBudget",
      "assetRights",
    ]);
    const described = registry.describe();
    expect(described).toHaveLength(BUILTIN_METRICS.length);
    expect(described.find((item) => item.id === "distance")).toMatchObject({
      unit: "m",
      worst: "max",
      plugin: null,
      args: { type: "object", required: ["from", "to"] },
    });
    expect(described.find((item) => item.id === "jointAngle")?.worst).toBe("min");
  });

  it("checks the arguments before a metric runs", () => {
    const registry = createMetricRegistry();
    expect(registry.evaluate("nothing", ctx)).toEqual({ ok: false, reason: 'no metric "nothing"' });
    const bad = registry.evaluate("distance", ctx, { from: "crate", to: [0, 0] });
    expect(bad.ok).toBe(false);
    expect(!bad.ok && bad.reason).toStartWith("distance: from:");
    expect(registry.evaluate("jointAngle", ctx, { limb: "elbow", chain: ["a", "b", "c"] }).ok).toBe(false);
  });

  it("adds the metrics of a plugin through its dev face; a plugin metric ID starts with the plugin ID", () => {
    const gap = defineMetric({
      id: "doors.gap",
      label: "Door gap",
      unit: "m",
      args: z.strictObject({ door: z.string() }),
      evaluate: (context, args) => ({ value: context.entity(args.door) === undefined ? null : 0.01, unit: "m" }),
    });
    const registry = createMetricRegistry([{ id: "doors", library: [gap] }]);
    expect(registry.describe().at(-1)).toMatchObject({ id: "doors.gap", plugin: "doors" });
    expect(registry.evaluate("doors.gap", ctx, { door: "crate" })).toEqual({
      ok: true,
      result: { value: 0.01, unit: "m" },
    });
    expect(() => registry.use({ id: "doors", library: [gap] })).toThrow("in the registry already (doors)");
    const plain = defineMetric({ ...gap, id: "gap" });
    expect(() => new MetricRegistry().use({ id: "doors", library: [plain] })).toThrow(
      '"gap" does not start with "doors."',
    );
    // The prefix is the plugin ID, as for each part of a runtime plugin.
    const other = defineMetric({ ...gap, id: "lock.gap" });
    expect(() => new MetricRegistry().use({ id: "doors", library: [other] })).toThrow('"lock.gap" does not start');
    expect(() => defineMetric({ ...gap, id: "Doors gap" })).toThrow("is not a metric ID");
  });

  it("a null value is in each limit; a value is in a limit between min and max", () => {
    expect(inLimit(null, { max: 0 })).toBe(true);
    expect(inLimit(0.5, { min: 0.6 })).toBe(false);
    expect(inLimit(0.5, { min: 0.4, max: 0.5 })).toBe(true);
  });
});

describe("the metric context", () => {
  it("selects entities by ID, tag, component and star, and knows the subtrees", () => {
    expect(ctx.select("tag:stack")).toEqual(["crate"]);
    expect(ctx.select(["component:character", "lid", "nothing"])).toEqual(["lid", "actor"]);
    expect(ctx.select(["actor", "crate"])).toEqual(["crate", "actor"]);
    expect(ctx.select("*")).toHaveLength(3);
    expect(ctx.holds("crate", "lid")).toBe(true);
    expect(ctx.holds("lid", "crate")).toBe(false);
    expect(ctx.time).toBe(1200);
  });

  it("resolves the origin, a socket, a joint and a world point; a host resolver comes first", () => {
    expect(ctx.point("entity:crate")).toEqual([1, 0, 0]);
    expect(ctx.point("entity:crate#top")).toEqual([1, 1, 0]);
    expect(ctx.point("entity:actor#leftHand")).toEqual([0, 0.8, 0.2]);
    expect(ctx.point("entity:crate#none")).toBeNull();
    expect(ctx.point([1, 2, 3])).toEqual([1, 2, 3]);
    const hosted = createMetricContext({
      facts: facts([crate]),
      point: (ref) => (ref.endsWith("#x") ? [9, 9, 9] : null),
    });
    expect(hosted.point("entity:crate#x")).toEqual([9, 9, 9]);
    expect(hosted.point("entity:crate#top")).toEqual([1, 1, 0]);
  });

  it("takes the IK goals of a host (the hands of a figure with no character component)", () => {
    const goals = {
      actor: [{ goal: "leftHand", target: [0, 0.8, 0.25] as const, end: [0, 0.8, 0.2] as const, weight: 1 }],
    };
    const registry = createMetricRegistry();
    const result = registry.evaluate("ikError", createMetricContext({ facts: facts([actor]), goals }));
    expect(result.ok && result.result.value).toBeCloseTo(0.05, 6);
    const angle = registry.evaluate("jointAngle", ctx, { limb: "elbow" });
    expect(angle.ok && angle.result).toMatchObject({ value: 180, items: [{ subject: "actor" }] });
  });

  it("the boxes of the parents hold their children; a blocker skips the subtree of a skipped entity", () => {
    expect(ctx.blocker([1, 0.5, -3], [1, 0.5, 3], [], "bounds")).toBe("crate");
    expect(ctx.blocker([1, 1.05, -3], [1, 1.05, 3], ["crate"], "bounds")).toBeNull();
    expect(ctx.blocker([1, 1.05, -3], [1, 1.05, 3], [], "bounds")).toBe("crate");
  });
});

describe("the geometry of the metrics", () => {
  it("measures the overlap of two boxes and the hit of a segment", () => {
    const a = { min: [0, 0, 0], max: [1, 1, 1] } as const;
    expect(boxOverlap(a, { min: [0.8, 0.5, 0.2], max: [2, 2, 2] })).toBeCloseTo(0.2);
    expect(boxOverlap(a, { min: [1, 0, 0], max: [2, 1, 1] })).toBe(0);
    expect(boxOverlap(a, { min: [0.5, 2, 0.5], max: [2, 3, 2] }, [0, 2])).toBeCloseTo(0.5);
    expect(segmentHitsBox([-1, 0.5, 0.5], [2, 0.5, 0.5], a)).toBe(true);
    expect(segmentHitsBox([-1, 1, 0.5], [2, 1, 0.5], a)).toBe(false);
  });
});
