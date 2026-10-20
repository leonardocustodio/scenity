// SPDX-License-Identifier: Apache-2.0
/**
 * The bench of the samples: the runs, the worst exit code and the summary with
 * the rule of CI. No browser starts here.
 */
import { describe, expect, test } from "bun:test";
import { parseBenchArgs } from "../packages/cli/src/bench/index";
import { SAMPLE_RUNS, summaryMarkdown, SUMMARY_RULE, worstCode } from "./bench-samples";

describe("bench:samples", () => {
  test("the runs: showroom main and crowd at the medium tier, characters walk-wave, walkthrough, sim-road", () => {
    expect(SAMPLE_RUNS.map((run) => run.name)).toEqual([
      "showroom-main-medium",
      "showroom-crowd-medium",
      "characters-walk-wave",
      "walkthrough-meet",
      "sim-road-rush",
    ]);
    for (const run of SAMPLE_RUNS) expect(parseBenchArgs([run.dir, ...run.args, "--quick"])).not.toBeNull();
  });

  test("the worst exit code: 1 before 3 before 0", () => {
    expect(worstCode([0, 3, 0])).toBe(3);
    expect(worstCode([3, 1])).toBe(1);
    expect(worstCode([])).toBe(0);
  });

  test("the summary states the rule of CI and lists the failures", () => {
    const text = summaryMarkdown([], ["characters-walk-wave: no build"]);
    expect(text).toContain(SUMMARY_RULE);
    expect(text).toContain("judges no budget");
    expect(text).toContain("- characters-walk-wave: no build");
  });
});
