// SPDX-License-Identifier: Apache-2.0
// The trend of the bench runner: a line for each value of each backend over the runs, with the budget of the last run,
// and the points of its sparkline.
import { describe, expect, it } from "vitest";
import { isBenchReport, sparkPoints, trendLines, type BenchReportView } from "../../src/scene/performance/benchTrend";

const report = (date: string, workP95: number | null): BenchReportView => ({
  ...{ date, scene: "scenes/main.scene.json", tier: "high", quick: true },
  runs: [
    {
      ...{ backend: "webgl", status: "ok", note: null },
      measure: { workP95, intervalP95: 16.7, firstFrameMs: 900, drawCalls: 40, triangles: 1200 },
      rows: [{ key: "workP95", limit: 8, value: workP95, result: "pass" }],
    },
  ],
  verdict: { passed: true, reasons: [] },
});

describe("the trend of the bench runner", () => {
  it("gives a line for each value of each backend, the oldest run first", () => {
    const history = [report("2026-10-16", 4), report("2026-10-17", null), report("2026-10-18", 6)];
    expect(history.every(isBenchReport)).toBe(true);
    expect(isBenchReport({ error: "no build" })).toBe(false);
    const lines = trendLines(history);
    expect(lines.map((line) => line.key)).toEqual(["workP95", "intervalP95", "firstFrameMs", "drawCalls", "triangles"]);
    expect(lines[0]).toEqual({ key: "workP95", backend: "webgl", values: [4, null, 6], limit: 8 });
    expect(sparkPoints([4, null, 6], 8, 120, 28)).toBe("0.0,14.0 120.0,7.0");
    expect(sparkPoints([null], null)).toBe("");
  });
});
