// SPDX-License-Identifier: Apache-2.0
// The generic layout search on a small patio scene: a table, a chair and a lamp. The rule `lampNearTable` fails at the
// start. The search moves and turns the lamp, and its variants pass the rules with a better margin. The same seed gives
// the same variants (a named random stream), and another seed gives others.
import { describe, expect, it } from "bun:test";
import type { Rule } from "@scenity/scene";
import { builtinRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  createMetricContext,
  createMetricRegistry,
  evaluateRules,
  gateRules,
  marginObjective,
  onGrid,
  quatOfYaw,
  ruleMargin,
  searchLayout,
  seededStream,
  writeOps,
  written,
  yawOfQuat,
  type EntityFacts,
  type RuleResult,
  type SearchLayoutOptions,
  type SearchOp,
} from "../src";

function entity(name: string, index: number, position: number[], rotation?: number[]) {
  return {
    name,
    parent: null,
    index,
    components: { transform: { position, ...(rotation === undefined ? {} : { rotation }) } },
  };
}

const PATIO = {
  format: "scenity.scene/1",
  id: "patio",
  name: "Patio",
  entities: {
    table: entity("Table", 0, [0, 0, 0]),
    chair: entity("Chair", 1, [0.9, 0, 0]),
    lamp: entity("Lamp", 2, [1.6, 0, 0.4], [0, 0, 0, 1]),
  },
} as unknown as SceneDocument;

interface TransformValue {
  readonly position: [number, number, number];
  readonly rotation?: [number, number, number, number];
}

/** The facts of a scene from the transforms of its entities (each entity is a root). */
function contextOf(scene: SceneDocument) {
  const entities = Object.entries(scene.entities).map(([id, item]): EntityFacts => {
    const transform = item.components.transform as TransformValue;
    return {
      id,
      parent: null,
      tags: [],
      components: Object.keys(item.components),
      visible: true,
      transform: { position: transform.position, rotation: transform.rotation ?? [0, 0, 0, 1], scale: [1, 1, 1] },
      bounds: null,
      sockets: {},
      joints: null,
      stats: { triangles: 0, drawCalls: 0 },
    };
  });
  const totals = { entities: entities.length, triangles: 0, drawCalls: 0 };
  return createMetricContext({ facts: { simMs: null, entities, totals }, scene });
}

const floor = (from: string, to: string) => ({ from: `entity:${from}`, to: `entity:${to}`, plane: "floor" });
const RULES: Rule[] = [
  { id: "lampNearTable", metric: "distance", args: floor("lamp", "table"), max: 0.8, unit: "m", level: "block" },
  { id: "lampClearOfChair", metric: "distance", args: floor("lamp", "chair"), min: 0.5, unit: "m", level: "block" },
];
const LAMP = "/entities/lamp/components/transform";
const OPS: SearchOp[] = [
  { path: `${LAMP}/position/0`, min: -1.5, max: 1.5, step: 0.05, nudge: 0.05 },
  { path: `${LAMP}/position/2`, min: -1.5, max: 1.5, step: 0.05, nudge: 0.05 },
  { path: `${LAMP}/rotation`, kind: "yaw", min: -Math.PI / 2, max: Math.PI / 2, step: Math.PI / 4, weight: 0.25 },
];
const registry = createMetricRegistry();

function run(seed: number, more: Partial<SearchLayoutOptions<SceneDocument>> = {}) {
  return searchLayout({
    scene: PATIO,
    ops: OPS,
    rules: RULES,
    registry,
    contextAt: (scene) => contextOf(scene),
    seed,
    steps: 120,
    count: 3,
    ...more,
  });
}

function marginOf(results: readonly RuleResult[], id: string): number {
  const index = RULES.findIndex((rule) => rule.id === id);
  const rule = RULES[index];
  const result = results[index];
  if (rule === undefined || result === undefined) throw new Error(id);
  return ruleMargin(rule, result) ?? Number.NaN;
}

const FIRST = run(3);

describe("the named random stream", () => {
  it("gives the numbers of the editor search for its name, the same for the same name, others for another name", () => {
    const take = (next: () => number) => Array.from({ length: 4 }, next);
    const numbers = take(seededStream("layout-search:1"));
    expect(numbers.map((value) => Math.round(value * 1e9))).toEqual([206221697, 259829481, 610508406, 470965397]);
    expect(take(seededStream("layout-search:1"))).toEqual(numbers);
    expect(take(seededStream("layout-search:2"))).not.toEqual(numbers);
  });
});

