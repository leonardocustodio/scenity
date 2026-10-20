// SPDX-License-Identifier: Apache-2.0
// The metric face of the traffic plugin: `traffic.vehicleGap` is the smallest distance of two vehicles on the floor
// plane, each pair an item, in the registry of a rule check.
import { describe, expect, test } from "bun:test";
import { createMetricContext, createMetricRegistry, type EntityFacts } from "@scenity/rules";
import trafficMetrics from "../src/dev";

function car(id: string, x: number, z: number, components = ["traffic.vehicle", "transform"]): EntityFacts {
  const bounds = { min: [x - 1, 0, z - 0.5], max: [x + 1, 1.5, z + 0.5] } as const;
  return {
    id,
    parent: null,
    tags: [],
    components,
    visible: true,
    transform: { position: [x, 0, z], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    bounds,
    sockets: {},
    joints: null,
    stats: { triangles: 0, drawCalls: 0 },
  };
}

describe("the metric face of the traffic plugin", () => {
  test("gives the smallest gap of two vehicles", () => {
    const registry = createMetricRegistry([trafficMetrics]);
    const entities = [car("a", 0, 0), car("b", 6, 0), car("c", 6, 2.5), car("tree", 1, 0, ["transform"])];
    const ctx = createMetricContext({
      facts: { simMs: null, entities, totals: { entities: 4, triangles: 0, drawCalls: 0 } },
    });
    const outcome = registry.evaluate("traffic.vehicleGap", ctx, {});
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.value).toBe(2.5);
    expect(outcome.result.items?.map((item) => item.subject)).toEqual(["a+b", "a+c", "b+c"]);
    expect(registry.describe().find((metric) => metric.id === "traffic.vehicleGap")).toMatchObject({
      plugin: "traffic",
      worst: "min",
    });
  });
});

describe("the debug layer of the traffic plugin", () => {
  test("draws a line between each two vehicles, the nearest two in red", async () => {
    const { gapsLayer } = await import("../src/dev");
    const places: Record<string, readonly [number, number, number]> = { a: [0, 0, 0], b: [6, 0, 0], c: [6, 0, 2.5] };
    const at = (x: number, z: number) => ({
      matrixWorld: { elements: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, 0, z, 1] },
    });
    const data = {
      builder: {
        entityIds: () => ["a", "b", "c", "tree"],
        componentIds: (id: string) => (id === "tree" ? ["transform"] : ["traffic.vehicle"]),
        entityObject: (id: string) => {
          const place = places[id];
          return place === undefined ? undefined : at(place[0], place[2]);
        },
      },
    };
    const lines: { from: readonly number[]; to: readonly number[]; color: readonly number[] }[] = [];
    gapsLayer.scene({ line: (from, to, color) => lines.push({ from, to, color }) }, null, data);
    expect(lines).toHaveLength(3);
    const red = lines.filter((line) => line.color[0] === 1);
    expect(red).toHaveLength(1);
    expect([red[0]?.from[0], red[0]?.to[0]]).toEqual([6, 6]);
    expect(trafficMetrics).toHaveProperty("layers");
  });
});
