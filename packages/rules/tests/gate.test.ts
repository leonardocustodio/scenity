// SPDX-License-Identifier: Apache-2.0
// The one gate of the rules with small facts: the times of each scope, the statuses of a rule (pass, fail, known, n/a,
// error), the levels block and warn, the known gaps, the provisional limits and the reason of the owner.
import { describe, expect, it } from "bun:test";
import type { Rule } from "@scenity/scene";
import {
  createMetricContext,
  createMetricRegistry,
  documentRules,
  evaluateRules,
  gateRules,
  MAX_RULE_TIMES,
  scopeTimes,
  type EntityFacts,
  type MetricContext,
  type RuleSequence,
  type RuleTime,
} from "../src";

function entity(id: string, x: number, patch: Partial<EntityFacts> = {}): EntityFacts {
  return {
    id,
    parent: null,
    tags: [],
    components: ["transform"],
    visible: true,
    transform: { position: [x, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    bounds: null,
    sockets: {},
    joints: null,
    stats: { triangles: 0, drawCalls: 0 },
    ...patch,
  };
}

/** A box that stands on the floor at x, or goes under it by `sink` metres. */
function box(id: string, x: number, sink = 0): EntityFacts {
  return entity(id, x, {
    components: ["model", "transform"],
    bounds: { min: [x - 0.2, -sink, -0.2], max: [x + 0.2, 0.4 - sink, 0.2] },
    stats: { triangles: 1000, drawCalls: 1 },
  });
}

/** The cart moves 1 m per second along x; the crate stays at 0. At 4 s the crate sinks under the floor. */
function context(t: number | null): MetricContext {
  const at = t ?? 0;
  const entities = [box("crate", 0, at >= 4000 ? 0.05 : 0), box("cart", at / 1000)];
  return createMetricContext({
    facts: { simMs: t, entities, totals: { entities: 2, triangles: 2000, drawCalls: 2 } },
  });
}

const registry = createMetricRegistry();
const TOUR: RuleSequence = {
  id: "tour",
  duration: 6000,
  markers: { start: 0, stop: 3000 },
  tracks: [{ keys: [{ t: 0 }, { t: 1500 }, { t: 3000 }, { t: 5000 }] }],
};
const sequences = { tour: TOUR };
const gap = { from: "entity:crate", to: "entity:cart" };

function rule(patch: Partial<Rule> & Pick<Rule, "id" | "metric">): Rule {
  return { level: "block", ...patch };
}

function times(list: readonly RuleTime[]): (number | null)[] {
  return list.map((at) => at.t);
}

describe("the scopes of the rules", () => {
  it("scene and entity: one time with no sequence", () => {
    expect(scopeTimes({ kind: "scene" }, sequences)).toEqual({ ok: true, times: [{ sequence: null, t: null }] });
    expect(scopeTimes({ kind: "entity", entity: "crate" }, sequences)).toMatchObject({ ok: true });
  });

  it("sequence: each marker and each key time in order, each time one time, with the marker names", () => {
    const found = scopeTimes({ kind: "sequence", sequence: "tour" }, sequences);
    if (!found.ok) throw new Error(found.reason);
    expect(times(found.times)).toEqual([0, 1500, 3000, 5000]);
    expect(found.times[2]).toEqual({ sequence: "tour", t: 3000, marker: "stop" });
    expect(scopeTimes({ kind: "sequence" }, sequences)).toEqual({
      ok: false,
      reason: "a sequence scope names no sequence",
    });
    expect(scopeTimes({ kind: "sequence", sequence: "other" }, sequences)).toEqual({
      ok: false,
      reason: 'no sequence "other"',
    });
  });

  it("range: from a marker to a time at a step, with the end; a range with too many times has an error", () => {
    const found = scopeTimes({ kind: "range", sequence: "tour", from: "stop", to: 4000, step: 400 }, sequences);
    if (!found.ok) throw new Error(found.reason);
    expect(times(found.times)).toEqual([3000, 3400, 3800, 4000]);
    const many = scopeTimes({ kind: "range", sequence: "tour", from: 0, to: MAX_RULE_TIMES * 10, step: 1 }, sequences);
    expect(many).toMatchObject({ ok: false });
    expect(scopeTimes({ kind: "range", sequence: "tour", from: 2000, to: 1000, step: 10 }, sequences)).toMatchObject({
      ok: false,
    });
  });

  it("marker: the time of each marker; a missing marker has an error", () => {
    const found = scopeTimes({ kind: "marker", sequence: "tour", marker: ["stop", "start"] }, sequences);
    if (!found.ok) throw new Error(found.reason);
    expect(found.times).toEqual([
      { sequence: "tour", t: 3000, marker: "stop" },
      { sequence: "tour", t: 0, marker: "start" },
    ]);
    expect(scopeTimes({ kind: "marker", sequence: "tour", marker: "end" }, sequences)).toEqual({
      ok: false,
      reason: 'the sequence "tour" has no marker "end"',
    });
  });

  it("documentRules: the default scope is scene, or the sequence of a sequence document", () => {
    const rules = [
      rule({ id: "a", metric: "distance" }),
      rule({ id: "b", metric: "distance", scope: { kind: "marker", marker: "stop" } }),
    ];
    expect(documentRules(rules).map((item) => item.scope)).toEqual([
      { kind: "scene" },
      { kind: "marker", marker: "stop" },
    ]);
    expect(documentRules(rules, "tour").map((item) => item.scope)).toEqual([
      { kind: "sequence", sequence: "tour" },
      { kind: "marker", marker: "stop", sequence: "tour" },
    ]);
  });
});

describe("evaluateRules", () => {
  it("a limit gives pass or fail at each time; the status of the rule is its worst time", () => {
    const [near, far] = evaluateRules(
      [
        rule({
          id: "near",
          metric: "distance",
          args: gap,
          max: 2,
          unit: "m",
          scope: { kind: "sequence", sequence: "tour" },
        }),
        rule({
          id: "far",
          metric: "distance",
          args: gap,
          max: 2,
          scope: { kind: "marker", sequence: "tour", marker: "start" },
        }),
      ],
      registry,
      (at) => context(at.t),
      { sequences },
    );
    expect(near?.times.map((item) => item.status)).toEqual(["pass", "pass", "fail", "fail"]);
    expect(near?.status).toBe("fail");
    expect(near?.detail).toBe("at 3000 ms (stop): 3 m (300.0 cm in space), max 2 m");
    expect(near?.limit).toEqual({ max: 2 });
    expect(far?.status).toBe("pass");
  });

  it("known: a failure of a rule with a known gap is a known failure, not a block", () => {
    const [result] = evaluateRules(
      [rule({ id: "gap", metric: "distance", args: gap, min: 1, known: "the cart starts at the crate" })],
      registry,
      (at) => context(at.t),
    );
    expect(result).toMatchObject({ status: "known", known: "the cart starts at the crate" });
    const gate = gateRules(result === undefined ? [] : [result]);
    expect(gate).toMatchObject({ passed: true, allowed: true, blocks: [] });
    expect(gate.known.map((item) => item.id)).toEqual(["gap"]);
    expect(gate.message).toBe("The rules pass. Known gaps: gap.");
  });

  it("n/a: no context at a time, a metric with no value, a rule with no limit", () => {
    const results = evaluateRules(
      [
        rule({
          id: "late",
          metric: "distance",
          args: gap,
          max: 1,
          scope: { kind: "marker", sequence: "tour", marker: "stop" },
        }),
        rule({ id: "none", metric: "distance", args: { from: "entity:nothing", to: "entity:cart" }, max: 1 }),
        rule({ id: "open", metric: "distance", args: gap }),
      ],
      registry,
      (at) => (at.t === null ? context(null) : null),
      { sequences },
    );
    expect(results.map((item) => item.status)).toEqual(["n/a", "n/a", "n/a"]);
    expect(results[0]?.detail).toBe("at 3000 ms (stop): no metric context at 3000 ms (stop)");
    expect(results[2]?.detail).toContain("the rule has no limit");
  });

  it("error: no metric, bad arguments, another unit and a bad scope; an error of a block rule stops the save", () => {
    const results = evaluateRules(
      [
        rule({ id: "missing", metric: "doors.gap", max: 1 }),
        rule({ id: "args", metric: "distance", args: { from: 3 }, max: 1 }),
        rule({ id: "unit", metric: "distance", args: gap, max: 1, unit: "deg" }),
        rule({ id: "scope", metric: "distance", args: gap, max: 1, scope: { kind: "marker", marker: "stop" } }),
      ],
      registry,
      (at) => context(at.t),
      { sequences },
    );
    expect(results.map((item) => item.status)).toEqual(["error", "error", "error", "error"]);
    expect(results[0]?.detail).toBe('no metric "doors.gap"');
    expect(results[2]?.detail).toBe("the rule has the unit deg, the metric gives m");
    expect(results[3]?.detail).toBe("a marker scope names no sequence");
    expect(gateRules(results).blocks).toHaveLength(4);
  });

  it("the limit of the metric applies when the rule has none (a budget)", () => {
    const [over, under] = evaluateRules(
      [
        rule({ id: "over", metric: "triangleBudget", args: { budget: 1500 } }),
        rule({ id: "under", metric: "triangleBudget", args: { budget: 2500 } }),
      ],
      registry,
      (at) => context(at.t),
    );
    expect(over).toMatchObject({ status: "fail", limit: null });
    expect(over?.detail).toContain("max 1500 triangles");
    expect(under?.status).toBe("pass");
  });

  it("entity: the items of the metric for the entities of the scope", () => {
    const rules = [
      rule({
        id: "crate",
        metric: "belowFloor",
        args: { entity: "component:model" },
        max: 0.01,
        scope: { kind: "entity", entity: "crate" },
      }),
      rule({
        id: "cart",
        metric: "belowFloor",
        args: { entity: "component:model" },
        max: 0.01,
        scope: { kind: "entity", entity: "cart" },
      }),
      rule({
        id: "nothing",
        metric: "belowFloor",
        args: { entity: "component:model" },
        max: 0.01,
        scope: { kind: "entity", entity: "lamp" },
      }),
      rule({ id: "plain", metric: "distance", args: gap, max: 1, scope: { kind: "entity", entity: "crate" } }),
    ];
    const results = evaluateRules(rules, registry, () => context(4000));
    expect(results.map((item) => item.status)).toEqual(["fail", "pass", "n/a", "n/a"]);
    expect(results[0]?.detail).toStartWith("0.05 m (crate: low point at -5.0 cm");
    expect(results[3]?.detail).toBe("the metric gives no items for an entity scope");
  });

  it("one context per time: the rules at the same time share it", () => {
    const seen: (number | null)[] = [];
    const scope = { kind: "sequence", sequence: "tour" } as const;
    evaluateRules(
      [
        rule({ id: "a", metric: "distance", args: gap, max: 9, scope }),
        rule({ id: "b", metric: "distance", args: gap, min: 0, scope }),
      ],
      registry,
      (at) => {
        seen.push(at.t);
        return context(at.t);
      },
      { sequences },
    );
    expect(seen).toEqual([0, 1500, 3000, 5000]);
  });
});

describe("gateRules", () => {
  const results = evaluateRules(
    [
      rule({ id: "layout.gap", metric: "distance", args: gap, min: 1, provisional: true }),
      rule({ id: "layout.reach", metric: "distance", args: gap, max: -1, level: "warn" }),
      rule({ id: "layout.ok", metric: "distance", args: gap, max: 1 }),
    ],
    registry,
    () => context(0),
  );

  it("a failed block rule stops the save; a warn rule does not; the words name a provisional limit", () => {
    expect(results.map((item) => [item.id, item.status, item.provisional === true])).toEqual([
      ["layout.gap", "fail", true],
      ["layout.reach", "fail", false],
      ["layout.ok", "pass", false],
    ]);
    const gate = gateRules(results);
    expect(gate).toMatchObject({ passed: false, allowed: false, override: null });
    expect(gate.blocks.map((item) => item.id)).toEqual(["layout.gap"]);
    expect(gate.warns.map((item) => item.id)).toEqual(["layout.reach"]);
    expect(gate.message).toStartWith("1 block rule fail: layout.gap (provisional): 0 m");
    expect(gate.message).toEndWith("Give a reason to save anyway.");
  });

  it("a reason of the owner lets a failed gate go; an empty reason does not", () => {
    expect(gateRules(results, "  ")).toMatchObject({ allowed: false, override: null });
    const gate = gateRules(results, "the gap  is\nfine for the demo");
    expect(gate).toMatchObject({ passed: false, allowed: true, override: "the gap is fine for the demo" });
    expect(gate.message).toEndWith("Overridden: the gap is fine for the demo");
    // A gate that passes keeps no override.
    expect(gateRules(results.slice(1), "no need")).toMatchObject({ passed: true, override: null });
  });
});
