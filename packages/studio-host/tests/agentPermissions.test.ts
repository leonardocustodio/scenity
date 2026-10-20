// SPDX-License-Identifier: Apache-2.0
// The permissions of the agent sessions: the value of each kind of action in each mode, the stricter value of the
// person and of the project, the files that always ask, the roles, the approval cards and the budget of an Auto
// session.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { defineTool } from "@scenity/agent-tools";
import { z } from "zod";
import { Approvals } from "../src/agents/approvals";
import { scriptDriver, type ScriptStep } from "../src/agents/driver";
import { actionPermission, permit, type GateSession } from "../src/agents/gate";
import {
  ACTION_KINDS,
  MODE_PERMISSIONS,
  permissionOf,
  projectKindValues,
  roleAllows,
  type ActionKind,
} from "../src/agents/permissions";
import type { AgentItem, AgentMode } from "../src/agents/protocol";
import { AgentSessions } from "../src/agents/sessions";
import { BridgeHub } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-permissions-"));
  dirs.push(dir);
  return dir;
}

/** A tool that answers "ran" (a fake of a scene edit or of a job run). */
function fake(name: string) {
  return defineTool({
    name,
    description: name,
    input: z.object({ command: z.string().optional() }),
    alwaysLoad: false,
    handler: () => Promise.resolve({ content: [{ type: "text", text: "ran" }] }),
  });
}

function sessionsOf(steps: readonly ScriptStep[], dir: string, kinds = {}) {
  return new AgentSessions({
    driver: scriptDriver({ turns: [steps] }),
    hub: new BridgeHub(),
    dirOf: () => dir,
    emit: () => undefined,
    tools: [fake("scene_command"), fake("job_run")],
    preferences: () => ({ kinds, budgetUsd: 5 }),
  });
}

/** Wait until the session has no turn that runs. Return the items. */
async function idle(sessions: AgentSessions, id: string): Promise<readonly AgentItem[]> {
  for (let i = 0; i < 400; i += 1) {
    const session = sessions.list().find((item) => item.id === id);
    if (session !== undefined && !session.running) return session.items;
    await Bun.sleep(5);
  }
  throw new Error("the turn did not end");
}

/** The text of the first error item. */
function errorText(items: readonly AgentItem[]): string {
  const found = items.find((item) => item.kind === "error");
  return found?.kind === "error" ? found.text : "";
}

/** Wait for an approval card that waits. Return its ID. */
async function card(sessions: AgentSessions, id: string): Promise<string> {
  for (let i = 0; i < 400; i += 1) {
    const found = sessions
      .list()
      .find((item) => item.id === id)
      ?.items.find((item) => item.kind === "approval" && item.decision === null);
    if (found?.kind === "approval") return found.approval;
    await Bun.sleep(5);
  }
  throw new Error("no approval card");
}

