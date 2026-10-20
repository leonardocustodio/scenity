// SPDX-License-Identifier: Apache-2.0
// The background tasks. These are the cases of the loop tests of the workbench (loops.test.ts, stopGate.test.ts) on
// the tasks of the studio: the parameters, the gate that refuses the end while the rules fail, the most refusals, a
// gate that does not run, the end check at a turn limit, the time limit, the stop of the owner, the review pack, and
// the record with its search. Also the groups of parallel tasks.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { scriptDriver, type AgentScript } from "../src/agents/driver";
import type { AgentEvent, AgentTaskInfo } from "../src/agents/protocol";
import { AgentSessions } from "../src/agents/sessions";
import { TaskStore, taskMatches } from "../src/agents/taskStore";
import { BridgeHub, type BridgeSocket } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-tasks-"));
  dirs.push(dir);
  return dir;
}

/** A window of the project: it answers `task.gate` from a list of results (the last one stays) and the pictures. */
function windowOf(hub: BridgeHub, gates: boolean[], calls: string[] = []): void {
  const socket: BridgeSocket = {
    send(text) {
      const message = JSON.parse(text) as { id: number; call?: string; args: unknown[] };
      if (message.call === undefined) return;
      calls.push(message.call);
      const passed = message.call !== "task.gate" || gates.length === 1 ? gates[0] : gates.shift();
      const picture = { simMs: null, width: 2, height: 2, mime: "image/webp", bytes: { $bytes: "UklGRg==" } };
      const results: Record<string, unknown> = {
        "task.gate": { passed, message: passed === true ? "The rules pass." : "1 block rule fails: onFloor.", sets: 1 },
        "task.frames": [picture, picture],
        "turn.checkpoint": true,
      };
      const result = results[message.call] ?? {};
      queueMicrotask(() => hub.message(socket, JSON.stringify({ workbench: 1, id: message.id, result })));
    },
  };
  hub.attach(socket);
  hub.message(socket, JSON.stringify({ type: "hello", project: "showroom", scene: "scenes/main.scene.json" }));
}

interface Setup {
  readonly script?: AgentScript;
  readonly gates?: boolean[];
  readonly window?: boolean;
  readonly file?: string;
  readonly minuteMs?: number;
}

function setupOf(setup: Setup = {}) {
  const dir = folder();
  const hub = new BridgeHub();
  const calls: string[] = [];
  if (setup.window !== false) windowOf(hub, setup.gates ?? [true], calls);
  const events: AgentEvent[] = [];
  const sessions = new AgentSessions({
    driver: scriptDriver(setup.script ?? { turns: [[{ say: "Working." }, { cost: 0.1 }]] }),
    hub,
    dirOf: () => dir,
    emit: (event) => events.push(event),
    ...(setup.file === undefined ? {} : { tasksFile: setup.file }),
    ...(setup.minuteMs === undefined ? {} : { taskMinuteMs: setup.minuteMs }),
  });
  return { dir, sessions, calls, events };
}

/** Wait until a task ends. */
async function ended(sessions: AgentSessions, id: string): Promise<AgentTaskInfo> {
  for (let i = 0; i < 600; i += 1) {
    const task = sessions.tasks.list().find((item) => item.id === id);
    if (task !== undefined && !["running", "checking"].includes(task.state)) return task;
    await Bun.sleep(5);
  }
  throw new Error("the task did not end");
}