describe("the ops of a search", () => {
  it("puts values on a grid, keeps a start within half of the grid, and writes a yaw as a quaternion", () => {
    expect(onGrid(0.2899999, 0.01)).toBe(0.29);
    expect(onGrid(0.3 + 1e-12, 0.1)).toBe(0.3);
    expect(written({ path: "/a", kind: "number", start: 0.8, value: 0.80004, grid: 1e-4 })).toBe(0.8);
    expect(written({ path: "/a", kind: "number", start: 0.8, value: 0.80006, grid: 1e-4 })).toBe(0.8001);
    const turn = Math.PI / 12;
    expect(yawOfQuat(quatOfYaw(turn))).toBe(Math.round(turn * 1e6) / 1e6);
    const ops = writeOps([
      { path: "/b", kind: "yaw", start: 0, value: turn },
      { path: "/a", kind: "number", start: 1, value: 1 },
    ]);
    expect(ops).toEqual([{ op: "set", path: "/b", value: quatOfYaw(turn) }]);
  });
});

describe("the generic layout search on a small scene", () => {
  it("finds variants that pass the rules and improve the margin of the failed rule", () => {
    const start = evaluateRules(RULES, registry, () => contextOf(PATIO));
    expect(start[0]?.status).toBe("fail");
    const before = marginOf(start, "lampNearTable");
    expect(before).toBeLessThan(0);
    expect(FIRST.complete).toBe(true);
    expect(FIRST.groups).toEqual(["lamp"]);
    expect(FIRST.checked).toBe(120);
    expect(FIRST.variants.map((variant) => variant.id)).toEqual(["v1", "v2", "v3"]);
    for (const variant of FIRST.variants) {
      expect(gateRules(variant.results).passed, variant.id).toBe(true);
      expect(marginOf(variant.results, "lampNearTable")).toBeGreaterThanOrEqual(0);
      expect(marginOf(variant.results, "lampNearTable")).toBeGreaterThan(before);
      expect(variant.ops.length).toBeGreaterThan(0);
      expect(variant.ops.every((op) => op.path.startsWith(`${LAMP}/`))).toBe(true);
      const paths = variant.ops.map((op) => op.path);
      expect(paths).toEqual([...paths].sort());
      const applied = applyOps(PATIO, variant.ops, builtinRegistry());
      expect(applied.ok && applied.doc.entities).toEqual(variant.scene.entities);
      // The default objective: no tight rule, so the score is the move cost times 0.5.
      expect(variant.score).toBeCloseTo(0.5 * variant.move, 12);
    }
    const scores = FIRST.variants.map((variant) => variant.score);
    expect([...scores].sort((a, b) => a - b)).toEqual(scores);
  });

  it("gives the same variants for the same seed, and other variants for another seed", () => {
    const again = run(3);
    expect(again.variants.map((variant) => variant.ops)).toEqual(FIRST.variants.map((variant) => variant.ops));
    expect(again.variants.map((variant) => variant.score)).toEqual(FIRST.variants.map((variant) => variant.score));
    expect(run(4).variants.map((variant) => variant.ops)).not.toEqual(FIRST.variants.map((variant) => variant.ops));
  });

  it("uses the hooks: a settle puts a candidate out, a follow writes a value of another entity", () => {
    const CHAIR_X = "/entities/chair/components/transform/position/0";
    const result = run(3, {
      settle: (_group, values) => ((values[1] ?? 0) > 0.3 ? null : values),
      follow: (moved) => [{ path: CHAIR_X, kind: "number", start: 0.9, value: (moved.get("lamp")?.[0] ?? 0.9) - 0.7 }],
    });
    expect(result.variants.length).toBeGreaterThan(0);
    for (const variant of result.variants) {
      expect(variant.values.get("lamp")?.[1] ?? 0).toBeLessThanOrEqual(0.3);
      const chair = variant.ops.find((op) => op.path === CHAIR_X);
      expect(chair?.value).toBeCloseTo((variant.values.get("lamp")?.[0] ?? 0) - 0.7, 6);
    }
  });

  it("stops at the time budget and says so", () => {
    let clock = 0;
    const result = run(3, { budgetMs: 10, now: () => (clock += 1) });
    expect(result.complete).toBe(false);
    expect(result.checked).toBeLessThan(120);
    expect(result.notes.join(" ")).toContain("time budget");
  });
});

describe("the objective from the rule margins", () => {
  it("puts out a failed block rule, counts a failed warn rule and each tight rule, and adds the move cost", () => {
    const rule = (id: string, level: "block" | "warn"): Rule => ({ id, metric: "distance", min: 1, level });
    const result = (id: string, status: RuleResult["status"], value: number): RuleResult => ({
      id,
      metric: "distance",
      level: "block",
      status,
      detail: "",
      limit: { min: 1 },
      times: [{ at: { sequence: null, t: null }, status, value, unit: "m", detail: "" }],
    });
    const objective = marginObjective({ tight: 0.2, moveWeight: 2 });
    const rules = [rule("a", "block"), rule("b", "warn"), rule("c", "block")];
    expect(
      objective({
        rules,
        results: [result("a", "fail", 0.5), result("b", "pass", 2), result("c", "pass", 2)],
        move: 0,
      }),
    ).toBeNull();
    const kept = objective({
      rules,
      results: [result("a", "pass", 1.1), result("b", "fail", 0.5), result("c", "pass", 3)],
      move: 0.25,
    });
    expect(kept).toBe(1 + 1 + 2 * 0.25);
  });
});
