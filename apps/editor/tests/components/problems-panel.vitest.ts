// SPDX-License-Identifier: Apache-2.0
// The Problems panel. A fixture gives each kind of problem: a failed rule, a budget, a missing asset, the rights of an
// asset, an unknown component, a schema finding, a plugin error and a missing build. The list sorts them and counts
// them. The panel has Go to, a fix and Ask the agent to fix.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { builtinRegistry } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { ConsoleStore } from "../../src/scene/console/consoleStore";
import type { PageRuleSet } from "../../src/scene/pageRules";
import ProblemsPanel from "../../src/scene/problems/ProblemsPanel.vue";
import { ProblemList, type Problem } from "../../src/scene/problems/problemList";
import {
  assetProblems,
  componentProblems,
  healthProblems,
  pluginProblems,
  ruleProblems,
  schemaProblems,
} from "../../src/scene/problems/problemSources";

afterEach(() => {
  document.body.innerHTML = "";
});

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    lamp: {
      name: "Lamp",
      parent: null,
      index: 0,
      components: { model: { asset: "asset:LAMP" }, light: { kind: "point", intensity: -3 } },
    },
    chair: {
      name: "Chair",
      parent: null,
      index: 1,
      components: { model: { asset: "asset:GONE" }, "doors.hinge": { angle: 3 } },
    },
  },
} as unknown as SceneDocument;

/** A rule set with one rule of each metric, and the results of a check: all fail. */
function ruleCheck(): Parameters<typeof ruleProblems>[0] {
  const rule = (id: string, metric: string, level: "block" | "warn") => ({
    rule: { id, metric, level, max: 0, scope: { kind: "entity" as const, entity: "lamp" } },
    source: "scenity.project.json",
  });
  const rules = [
    rule("onFloor", "belowFloor", "block"),
    rule("tris", "triangleBudget", "warn"),
    rule("ok", "assetRights", "block"),
  ];
  const set = { rules, request: { sequences: {}, playing: null } } as unknown as PageRuleSet;
  const results = rules.map(({ rule: item }) => ({
    id: item.id,
    metric: item.metric,
    level: item.level,
    status: "fail",
    detail: `${item.id} fails`,
    limit: null,
    times: [],
  }));
  return { check: () => Promise.resolve({ set, results: results as never }), problems: [] };
}

describe("the sources of the problems", () => {
  it("give a failed rule, a budget and the rights of a rule metric", async () => {
    const problems = await ruleProblems(ruleCheck(), DOC);
    expect(problems.map((problem) => [problem.kind, problem.level, problem.entities])).toEqual([
      ["rule", "error", ["lamp"]],
      ["budget", "warn", ["lamp"]],
      ["rights", "error", ["lamp"]],
    ]);
  });

  it("give a missing asset, an unknown component with its fix, and a schema finding", () => {
    expect(assetProblems(DOC, [{ id: "LAMP" }]).map((problem) => [problem.kind, problem.entities])).toEqual([
      ["asset", ["chair"]],
    ]);
    const removed: string[] = [];
    const [unknown] = componentProblems(DOC, builtinRegistry(), (entity, component) =>
      removed.push(`${entity} ${component}`),
    );
    expect(unknown).toMatchObject({ kind: "component", entities: ["chair"] });
    unknown?.fixes[0]?.run();
    expect(removed).toEqual(["chair doors.hinge"]);
    const schema = schemaProblems(DOC, builtinRegistry());
    expect(schema.length).toBeGreaterThan(0);
    expect(schema.every((problem) => problem.kind === "schema" && problem.entities[0] === "lamp")).toBe(true);
  });

  it("give a plugin error of the Console, the rights of an asset and the assets with no build", () => {
    const log = new ConsoleStore();
    log.add({ level: "error", source: "plugin", text: "doors: the hinge of entity:chair broke" });
    log.add({ level: "error", source: "page", text: "not a plugin" });
    expect(pluginProblems(log).map((problem) => [problem.kind, problem.entities])).toEqual([["plugin", ["chair"]]]);
    const health = healthProblems(
      { rights: [{ id: "LAMP", problems: ["the licence CC-BY-NC-4.0 is not allowed"] }], unbuilt: ["NEW"] },
      DOC,
    );
    expect(health.map((problem) => [problem.kind, problem.level, problem.entities])).toEqual([
      ["rights", "error", ["lamp"]],
      ["build", "warn", []],
    ]);
    expect(health[0]?.detail).toContain("CC-BY-NC-4.0");
  });
});

/** A problem of a fixture. */
function problem(key: string, level: "error" | "warn", patch: Partial<Problem> = {}): Problem {
  return {
    key,
    kind: "rule",
    level,
    title: key,
    detail: null,
    entities: [],
    time: null,
    file: null,
    fixes: [],
    ...patch,
  };
}

describe("the list and the Problems panel", () => {
  it("sorts the errors first, counts them, and checks again", async () => {
    const list = new ProblemList();
    let calls = 0;
    list.add("a", () => {
      calls += 1;
      return [problem("warning", "warn"), problem("error", "error", { kind: "schema" })];
    });
    await list.refresh();
    expect(list.problems.value.map((item) => item.key)).toEqual(["error", "warning"]);
    expect(list.counts()).toEqual({ fail: 1, warn: 1 });
    await list.refresh();
    expect(calls).toBeGreaterThanOrEqual(2);
  });

  it("goes to a problem, runs a fix, asks the agent and keeps one kind", async () => {
    const list = new ProblemList();
    const done: string[] = [];
    list.add("a", () => [
      problem("lamp", "error", {
        entities: ["lamp"],
        fixes: [{ id: "remove", label: "Remove", run: () => done.push("fix") }],
      }),
      problem("tris", "warn", { kind: "budget" }),
    ]);
    await list.refresh();
    mount(ProblemsPanel, {
      props: {
        list,
        goTo: (item: Problem) => done.push(`go ${item.key}`),
        ask: () => (item: Problem) => done.push(`ask ${item.key}`),
      },
      attachTo: document.body,
    });
    await flushPromises();
    const rows = document.querySelectorAll<HTMLElement>('[data-testid="problem-row"]');
    expect([...rows].map((row) => row.dataset.kind)).toEqual(["rule", "budget"]);
    expect(document.querySelector('[data-testid="problems-counts"]')?.textContent).toBe("1 error · 1 warning");
    rows[0]?.querySelector<HTMLButtonElement>('[data-testid="problem-go"]')?.click();
    rows[0]?.querySelector<HTMLButtonElement>('[data-testid="problem-fix"]')?.click();
    rows[0]?.querySelector<HTMLButtonElement>('[data-testid="problem-ask"]')?.click();
    expect(rows[1]?.querySelector('[data-testid="problem-go"]')).toBeNull();
    expect(done).toEqual(["go lamp", "fix", "ask lamp"]);
  });
});