describe("the background tasks", () => {
  test("the parameters are checked", () => {
    const { sessions } = setupOf();
    expect(() => sessions.tasks.start("showroom", { prompt: " " })).toThrow("The prompt of the task is empty.");
    expect(() => sessions.tasks.start("showroom", { prompt: "go", budgetUsd: 0 })).toThrow("needs a budget");
    expect(() => sessions.tasks.start("showroom", { prompt: "go", maxMinutes: 0 })).toThrow("turns and minutes");
  });

  test("the gate refuses the end while the rules fail; the change sets, the record and the review pack", async () => {
    const { dir, sessions, events } = setupOf({ gates: [false, false, true] });
    const started = sessions.tasks.start("showroom", { prompt: "Tidy the room", budgetUsd: 2 });
    expect(started).toMatchObject({ state: "running", gate: "rules", budgetUsd: 2, maxTurns: 200, maxMinutes: 30 });
    const session = sessions.list().find((item) => item.id === started.session);
    expect(session).toMatchObject({ mode: "review", task: started.id, budgetUsd: 2 });
    const task = await ended(sessions, started.id);
    expect(task).toMatchObject({ state: "done", refusals: 0, reason: "The gate passed." });
    expect(task.sets).toEqual([1, 2, 3].map((turn) => `${started.session}#${String(turn)}`));
    expect(task.costUsd).toBeCloseTo(0.3);
    // Each failed check went to the agent as the next prompt.
    const prompts = (sessions.list()[0]?.items ?? []).flatMap((item) => (item.kind === "prompt" ? [item.text] : []));
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toBe("Tidy the room");
    expect(prompts[1]).toContain("The gate of the task failed: 1 block rule fails: onFloor.");
    expect(prompts[2]).toContain("The gate of the task failed");
    expect(task.pack).toBe(`.scenity/tasks/${task.id}`);
    const review = readFileSync(join(dir, task.pack ?? "", "REVIEW.md"), "utf8");
    expect(review).toContain("# Task: Tidy the room");
    expect(review).toContain("- Gate: rules: passed. The rules pass.");
    expect(review).toContain("![before](before.webp)");
    expect(existsSync(join(dir, task.pack ?? "", "after.webp"))).toBe(true);
    // The event of the end is the notification of the windows.
    expect(events.some((event) => event.type === "agent.task" && event.task.state === "done")).toBe(true);
  });

  test("after the most refusals the task fails with the last check", async () => {
    const { sessions } = setupOf({ gates: [false] });
    const task = await ended(sessions, sessions.tasks.start("showroom", { prompt: "go" }).id);
    expect(task).toMatchObject({ state: "failed", refusals: 6, reason: "The gate failed 6 times in a row." });
    expect(task.check?.passed).toBe(false);
  });

  test("a gate that does not run lets the task end and says why", async () => {
    const { sessions } = setupOf({ window: false });
    const task = await ended(sessions, sessions.tasks.start("showroom", { prompt: "go" }).id);
    expect(task.state).toBe("done");
    expect(task.check?.passed).toBeNull();
    expect(task.reason).toContain("The gate did not run");
  });

  test("a task at its turn limit gets the gate check of the host; the review pack follows", async () => {
    const { dir, sessions } = setupOf({ gates: [false] });
    const task = await ended(sessions, sessions.tasks.start("showroom", { prompt: "go", maxTurns: 1 }).id);
    expect(task).toMatchObject({ state: "failed", refusals: 1 });
    expect(task.reason).toContain("its 1 turns");
    expect(task.check?.message).toBe("1 block rule fails: onFloor.");
    expect(existsSync(join(dir, task.pack ?? "none", "REVIEW.md"))).toBe(true);
  });

  test("the time limit stops a task, with the end check", async () => {
    const script = { turns: [[{ say: "Long work." }, { wait: 5000 }]] };
    const { sessions, calls } = setupOf({ script, minuteMs: 30 });
    const task = await ended(sessions, sessions.tasks.start("showroom", { prompt: "go", maxMinutes: 1 }).id);
    expect(task.state).toBe("timeout");
    expect(task.reason).toBe("The task ran 1 minutes, its limit, and stopped.");
    expect(calls).toContain("task.gate");
  });

  test("the owner stops a task: no check and no pack", async () => {
    const script = { turns: [[{ wait: 5000 }]] };
    const { sessions, calls } = setupOf({ script });
    const started = sessions.tasks.start("showroom", { prompt: "go", gate: "rules" });
    await Bun.sleep(20);
    sessions.tasks.stop(started.id);
    const task = await ended(sessions, started.id);
    expect(task).toMatchObject({ state: "stopped", pack: null, check: null, reason: "The owner stopped the task." });
    expect(calls).not.toContain("task.gate");
  });

  test("the record keeps the tasks; a search finds them; a running task is stopped at the next start", async () => {
    const file = join(folder(), "agent-tasks.json");
    const { sessions } = setupOf({ file, gates: [true] });
    const one = await ended(sessions, sessions.tasks.start("showroom", { prompt: "Light the chair" }).id);
    const two = await ended(sessions, sessions.tasks.start("showroom", { prompt: "Name the lamps", gate: "none" }).id);
    expect(sessions.tasks.list({ text: "chair" }).map((task) => task.id)).toEqual([one.id]);
    expect(sessions.tasks.list({ project: "showroom" }).map((task) => task.id)).toEqual([two.id, one.id]);
    expect(sessions.tasks.list({ state: "failed" })).toEqual([]);
    expect(readFileSync(file, "utf8")).toContain("scenity.agent-tasks/1");
    const store = new TaskStore(file);
    store.put({ ...two, id: "t9", state: "running", endedAt: null });
    expect(new TaskStore(file).get("t9")).toMatchObject({ state: "stopped", reason: "The studio stopped." });
    expect(taskMatches(one, { text: "LIGHT chair" })).toBe(true);
    expect(taskMatches(one, { text: "light lamp" })).toBe(false);
  });
});

describe("the groups of parallel tasks", () => {
  test("one prompt for three variants: three sessions, each with its place in the group", async () => {
    const { sessions } = setupOf({ gates: [true] });
    const tasks = sessions.tasks.startGroup("showroom", { prompt: "Three lighting moods", kind: "variants", count: 3 });
    expect(tasks.map((task) => task.prompt)).toEqual(
      [1, 2, 3].map((at) => `Three lighting moods (variant ${String(at)} of 3)`),
    );
    expect(tasks.map((task) => task.name)).toEqual([
      "Three lighting moods 1/3",
      "Three lighting moods 2/3",
      "Three lighting moods 3/3",
    ]);
    expect(new Set(tasks.map((task) => task.session)).size).toBe(3);
    expect(new Set(tasks.map((task) => task.group?.id)).size).toBe(1);
    expect(tasks.map((task) => task.group?.index)).toEqual([1, 2, 3]);
    for (const task of tasks)
      expect(await ended(sessions, task.id)).toMatchObject({ state: "done", group: { kind: "variants", count: 3 } });
  });

  test("a split gives each part to its own task; a group has 2 to 6 tasks", () => {
    const { sessions } = setupOf();
    const tasks = sessions.tasks.startGroup("showroom", {
      prompt: "Furnish",
      kind: "split",
      parts: ["The chairs", " ", "The lights"],
    });
    expect(tasks.map((task) => [task.prompt, task.group?.kind, task.group?.count])).toEqual([
      ["The chairs", "split", 2],
      ["The lights", "split", 2],
    ]);
    expect(() => sessions.tasks.startGroup("showroom", { prompt: "go", kind: "variants", count: 7 })).toThrow("2 to 6");
    expect(() => sessions.tasks.startGroup("showroom", { prompt: "go", kind: "split", parts: ["one"] })).toThrow(
      "2 to 6",
    );
    expect(() => sessions.tasks.startGroup("showroom", { prompt: " ", kind: "variants", count: 2 })).toThrow("empty");
  });
});
