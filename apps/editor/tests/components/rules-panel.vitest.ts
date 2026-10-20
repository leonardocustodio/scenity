// SPDX-License-Identifier: Apache-2.0
// The rules panel and the metric graph of the editor. The tests cover the rows of the rules grouped by source file, the
// filter (failed only, level), and a click that picks a row. They also cover the graph of a rule over the sequence time
// with its limit band and markers. The rules tab of the scene page runs over a real page editor: a check after an edit,
// and a click that selects the entities of the rule and seeks to its worst time.
import { builtinRegistry, readDocument, type Rule } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import {
  createMetricContext,
  createMetricRegistry,
  defineMetric,
  evaluateRules,
  type RuleResult,
} from "@scenity/rules";
import { flushPromises, mount, type VueWrapper } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { markRaw } from "vue";
import { z } from "zod";
import RuleGraph from "../../src/core/rules/RuleGraph.vue";
import RulesPanel from "../../src/core/rules/RulesPanel.vue";
import { rowOf, ruleEntities, rowsSummary, worstTime, type RuleRow } from "../../src/core/rules/ruleRows";
import { samplingRules, seriesOf } from "../../src/core/rules/ruleSeries";
import type { RuleCheckRequest } from "@scenity/runtime-dev/document/ruleCheck";
import type { ProjectRules } from "../../src/scene/pageRules";
import SceneRulesPanel from "../../src/scene/rules/SceneRulesPanel.vue";
import { CHECK_DELAY } from "../../src/scene/rules/useSceneRules";
import { ScenePageEditor } from "../../src/scene/sceneEditor";
import { PageSequence, type PageTime } from "../../src/scene/sequencer/pageSequence";

const registry = builtinRegistry();

/** A test metric: the height of an entity in the scene, plus the sequence time in seconds. */
const height = defineMetric({
  id: "test.height",
  label: "Height",
  unit: "m",
  args: z.object({ entity: z.string() }),
  evaluate: (ctx, args) => {
    const heights = ctx.data("heights") as Record<string, number>;
    const id = args.entity.replace(/^entity:/, "").split("#")[0] ?? "";
    const value = (heights[id] ?? 0) + (ctx.time ?? 0) / 1000;
    return { value, unit: "m", detail: `${args.entity} at ${String(value)} m` };
  },
});
const metrics = createMetricRegistry([{ id: "test", library: [height] }]);

const SCENE = {
  format: "scenity.scene/1",
  id: "garden",
  entities: {
    table: { name: "Table", parent: null, index: 0, components: { transform: { position: [1, 0.5, 0] } } },
    lamp: { name: "Lamp", parent: null, index: 1, tags: ["light"], components: { transform: { position: [0, 2, 0] } } },
  },
  rules: [
    { id: "garden.tableLow", metric: "test.height", args: { entity: "table" }, max: 1, unit: "m", level: "block" },
    {
      id: "garden.lampHigh",
      metric: "test.height",
      args: { entity: "entity:lamp#bulb" },
      min: 1,
      unit: "m",
      level: "warn",
      provisional: true,
    },
  ],
};

/** The rule of the sequence (a marker scope). */
const TOUCH_RULE: Rule = {
  id: "tour.tableAtTouch",
  metric: "test.height",
  args: { entity: "table" },
  max: 3,
  unit: "m",
  level: "block",
  scope: { kind: "marker", marker: "touch" },
};

const SEQUENCE: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "tour",
  scene: "garden",
  duration: 4000,
  markers: { touch: 3000 },
  tracks: [],
  rules: [TOUCH_RULE],
};

function sceneDoc(): SceneDocument {
  const read = readDocument(JSON.stringify(SCENE), "scene", { registry });
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

/** The y of each entity of a scene document. */
function heightsOf(doc: SceneDocument): Record<string, number> {
  return Object.fromEntries(
    Object.entries(doc.entities).map(([id, entity]) => {
      const transform = entity.components.transform as { position?: number[] } | undefined;
      return [id, transform?.position?.[1] ?? 0];
    }),
  );
}

/** A rule check over the test metric, as the core of the page gives it. */
function check(doc: () => SceneDocument, request: RuleCheckRequest): RuleResult[] {
  const facts = { simMs: null, entities: [], totals: { entities: 0, triangles: 0, drawCalls: 0 } };
  return evaluateRules(
    request.rules,
    metrics,
    (at) => createMetricContext({ facts: { ...facts, simMs: at.t }, data: { heights: heightsOf(doc()) } }),
    { sequences: request.sequences ?? {} },
  );
}

function row(id: string, more: Partial<RuleRow> = {}): RuleRow {
  return {
    id,
    source: "scenes/garden.scene.json",
    scope: "scene",
    level: "block",
    provisional: false,
    known: null,
    status: "pass",
    value: 0.5,
    unit: "m",
    limit: "max 1 m",
    detail: "",
    note: null,
    entities: [],
    worst: null,
    sequence: null,
    ...more,
  };
}

const mounted: VueWrapper[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
});