describe("the permissions of the agent sessions", () => {
  test("each mode gives each kind its value; the stricter override wins; Git is never allowed", () => {
    const table = Object.fromEntries(
      (["ask", "review", "auto"] as const).map((mode) => [mode, ACTION_KINDS.map((kind) => permissionOf(mode, kind))]),
    );
    expect(table).toEqual({
      ask: ["deny", "deny", "deny", "deny", "deny", "deny"],
      review: ["allow", "ask", "allow", "ask", "ask", "deny"],
      auto: ["allow", "allow", "allow", "allow", "allow", "deny"],
    });
    expect(permissionOf("auto", "files", { files: "ask" })).toBe("ask");
    expect(permissionOf("review", "files", { files: "allow" })).toBe("ask");
    expect(permissionOf("auto", "network", { network: "allow" }, { network: "deny" })).toBe("deny");
    expect(permissionOf("auto", "git", { git: "allow" })).toBe("deny");
    expect(Object.keys(MODE_PERMISSIONS.review)).toEqual([...ACTION_KINDS]);
  });

  test("Ask runs the jobs that only read; a write of the code always asks; the roles cap the modes", () => {
    const ask = { mode: "ask" as AgentMode, values: [] };
    expect(actionPermission(ask, { kind: "runs", title: "check", detail: "", job: "check" })).toBe("allow");
    expect(actionPermission(ask, { kind: "runs", title: "build", detail: "", job: "build" })).toBe("deny");
    expect(
      actionPermission({ ...ask, values: [{ runs: "deny" }] }, { kind: "runs", title: "", detail: "", job: "check" }),
    ).toBe("deny");
    const auto = { mode: "auto" as AgentMode, values: [] };
    expect(actionPermission(auto, { kind: "files", title: "", detail: "", path: "package.json" })).toBe("ask");
    expect(actionPermission(auto, { kind: "files", title: "", detail: "", path: "plugins/a/package.json" })).toBe(
      "ask",
    );
    expect(actionPermission(auto, { kind: "files", title: "", detail: "", path: "notes.md" })).toBe("allow");
    expect([roleAllows("viewer", "ask"), roleAllows("editor", "review"), roleAllows("editor", "auto")]).toEqual([
      false,
      true,
      false,
    ]);
    expect(roleAllows("admin", "auto")).toBe(true);
  });

  test("the gate of each kind asks, allows for the session, or denies", async () => {
    const approvals = new Approvals();
    const cards: string[] = [];
    const session: GateSession = {
      id: "s1",
      mode: "review",
      values: [],
      allowed: new Set<ActionKind>(),
      card: (id, request) => {
        cards.push(`${id} ${request.kind}`);
        return () => undefined;
      },
    };
    for (const kind of ["imports", "network"] as const) {
      const waiting = permit(session, approvals, { kind, title: kind, detail: "" });
      expect(approvals.answer("s1", `a${String(cards.length)}`, kind === "imports" ? "deny" : "session")).toBe(true);
      expect((await waiting).allowed).toBe(kind === "network");
    }
    expect(await permit(session, approvals, { kind: "network", title: "again", detail: "" })).toEqual({
      allowed: true,
    });
    expect((await permit(session, approvals, { kind: "git", title: "push", detail: "" })).allowed).toBe(false);
    expect(cards).toEqual(["a1 imports", "a2 network"]);
  });

  test("Review edits the scene, asks for a file write and keeps an allow for the session; Ask refuses both", async () => {
    const dir = project();
    const steps: ScriptStep[] = [
      { tool: "scene_command", input: { command: "entity.rename" } },
      { write: { path: "notes.md", text: "one\n" } },
      { write: { path: "more.md", text: "two\n" } },
    ];
    const sessions = sessionsOf(steps, dir);
    const review = sessions.create("showroom");
    sessions.prompt(review.id, "go");
    sessions.answer(review.id, await card(sessions, review.id), "session");
    const items = await idle(sessions, review.id);
    expect(items.find((item) => item.kind === "tool")).toMatchObject({ isError: false });
    expect(items.filter((item) => item.kind === "approval")).toHaveLength(1);
    expect(readFileSync(join(dir, "more.md"), "utf8")).toBe("two\n");
    const ask = sessions.create("showroom", { mode: "ask" });
    sessions.prompt(ask.id, "go");
    const refused = await idle(sessions, ask.id);
    expect(refused.find((item) => item.kind === "tool")).toMatchObject({ isError: true });
    expect(errorText(refused)).toContain("ask mode");
  });

  test("a denied write changes nothing; Stop denies a card that waits; the project file can tighten a kind", async () => {
    const dir = project();
    const sessions = sessionsOf([{ write: { path: "notes.md", text: "x\n" } }], dir);
    const first = sessions.create("showroom");
    sessions.prompt(first.id, "go");
    sessions.answer(first.id, await card(sessions, first.id), "deny");
    expect((await idle(sessions, first.id)).at(-2)).toMatchObject({ kind: "error" });
    expect(existsSync(join(dir, "notes.md"))).toBe(false);
    const second = sessions.create("showroom");
    sessions.prompt(second.id, "go");
    await card(sessions, second.id);
    sessions.stop(second.id);
    expect((await idle(sessions, second.id)).find((item) => item.kind === "approval")).toMatchObject({
      decision: "deny",
    });
    mkdirSync(join(dir, ".scenity"));
    writeFileSync(join(dir, ".scenity", "agents.json"), JSON.stringify({ permissions: { scene: "deny", bad: "x" } }));
    expect(projectKindValues(dir)).toEqual({ scene: "deny" });
  });

  test("Auto needs a budget, and a session stops at its budget", async () => {
    const dir = project();
    const sessions = sessionsOf([{ cost: 3 }, { say: "still here" }], dir);
    const session = sessions.create("showroom");
    expect(() => sessions.update(session.id, { mode: "auto", budgetUsd: 0 })).toThrow(
      "An Auto session needs a budget.",
    );
    expect(sessions.update(session.id, { mode: "auto" })).toMatchObject({ mode: "auto", budgetUsd: 5 });
    sessions.update(session.id, { budgetUsd: 2 });
    sessions.prompt(session.id, "spend");
    const items = await idle(sessions, session.id);
    expect(errorText(items)).toContain("budget of $2.00");
    expect(items.some((item) => item.kind === "text")).toBe(false);
    expect(() => sessions.prompt(session.id, "more")).toThrow("budget");
  });
});
