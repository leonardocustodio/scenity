// SPDX-License-Identifier: Apache-2.0
// The values of the Performance panel: a row for each value of the frame statistics, and the cost of each entity, the
// most first. An absent number gives no row, and an unknown key shows as JSON.
import type { SceneStats } from "@scenity/runtime/protocol";
import type { SceneInspectReport } from "@scenity/runtime-dev/document/report";
import { describe, expect, it } from "vitest";
import { entityCosts, statRows } from "../../src/scene/performance/perfStats";

const STATS: SceneStats = {
  ...{ mode: "worker", tier: "high", frames: 120, intervalP50: 16.6, intervalP95: 20, workP50: 3, workP95: 5 },
  ...{ updateP95: 1, renderP95: 2, poseP95: 0.5, memory: { geometries: 12, textures: 8, programs: 4 }, heapMb: 42 },
  ...{ drawCalls: 30, triangles: 55332, entities: 20, instances: 0, visibleEntities: 15, effects: ["fxaa"] },
  ...{ assets: "ready", loads: { a: "ready", b: "loading" }, failures: [], gpu: null, backend: "webgl" },
};

describe("the values of the Performance panel", () => {
  it("gives a row for each value of the statistics", () => {
    const rows = statRows(STATS);
    expect(rows.map((row) => row.key)).toEqual(Object.keys(STATS));
    const text = Object.fromEntries(rows.map((row) => [row.key, row.text]));
    expect(text.intervalP50).toBe("16.60 ms (60 fps)");
    expect(text.memory).toBe("12 · 8 · 4");
    expect(text.loads).toBe("1 / 2");
    expect(text.triangles).toBe("55,332");
    const odd = statRows({ ...STATS, workP95: undefined, extra: 1 } as unknown as SceneStats);
    expect(odd.find((row) => row.key === "workP95")).toBeUndefined();
    expect(odd.find((row) => row.key === "extra")).toEqual({ key: "extra", label: "perf-stat-other", text: "1" });
  });

  it("lists the entities with a cost, the most triangles first", () => {
    const entity = (id: string, triangles: number, drawCalls: number) => ({
      id,
      name: id === "b" ? "Bench" : null,
      stats: { meshes: 1, triangles, drawCalls, instanced: false, lod: null },
    });
    const report = { entities: [entity("a", 10, 1), entity("b", 500, 2), entity("c", 0, 0)] };
    expect(entityCosts(report as unknown as SceneInspectReport).map((cost) => [cost.id, cost.name])).toEqual([
      ["b", "Bench"],
      ["a", "a"],
    ]);
  });
});