describe("the rows of the rules panel", () => {
  it("gives the worst time, the entities, the limit words and the counts", () => {
    const rule = SCENE.rules[1] as Rule;
    const doc = sceneDoc();
    const [result] = check(() => doc, { rules: [rule] });
    if (result === undefined) throw new Error("no result");
    expect(ruleEntities(rule, Object.keys(doc.entities))).toEqual(["lamp"]);
    expect(
      ruleEntities(
        { ...rule, args: { a: ["table", "tag:light", "component:transform", "*"] } },
        ["table", "lamp"],
        new Map([["lamp", ["light"]]]),
      ),
    ).toEqual(["table", "lamp"]);
    const made = rowOf(result, rule, "scenes/garden.scene.json", ["lamp"]);
    expect(made).toMatchObject({ status: "pass", value: 2, limit: "min 1 m", provisional: true, level: "warn" });
    const [timed] = check(() => doc, { rules: SEQUENCE.rules!, sequences: { tour: SEQUENCE } });
    expect(timed?.times[0]?.at.t).toBeNull();
    expect(rowsSummary([made, row("b", { status: "fail" })])).toBe("2 rules: 1 pass, 1 fail");
  });

  it("picks the worst time of a sequence rule: the worst status, then the value furthest out", () => {
    const rule: Rule = {
      ...TOUCH_RULE,
      scope: { kind: "range", sequence: "tour", from: 0, to: 4000, step: 1000 },
    };
    const [result] = check(sceneDoc, { rules: [rule], sequences: { tour: SEQUENCE } });
    if (result === undefined) throw new Error("no result");
    expect(result.status).toBe("fail");
    expect(worstTime(result)?.at.t).toBe(4000);
  });
});

describe("RulesPanel", () => {
  const rows = [
    row("garden.tableLow", { status: "fail", value: 1.5, entities: ["table"] }),
    row("garden.lampHigh", { level: "warn", provisional: true, limit: "min 1 m" }),
    row("tour.tableAtTouch", { source: "sequences/tour.sequence.json", scope: "marker touch", worst: 3000 }),
  ];

  it("groups the rows by source and shows result, value, limit and the provisional mark", () => {
    const wrapper = mount(RulesPanel, { props: { rows } });
    mounted.push(wrapper);
    const groups = wrapper.findAll('[data-testid="rules-group"]');
    expect(groups.map((group) => group.attributes("data-source"))).toEqual([
      "scenes/garden.scene.json",
      "sequences/tour.sequence.json",
    ]);
    const checks = wrapper.findAll('[data-testid="rules-check"]');
    expect(checks.map((item) => item.attributes("data-status"))).toEqual(["fail", "pass", "pass"]);
    expect(checks[0]?.text()).toContain("fail garden.tableLow 1.5 m · max 1 m");
    expect(checks[1]?.text()).toContain("ok garden.lampHigh 0.5 m · min 1 m (provisional)");
    expect(checks[2]?.text()).toContain("marker touch · block");
    expect(wrapper.get('[data-testid="rules-head"]').text()).toBe("3 rules: 2 pass, 1 fail");
  });

  it("filters the failed rules and one level, and sends a pick on a click", async () => {
    const wrapper = mount(RulesPanel, { props: { rows } });
    mounted.push(wrapper);
    await wrapper.get('[data-testid="rules-filter-failed"]').setValue(true);
    expect(wrapper.findAll('[data-testid="rules-check"]').map((item) => item.attributes("data-rule"))).toEqual([
      "garden.tableLow",
    ]);
    await wrapper.get('[data-testid="rules-filter-failed"]').setValue(false);
    await wrapper.get('[data-testid="rules-filter-level"]').setValue("warn");
    expect(wrapper.findAll('[data-testid="rules-check"]').map((item) => item.attributes("data-rule"))).toEqual([
      "garden.lampHigh",
    ]);
    await wrapper.get('[data-rule="garden.lampHigh"]').trigger("click");
    expect(wrapper.emitted("pick")?.[0]?.[0]).toMatchObject({ id: "garden.lampHigh" });
  });
});

