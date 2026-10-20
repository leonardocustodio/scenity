// SPDX-License-Identifier: Apache-2.0
// The check job: the status of each rule of a scene over its times, the rules where the check and the page are
// different, and the rows that do not pass as problems.
import { describe, expect, it } from "vitest";
import { checkProblems, differences, ruleStatuses, type CheckRow } from "../../src/scene/problems/checkJob";

const row = (rule: string, status: string, time = "scene", scene = "scenes/main.scene.json"): CheckRow => ({
  ...{ scene, sequence: null, rule, metric: "distance", level: "block" as const, status, scope: "scene", time },
  ...{ value: 1, unit: "m", limit: "max 2 m", detail: `${rule} ${status}` },
});

describe("the check job", () => {
  it("compares the check with the page check, rule by rule", () => {
    const rows = [
      row("a", "pass", "0 ms"),
      row("a", "fail", "500 ms"),
      row("b", "pass"),
      row("c", "pass", "scene", "x"),
    ];
    expect(ruleStatuses(rows, "scenes/main.scene.json")).toEqual(
      new Map([
        ["a", "fail"],
        ["b", "pass"],
      ]),
    );
    const page = [
      { id: "a", status: "fail" },
      { id: "b", status: "pass" },
    ];
    expect(differences(rows, "scenes/main.scene.json", page)).toEqual([]);
    expect(differences(rows, "scenes/main.scene.json", [{ id: "a", status: "pass" }])).toEqual(["a", "b"]);
    expect(checkProblems(rows).map((problem) => problem.title)).toEqual([
      "scenity check: a fails in scenes/main.scene.json at 500 ms",
    ]);
  });
});
