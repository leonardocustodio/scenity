// SPDX-License-Identifier: Apache-2.0
// Plan mode of the agent sessions. A plan of five steps waits for the person and runs with ticks and a summary. Its
// file follows in `.scenity/plans/`. With "Plan first", a denied plan changes nothing. An edit of the steps replaces
// the steps of the agent.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@scenity/agent-tools";
import { z } from "zod";
import { scriptDriver, type ScriptStep } from "../src/agents/driver";
import { planMarkdown, planPath } from "../src/agents/plans";
import type { AgentItem } from "../src/agents/protocol";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const STEPS = ["Find the table", "Add four chairs", "Turn them", "Warm the key light", "Check the rules"];

const edit = defineTool({
  name: "scene_command",
  description: "edit",
  input: z.object({ command: z.string().optional() }),
  alwaysLoad: false,
  handler: () => Promise.resolve({ content: [{ type: "text", text: "Applied" }] }),
});

function sessionsOf(steps: readonly ScriptStep[]) {
  const dir = mkdtempSync(join(tmpdir(), "studio-plans-"));
  dirs.push(dir);
  const sessions = new AgentSessions({
    driver: scriptDriver({ turns: [steps] }),
    hub: new BridgeHub(),
    dirOf: () => dir,
    emit: () => undefined,
    tools: [edit],
  });
  return { sessions, dir };
}

async function until<T>(read: () => T | undefined): Promise<T> {
  for (let i = 0; i < 400; i += 1) {
    const value = read();
    if (value !== undefined) return value;
    await Bun.sleep(5);
  }
  throw new Error("timed out");
}

const items = (sessions: AgentSessions, id: string): readonly AgentItem[] =>
  sessions.list().find((item) => item.id === id)?.items ?? [];
const planCard = (sessions: AgentSessions, id: string) => {
  const card = items(sessions, id).find((item) => item.kind === "plan");
  return card?.kind === "plan" ? card : undefined;
};
const idle = (sessions: AgentSessions, id: string) =>
  until(() => (sessions.list().find((item) => item.id === id)?.running === false ? true : undefined));

describe("plan mode", () => {
  test("a plan of five steps waits for the person, runs with ticks and a summary, and its file follows", async () => {
    const run: ScriptStep[] = [
      { tool: "plan_propose", input: { title: "Chairs around the table", steps: STEPS, risks: ["The sofa is close"] } },
      ...STEPS.flatMap((_step, index): ScriptStep[] => [
        { tool: "scene_command", input: { command: "entity.move" } },
        { tool: "plan_step", input: { index, state: "done" } },
      ]),
      { tool: "plan_done", input: { summary: "Four chairs; a warmer key light." } },
    ];
    const { sessions, dir } = sessionsOf(run);
    const session = sessions.create("showroom", { planFirst: true });
    sessions.prompt(session.id, "add chairs");
    const card = await until(() => planCard(sessions, session.id));
    expect(card).toMatchObject({ title: "Chairs around the table", decision: null });
    expect(sessions.list()[0]?.waiting).toBe(true);
    sessions.answer(session.id, card.approval, "once");
    await idle(sessions, session.id);
    const done = planCard(sessions, session.id);
    expect(done?.steps.map((step) => step.state)).toEqual(["done", "done", "done", "done", "done"]);
    expect(done).toMatchObject({ decision: "approved", summary: "Four chairs; a warmer key light." });
    const tools = items(sessions, session.id).filter((item) => item.kind === "tool" && item.name === "scene_command");
    expect(tools.every((item) => item.kind === "tool" && !item.isError)).toBe(true);
    const file = join(dir, done?.path ?? "none");
    expect(readFileSync(file, "utf8")).toContain("- [x] Check the rules");
    expect(readFileSync(file, "utf8")).toContain("## Summary\n\nFour chairs; a warmer key light.");
  });

  test("with Plan first an edit before the plan and after a denied plan changes nothing", async () => {
    const { sessions, dir } = sessionsOf([
      { tool: "scene_command", input: { command: "entity.move" } },
      { tool: "plan_propose", input: { title: "Move it", steps: ["Move"] } },
      { tool: "scene_command", input: { command: "entity.move" } },
    ]);
    const session = sessions.create("showroom", { planFirst: true });
    sessions.prompt(session.id, "move");
    const card = await until(() => planCard(sessions, session.id));
    sessions.answer(session.id, card.approval, "deny");
    await idle(sessions, session.id);
    const edits = items(sessions, session.id).filter((item) => item.kind === "tool" && item.name === "scene_command");
    const results = edits.map((item) => (item.kind === "tool" ? (item.result ?? "") : ""));
    expect(results).toHaveLength(2);
    expect(results[0]).toContain("Plan first");
    expect(results[1]).toContain("denied the plan");
    expect(planCard(sessions, session.id)?.decision).toBe("denied");
    expect(existsSync(join(dir, ".scenity", "plans"))).toBe(false);
  });

  test("an edit of the steps replaces the steps of the agent", async () => {
    const { sessions, dir } = sessionsOf([{ tool: "plan_propose", input: { title: "Light", steps: ["One", "Two"] } }]);
    const session = sessions.create("showroom");
    sessions.prompt(session.id, "light");
    const card = await until(() => planCard(sessions, session.id));
    sessions.answer(session.id, card.approval, "once", ["Only one"]);
    await idle(sessions, session.id);
    expect(planCard(sessions, session.id)?.steps).toEqual([{ text: "Only one", state: "todo" }]);
    expect(readdirSync(join(dir, ".scenity", "plans"))).toHaveLength(1);
    expect(planPath({ title: "Chairs & Lights!" }, new Date("2026-10-18T10:00:00Z"))).toBe(
      ".scenity/plans/2026-10-18-chairs-lights.md",
    );
    expect(
      planMarkdown({
        title: "T",
        steps: [{ text: "a", state: "skipped" }],
        files: ["scenes/main.scene.json"],
        risks: [],
        decision: "approved",
        summary: null,
        path: null,
      }),
    ).toBe("# T\n\n## Steps\n\n- [-] a\n\n## Files\n\n- scenes/main.scene.json\n");
  });
});
