// SPDX-License-Identifier: Apache-2.0
// The form of the rules editor: the metric picker with the fields of the arguments from their JSON Schema, and a draft
// of a rule and back. Also the scope, a bad argument, and a rule ID of another rule.
import { describe, expect, it } from "vitest";
import { draftFromValue, draftOf, emptyDraft, metricChoices, ruleOf } from "../../src/scene/rules/ruleForm";
import { parseRulesLog, rulesLogPath } from "../../src/scene/rules/rulesLog";
import { withRule } from "../../src/scene/rules/ruleTargets";

const choices = metricChoices();
const choice = (id: string) => {
  const found = choices.find((each) => each.id === id);
  if (found === undefined) throw new Error(id);
  return found;
};

describe("the form of the rules editor", () => {
  it("lists the built-in metrics with the fields of their arguments", () => {
    expect(choices.map((each) => each.id)).toEqual(
      expect.arrayContaining(["distance", "overlap", "belowFloor", "visible", "triangleBudget"]),
    );
    const distance = choice("distance");
    const from = distance.fields.find((field) => field.name === "from");
    expect(from).toMatchObject({ kind: "selector", entityRef: true });
    const overlap = choice("overlap").fields.find((field) => field.name === "mode");
    expect(overlap).toMatchObject({ kind: "choice", fallback: "bounds" });
  });

  it("makes a rule of a draft and a draft of a rule", () => {
    const draft = {
      ...emptyDraft("distance"),
      id: "lampNear",
      args: { from: "entity:lamp", to: "[0, 1, 0]" },
      max: "2",
      level: "block" as const,
      scope: "range" as const,
      from: "0",
      to: "pickup",
      step: "100",
      note: "Near the table.",
    };
    const made = ruleOf(draft, choice("distance"));
    expect(made).toEqual({
      ok: true,
      rule: {
        id: "lampNear",
        metric: "distance",
        args: { from: "entity:lamp", to: [0, 1, 0] },
        scope: { kind: "range", from: 0, to: "pickup", step: 100 },
        max: 2,
        level: "block",
        note: "Near the table.",
      },
    });
    if (made.ok) expect(ruleOf(draftOf(made.rule), choice("distance"))).toEqual(made);
  });

  it("refuses a bad argument, a rule with no ID, and an ID of another rule", () => {
    const bad = { ...emptyDraft("distance"), id: "x", args: { from: "[1, 2" } };
    expect(ruleOf(bad, choice("distance"))).toEqual({ ok: false, reason: "args/from" });
    expect(ruleOf(emptyDraft("distance"), choice("distance")).ok).toBe(false);
    const rule = { id: "a", metric: "distance", level: "warn" as const };
    expect(withRule([rule], { ...rule, id: "b" }, null)).toHaveLength(2);
    expect(withRule([rule, { ...rule, id: "b" }], { ...rule, id: "b" }, "a")).toContain("the ID b");
    expect(withRule([rule], { ...rule, max: 1 }, "a")).toEqual([{ ...rule, max: 1 }]);
  });

  it("makes the draft of a measure with its value now as the limit", () => {
    const distance = choice("distance");
    const draft = draftFromValue(distance, { from: "entity:a", to: [0, 0, 1] }, 2.02237);
    expect(draft.args).toEqual({ from: "entity:a", to: "[0,0,1]" });
    expect(distance.worst === "max" ? draft.max : draft.min).toBe("2.022");
  });

  it("reads the rules log of a scene, the newest first", () => {
    expect(rulesLogPath("scenes/main.scene.json")).toBe("scenes/main.rules-log.jsonl");
    expect(rulesLogPath("pickup.sequence.json")).toBe("pickup.rules-log.jsonl");
    const line = (reason: string, hash: string) =>
      JSON.stringify({ time: "2026-10-18T10:00:00.000Z", scene: "scenes/main.scene.json", hash, reason, rules: [] });
    const log = parseRulesLog(`${line("first", "aa")}\nnot json\n${line("second", "bb")}\n`);
    expect(log.map((entry) => [entry.reason, entry.hash])).toEqual([
      ["second", "bb"],
      ["first", "aa"],
    ]);
  });
});