describe("RuleGraph", () => {
  it("draws the line, the limit band, the markers and the check points; the arrow keys seek", async () => {
    const rule = TOUCH_RULE;
    const rules: Rule[] = [
      { ...rule, scope: { kind: "marker", sequence: "tour", marker: "touch" } },
      ...samplingRules(rule, SEQUENCE),
    ];
    const [own, ...samples] = check(sceneDoc, { rules, sequences: { tour: SEQUENCE } });
    if (own === undefined) throw new Error("no result");
    const series = seriesOf(own, samples, SEQUENCE, own.limit);
    expect(series.points.length).toBeGreaterThan(40);
    const wrapper = mount(RuleGraph, { props: { series, time: 1000 } });
    mounted.push(wrapper);
    expect(wrapper.get('[data-testid="rule-graph-marker"]').attributes("data-marker")).toBe("touch");
    expect(wrapper.get('[data-testid="rule-graph-check"]').attributes("data-status")).toBe("fail");
    expect(wrapper.find('[data-testid="rule-graph-band"]').exists()).toBe(true);
    expect(wrapper.findAll('[data-testid="rule-graph-limit"]')).toHaveLength(1);
    expect(wrapper.get('[data-testid="rule-graph-line"]').attributes("d")).toMatch(/^M/);
    await wrapper.get("svg").trigger("keydown", { key: "ArrowRight" });
    expect(wrapper.emitted("seek")?.[0]?.[0]).toBeGreaterThan(1000);
  });
});

/** A clock of the page that a test sets. */
function testTime(): PageTime & { t: number } {
  const time = {
    t: 0,
    now: () => time.t,
    playing: () => false,
    seek: (t: number) => {
      time.t = t;
    },
    play: () => undefined,
    pause: () => undefined,
  };
  return time;
}

function scenePage() {
  const files = { read: () => Promise.reject(new Error("no read")), save: () => Promise.reject(new Error("no save")) };
  const time = testTime();
  const sequence = new PageSequence({
    ...{ path: "sequences/tour.sequence.json", doc: SEQUENCE, diskText: JSON.stringify(SEQUENCE), time, files },
    load: () => Promise.resolve(),
  });
  const editor = new ScenePageEditor({
    ...sequence.editorParts(),
    ...{ doc: sceneDoc(), path: "scenes/garden.scene.json", diskText: JSON.stringify(SCENE), registry, files },
    patch: () => Promise.resolve({ ok: true as const, warnings: [] }),
  });
  sequence.connect(editor);
  const selected: string[][] = [];
  const selection = {
    ids: [],
    set: (ids: readonly string[]) => selected.push([...ids]),
    listen: () => () => undefined,
  };
  const project: ProjectRules = { project: null, rules: [], sourced: [], problems: [] };
  const port = {
    project,
    checkRules: (request: RuleCheckRequest) => Promise.resolve(check(() => editor.doc, request)),
  };
  const wrapper = mount(SceneRulesPanel, {
    props: { parts: markRaw({ editor, sequence, selection, port }) },
    attachTo: document.body,
  });
  mounted.push(wrapper);
  return { editor, time, wrapper, selected };
}

/** Wait for the debounced check of the panel. */
async function checked(wrapper: VueWrapper, count: number): Promise<void> {
  for (
    let wait = 0;
    wait < 40 && Number(wrapper.get('[data-testid="scene-rules"]').attributes("data-checks")) < count;
    wait += 1
  ) {
    await new Promise((resolve) => setTimeout(resolve, CHECK_DELAY / 4));
    await flushPromises();
  }
}

describe("the rules tab of the scene page", () => {
  it("lists the rules of the scene and the sequence, checks again after an edit, and a click selects and seeks", async () => {
    const { editor, time, wrapper, selected } = scenePage();
    await checked(wrapper, 1);
    const status = (id: string) => wrapper.get(`[data-rule="${id}"]`).attributes("data-status");
    expect(wrapper.findAll('[data-testid="rules-check"]').map((item) => item.attributes("data-rule"))).toEqual([
      "garden.tableLow",
      "garden.lampHigh",
      "tour.tableAtTouch",
    ]);
    expect(status("garden.tableLow")).toBe("pass");
    // An edit lifts the table above its limit: the next check fails the rule.
    expect(
      editor.apply([{ op: "set", path: "/entities/table/components/transform/position", value: [1, 2, 0] }]),
    ).toBeNull();
    await checked(wrapper, 2);
    expect(status("garden.tableLow")).toBe("fail");
    // A click on the sequence rule selects the table and seeks to the marker; the graph shows the rule over time.
    await wrapper.get('[data-rule="tour.tableAtTouch"]').trigger("click");
    await flushPromises();
    expect(selected.at(-1)).toEqual(["table"]);
    expect(time.t).toBe(3000);
    await new Promise((resolve) => setTimeout(resolve, 50));
    await flushPromises();
    expect(wrapper.get('[data-testid="rule-graph-id"]').text()).toBe("tour.tableAtTouch");
    expect(wrapper.get('[data-testid="rule-graph-marker"]').attributes("data-marker")).toBe("touch");
  });
});
