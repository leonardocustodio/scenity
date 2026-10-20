// SPDX-License-Identifier: Apache-2.0
// The rules as data: the rules document, and the `rules` lists of the project,
// the scene and the sequence. Read then write gives the same bytes, and an error names its path.
import { describe, expect, test } from "bun:test";
import { readDocument, writeDocument } from "../src/index";

const RULES = {
  format: "scenity.rules/1",
  id: "layout",
  rules: [
    {
      args: { from: "door", to: "desk" },
      id: "layout.walkway",
      level: "block",
      metric: "walkway",
      min: 0.6,
      provisional: true,
      unit: "m",
    },
    {
      id: "pickup.reach",
      level: "warn",
      max: 0.02,
      metric: "ikError",
      scope: { kind: "marker", marker: ["reach", "pickup"], sequence: "pickup" },
    },
    {
      id: "tour.range",
      level: "warn",
      max: 1,
      metric: "distance",
      scope: { from: "start", kind: "range", step: 250, to: 4000 },
    },
    {
      id: "cart.floor",
      level: "block",
      max: 0.001,
      metric: "belowFloor",
      scope: { entity: ["cart", "tag:movable"], kind: "entity" },
    },
  ],
};

function text(value: unknown): string {
  return `${JSON.stringify(value, null, 2)}\n`;
}

describe("the rules as data", () => {
  test("a rules document reads, and a write gives the same bytes", () => {
    const result = readDocument(text(RULES), "rules");
    if (!result.ok) throw new Error(JSON.stringify(result.errors));
    expect(result.doc.rules.map((rule) => rule.scope?.kind ?? "scene")).toEqual(["scene", "marker", "range", "entity"]);
    const written = writeDocument(result.doc);
    expect(written).toBe(text(RULES));
    const again = readDocument(written, "rules");
    expect(again.ok && writeDocument(again.doc)).toBe(written);
  });

  test("an error names the path: a level, a scope, a limit and an ID two times", () => {
    const bad = (patch: Record<string, unknown>, index = 0) => {
      const rules = RULES.rules.map((rule, at) => (at === index ? { ...rule, ...patch } : rule));
      const result = readDocument(text({ ...RULES, rules }), "rules");
      return result.ok ? "" : `${result.errors[0]?.path ?? ""} ${result.errors[0]?.message ?? ""}`;
    };
    expect(bad({ level: "stop" })).toStartWith("/rules/0/level");
    expect(bad({ scope: { kind: "time" } })).toStartWith("/rules/0/scope/kind");
    expect(bad({ scope: { kind: "range", from: 0, to: 10 } })).toStartWith("/rules/0/scope/step");
    expect(bad({ min: 2, max: 1 })).toBe("/rules/0/max min is not more than max");
    expect(bad({ id: "pickup.reach" })).toBe("/rules each rule ID is in the list one time");
    expect(bad({ metric: "Walkway" })).toStartWith("/rules/0/metric");
  });

  test("the project lists rules documents and rules; a path ends with .rules.json", () => {
    const project = { format: "scenity.project/1", id: "shop", name: "Shop", scenes: [] };
    const good = readDocument(text({ ...project, rules: ["rules/layout.rules.json", RULES.rules[0]] }), "project");
    expect(good.ok).toBe(true);
    const path = readDocument(text({ ...project, rules: ["rules/layout.json"] }), "project");
    expect(path.ok).toBe(false);
    const twice = readDocument(text({ ...project, rules: [RULES.rules[0], RULES.rules[0]] }), "project");
    expect(twice.ok ? "" : twice.errors[0]?.message).toBe("each rule ID is in the list one time");
  });

  test("a scene and a sequence have rules", () => {
    const scene = { format: "scenity.scene/1", id: "main", entities: {}, rules: [RULES.rules[3]] };
    expect(readDocument(text(scene), "scene").ok).toBe(true);
    const sequence = {
      format: "scenity.sequence/1",
      id: "pickup",
      scene: "main",
      duration: 8000,
      markers: { reach: 4500 },
      tracks: [],
      rules: [{ id: "reach", level: "warn", max: 0.02, metric: "ikError", scope: { kind: "marker", marker: "reach" } }],
    };
    const result = readDocument(text(sequence), "sequence");
    expect(result.ok && result.doc.rules?.[0]?.scope).toEqual({ kind: "marker", marker: "reach" });
  });
});
