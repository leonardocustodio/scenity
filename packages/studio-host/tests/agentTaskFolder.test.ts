// SPDX-License-Identifier: Apache-2.0
// The folder of a background task: a task in a Git worktree on a branch of its own (the files of its session go
// there). Also the gate `check`: the rules, then `scenity check` of the worktree. Before the check, the gate writes
// the scene of the window with the change sets of the task to the worktree. A failed check returns to the agent.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentSessionView, AgentTaskInfo } from "../src/agents/protocol";
import { sessionPort } from "../src/agents/session";
import { AgentTasks, type TaskSessions } from "../src/agents/tasks";
import { BridgeHub, type BridgeSocket } from "../src/bridgeHub";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function folder(): string {
  const dir = mkdtempSync(join(tmpdir(), "studio-task-folder-"));
  dirs.push(dir);
  return dir;
}

function git(dir: string, ...args: string[]): void {
  const run = Bun.spawnSync(["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", ...args], {
    cwd: dir,
  });
  if (run.exitCode !== 0) throw new Error(run.stderr.toString());
}

const SCENE = "scenes/main.scene.json";
const EDITED = '{"edited":true}\n';

/** A window of the project: the rules pass, and the document of the task is EDITED. */
function windowOf(hub: BridgeHub): void {
  const socket: BridgeSocket = {
    send(text) {
      const message = JSON.parse(text) as { id: number; call?: string };
      if (message.call === undefined) return;
      const results: Record<string, unknown> = {
        "task.gate": { passed: true, message: "The rules pass.", sets: 1 },
        "task.document": { path: SCENE, text: EDITED, sets: 1 },
        "task.frames": [],
      };
      const result = results[message.call] ?? {};
      queueMicrotask(() => hub.message(socket, JSON.stringify({ workbench: 1, id: message.id, result })));
    },
  };
  hub.attach(socket);
  hub.message(socket, JSON.stringify({ type: "hello", project: "game", scene: SCENE }));
}

async function until(read: () => AgentTaskInfo | undefined, done: (task: AgentTaskInfo) => boolean) {
  for (let i = 0; i < 600; i += 1) {
    const task = read();
    if (task !== undefined && done(task)) return task;
    await Bun.sleep(5);
  }
  throw new Error("the task did not get there");
}

describe("the folder of a background task", () => {
  test("a task in a worktree, and the gate check that runs scenity check there", async () => {
    const repo = folder();
    const project = join(repo, "game");
    mkdirSync(join(project, "scenes"), { recursive: true });
    writeFileSync(join(project, "scenity.project.json"), "{}\n");
    writeFileSync(join(project, SCENE), "{}\n");
    git(repo, "init", "-q");
    git(repo, "add", "-A");
    git(repo, "commit", "-q", "-m", "First");
    const state = folder();
    // The fake CLI: the first check fails, the next one passes.
    const cli = join(state, "cli.ts");
    const count = join(state, "count");
    writeFileSync(
      cli,
      `import { existsSync, writeFileSync } from "node:fs";
const first = !existsSync(${JSON.stringify(count)});
writeFileSync(${JSON.stringify(count)}, "1");
console.log(first ? "1 rule fails: onFloor." : "scenity check: 3 rules pass.");
process.exit(first ? 1 : 0);
`,
    );
    const hub = new BridgeHub();
    windowOf(hub);
    const prompts: string[] = [];
    const sessions: TaskSessions = {
      create: () => ({ id: "s1", colour: "blue" }) as unknown as AgentSessionView,
      prompt: (_id, text) => prompts.push(text),
      stop: () => undefined,
      list: () => [],
      turnRecords: () => [],
    };
    const tasks = new AgentTasks({
      sessions,
      port: (key) => sessionPort(hub, key),
      dirOf: () => project,
      emit: () => undefined,
      file: join(state, "agent-tasks.json"),
      cli: [process.execPath, cli],
      worktrees: join(state, "worktrees"),
    });
    const task = tasks.start("game", { prompt: "Fix the floor.", gate: "check", worktree: true });
    expect(task.branch).toBe(`scenity/task-${task.id}`);
    expect(task.worktree).toBe(join(state, "worktrees", task.id, "game"));
    expect(existsSync(join(task.worktree ?? "", "scenity.project.json"))).toBe(true);
    expect(tasks.folderOf("game", "s1")).toBe(task.worktree ?? "");
    expect(tasks.folderOf("game")).toBe(project);
    const read = () => tasks.list().find((item) => item.id === task.id);
    tasks.observe({
      type: "agent.item",
      session: "s1",
      item: { id: 1, kind: "end", reason: "done", turn: 1 },
    } as never);
    const refused = await until(read, (item) => item.refusals === 1 && item.state === "running");
    expect(refused.check?.message).toContain("scenity check fails: 1 rule fails: onFloor.");
    expect(prompts.at(-1)).toContain("The gate of the task failed: scenity check fails");
    tasks.observe({
      type: "agent.item",
      session: "s1",
      item: { id: 2, kind: "end", reason: "done", turn: 2 },
    } as never);
    const done = await until(read, (item) => item.state === "done");
    expect(done.check).toMatchObject({ passed: true });
    // The worktree has the scene of the window with the change sets of the task.
    // The folder of the person does not change.
    expect(readFileSync(join(task.worktree ?? "", SCENE), "utf8")).toBe(EDITED);
    expect(readFileSync(join(project, SCENE), "utf8")).toBe("{}\n");
  });

  test("a task in a worktree needs Git", () => {
    const project = folder();
    const tasks = new AgentTasks({
      sessions: {} as TaskSessions,
      port: () => ({ call: () => Promise.reject(new Error("no window")) }),
      dirOf: () => project,
      emit: () => undefined,
      worktrees: join(project, "wt"),
    });
    expect(() => tasks.start("game", { prompt: "go", worktree: true })).toThrow("needs a project folder in a Git");
  });
});
