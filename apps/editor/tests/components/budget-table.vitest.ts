// SPDX-License-Identifier: Apache-2.0
// The budgets editor: the rows of the quality budgets with the value of the last bench of each tier. Also the edit of a
// limit: an empty tier and an empty group go.
import { describe, expect, it } from "vitest";
import type { BenchReportView } from "../../src/scene/performance/benchTrend";
import { BUDGET_KEYS, budgetRows, groupsOf, tiersOf, withLimit } from "../../src/scene/budgets/budgetTable";

const report = (tier: string, drawCalls: number, result: string): BenchReportView => ({
  date: "2026-10-19",
  scene: "plaza",
  tier,
  quick: true,
  runs: [
    {
      backend: "webgl",
      status: "ok",
      note: null,
      measure: null,
      rows: [{ key: "drawCalls", limit: 100, value: drawCalls, result }],
    },
  ],
  verdict: { passed: result === "pass", reasons: [] },
});

describe("the budgets editor", () => {
  it("gives each key of each tier with the limit and the value of the last bench of the tier", () => {
    const budgets = { scene: { high: { drawCalls: 100, triangles: 40_000 } } };
    const history = [report("high", 80, "pass"), report("high", 120, "over"), report("low", 10, "pass")];
    const rows = budgetRows(budgets, "scene", ["high", "low"], history);
    expect(rows).toHaveLength(2 * BUDGET_KEYS.length);
    expect(rows.find((row) => row.tier === "high" && row.key === "drawCalls")).toMatchObject({
      limit: 100,
      value: 120,
      result: "over",
    });
    expect(rows.find((row) => row.tier === "high" && row.key === "triangles")).toMatchObject({
      limit: 40_000,
      value: null,
      result: null,
    });
    expect(rows.find((row) => row.tier === "low" && row.key === "drawCalls")).toMatchObject({ limit: null, value: 10 });
    expect(tiersOf({})).toEqual(["ultra", "high", "medium", "low"]);
    expect(tiersOf({ quality: { tiers: ["high"] } })).toEqual(["high"]);
    expect(groupsOf({ "scene.webgpu": {} })).toEqual(["scene", "scene.webgpu"]);
  });

  it("sets and takes out a limit, and leaves out an empty tier and an empty group", () => {
    const one = withLimit({}, "scene", "high", "drawCalls", 50);
    expect(one).toEqual({ scene: { high: { drawCalls: 50 } } });
    const two = withLimit(one, "scene", "high", "triangles", 1000);
    expect(two).toEqual({ scene: { high: { drawCalls: 50, triangles: 1000 } } });
    expect(withLimit(two, "scene", "high", "drawCalls", null)).toEqual({ scene: { high: { triangles: 1000 } } });
    expect(withLimit(one, "scene", "high", "drawCalls", null)).toEqual({});
  });
});
