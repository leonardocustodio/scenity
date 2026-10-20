// SPDX-License-Identifier: Apache-2.0
// The checks of the agent benchmark: each check fails on the project before the task and passes after a right answer.
// No model runs in these tests.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CASES } from "./cases";
import { copySample } from "./project";
import { SOLUTIONS } from "./solutions";

const root = mkdtempSync(join(tmpdir(), "agent-bench-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));

describe("the cases of the agent benchmark", () => {
  test("24 cases with unique IDs over the samples", () => {
    expect(CASES).toHaveLength(24);
    expect(new Set(CASES.map((c) => c.id)).size).toBe(24);
  });

  for (const benchCase of CASES) {
    test(`${benchCase.id}: the check fails before the task and passes after a right answer`, () => {
      const project = copySample(benchCase.sample, join(root, benchCase.id));
      benchCase.setup?.(project);
      const before = project.scene();
      expect(benchCase.check(project, { before, answer: "" }).pass).toBe(false);
      const solve = SOLUTIONS[benchCase.id] ?? benchCase.solve;
      expect(solve).toBeDefined();
      const answer = solve?.(project) ?? "";
      const result = benchCase.check(project, { before, answer });
      if (!result.pass) console.error(benchCase.id, result.detail);
      expect(result.pass).toBe(true);
    }, 120_000);
  }
});
