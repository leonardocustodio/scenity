// SPDX-License-Identifier: Apache-2.0
/**
 * The background tasks of the studio. A task is a chain of turns of one agent session in Review mode, so its changes
 * wait in Review. It has a budget, a count of turns, a time limit and a gate. After each turn, the gate checks the
 * rules on the document after the change sets of the task (the call `task.gate` of the editor window). A failed check
 * sends its words to the agent as the next prompt, at most `maxRefusals` times in a row. A task that stops at a limit
 * gets one last check of the gate. At the end, the host writes the review pack (taskPack.ts), keeps the record
 * (taskStore.ts) and sends the event `agent.task`. A task in a worktree works in a Git worktree of the project on a
 * branch of its own. Its gate `check` runs `scenity check` in the task folder after the rules (taskFolder.ts).
 */
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { callTyped, captureOf, type SurfacePort } from "@scenity/agent-tools";
import { TASK_DOCUMENT_CALL, TASK_FRAMES_CALL, TASK_GATE_CALL } from "@scenity/bridge";
import { cliCommand } from "../runtime";
import type { AgentChip } from "./context";
import { AUTO_DEFAULTS } from "./limits";
import type { ActionKind } from "./permissions";
import type {
  AgentEvent,
  AgentItem,
  AgentSessionView,
  AgentTaskInfo,
  TaskCheck,
  TaskGateKind,
  TaskGroup,
  TaskGroupKind,
  TaskState,
} from "./protocol";
import { makeWorktree, runProjectCheck, type TaskWorktree } from "./taskFolder";
import { writePack, type PackPicture } from "./taskPack";
import { taskEnded, TaskStore, type TaskQuery } from "./taskStore";
import type { TurnRecordView } from "./turns";

/** The most failed gate checks in a row before the task ends (as the stop gate of the workbench). */
export const MAX_REFUSALS = 5;
/** The wait for the gate and the pictures of a window (ms). */
const GATE_TIMEOUT_MS = 120_000;

/** What the tasks use of the sessions. */
export interface TaskSessions {
  create(
    project: string,
    patch: { name: string; mode: "review"; budgetUsd: number; maxTurns: number; task: string },
  ): AgentSessionView;
  prompt(id: string, text: string, context?: readonly AgentChip[]): unknown;
  stop(id: string): void;
  list(project?: string): AgentSessionView[];
  turnRecords(id: string): TurnRecordView[];
}

export interface AgentTasksOptions {
  readonly sessions: TaskSessions;
  /** The port of the editor windows of a project. */
  port(project: string): SurfacePort;
  dirOf(project: string): string | null;
  emit(event: AgentEvent): void;
  /** The record file (none: no record on disk). */
  readonly file?: string | null;
  readonly maxRefusals?: number;
  /** The length of a minute in ms (a test gives a short minute). */
  readonly minuteMs?: number | undefined;
  /** The command line of the `scenity` CLI for the gate `check` (default: `cliCommand()`). */
  readonly cli?: readonly string[];
  /** The folder of the worktrees of the tasks (default: `worktrees` beside the record file). */
  readonly worktrees?: string;
}

/** The request of a new task. */
export interface TaskRequest {
  readonly prompt: string;
  readonly name?: string;
  readonly budgetUsd?: number;
  readonly maxTurns?: number;
  readonly maxMinutes?: number;
  readonly gate?: TaskGateKind;
  readonly context?: readonly AgentChip[];
  /** The group of parallel tasks of the task. */
  readonly group?: TaskGroup;
  /** True: the task works in a Git worktree of the project on a branch of its own. */
  readonly worktree?: boolean;
}

/** The request of a group of parallel tasks. */
export interface TaskGroupRequest extends Omit<TaskRequest, "group"> {
  readonly kind: TaskGroupKind;
  /** The count of the variants of a `variants` group. */
  readonly count?: number;
  /** The prompts of the parts of a `split` group. */
  readonly parts?: readonly string[];
}

/** The fewest and the most tasks of a group. */
export const GROUP_MIN = 2;
export const GROUP_MAX = 6;

/** The prompt of one variant: the prompt of the group and the place of the variant in it. */
export function variantPrompt(prompt: string, index: number, count: number): string {
  return `${prompt} (variant ${String(index)} of ${String(count)})`;
}

/** The Git branch of a folder, or null. */
export function gitBranch(dir: string | null): string | null {
  if (dir === null) return null;
  const run = Bun.spawnSync(["git", "-C", dir, "rev-parse", "--abbrev-ref", "HEAD"], { stderr: "ignore" });
  const branch = run.stdout.toString().trim();
  return run.exitCode === 0 && branch !== "" ? branch : null;
}

/** The prompt after a failed check of the gate. */
export function gatePrompt(check: TaskCheck): string {
  return `The gate of the task failed: ${check.message} Fix the cause, or say why the gate cannot pass.`;
}

/** The text of the last error item of a session after an item ID, or null. */
function lastError(items: readonly AgentItem[]): string | null {
  const found = items.findLast((item) => item.kind === "error");
  return found?.kind === "error" ? found.text : null;
}

/** The background tasks of the host. */
export class AgentTasks {
  readonly #options: AgentTasksOptions;
  readonly #store: TaskStore;
  /** The task of each session of a running task. */
  readonly #bySession = new Map<string, string>();
  readonly #timers = new Map<string, ReturnType<typeof setTimeout>>();
  /** The tasks that the owner stopped, and the tasks that ran out of time. */
  readonly #stopped = new Set<string>();
  readonly #timedOut = new Set<string>();
  /** The project folder in the worktree of each session of a task in a worktree. */
  readonly #worktrees = new Map<string, string>();
  #count = 0;

  constructor(options: AgentTasksOptions) {
    this.#options = options;
    this.#store = new TaskStore(options.file ?? null);
  }

  /** The folder of the files of a session: the worktree of its task, else the project folder. */
  folderOf(project: string, session?: string): string | null {
    return (session === undefined ? undefined : this.#worktrees.get(session)) ?? this.#options.dirOf(project);
  }

  /**
   * The kinds that a session can do with no card. A session of a task in a worktree writes its files there, never
   * in the folder of the person. Thus its file writes need no approval.
   */
  allowedOf(session: string, allowed: Set<ActionKind>): Set<ActionKind> {
    if (this.#worktrees.has(session)) allowed.add("files");
    return allowed;
  }

  /** The tasks of a search, the newest first. */
  list(query: TaskQuery = {}): AgentTaskInfo[] {
    return this.#store.search(query);
  }

  /** Start a background task of a project: a session in Review mode, its first prompt and its time limit. */
  start(project: string, request: TaskRequest): AgentTaskInfo {
    const prompt = request.prompt.trim();
    if (prompt === "") throw new Error("The prompt of the task is empty.");
    const limits = {
      budgetUsd: request.budgetUsd ?? AUTO_DEFAULTS.budgetUsd,
      maxTurns: request.maxTurns ?? AUTO_DEFAULTS.maxTurns,
      maxMinutes: request.maxMinutes ?? AUTO_DEFAULTS.maxMinutes,
    };
    if (!(limits.budgetUsd > 0)) throw new Error("A background task needs a budget.");
    if (!(limits.maxTurns >= 1) || !(limits.maxMinutes > 0)) throw new Error("A task needs turns and minutes.");
    this.#count += 1;
    const id = `t${String(this.#count)}-${Date.now().toString(36)}`;
    const name =
      request.name?.trim() === undefined || request.name.trim() === "" ? prompt.slice(0, 40) : request.name.trim();
    const worktree = request.worktree === true ? this.#worktree(project, id) : null;
    const { budgetUsd, maxTurns } = limits;
    const session = this.#options.sessions.create(project, { name, mode: "review", budgetUsd, maxTurns, task: id });
    const task: AgentTaskInfo = {
      id,
      project,
      session: session.id,
      name,
      colour: session.colour,
      prompt,
      state: "running",
      startedAt: Date.now(),
      endedAt: null,
      ...limits,
      costUsd: 0,
      sets: [],
      branch: worktree?.branch ?? gitBranch(this.#options.dirOf(project)),
      worktree: worktree?.project ?? null,
      gate: request.gate ?? "rules",
      refusals: 0,
      check: null,
      reason: null,
      pack: null,
      ...(request.group === undefined ? {} : { group: request.group }),
    };
    this.#bySession.set(session.id, id);
    if (worktree !== null) this.#worktrees.set(session.id, worktree.project);
    this.#put(task);
    const minute = this.#options.minuteMs ?? 60_000;
    const timer = setTimeout(() => {
      this.#timedOut.add(id);
      this.#options.sessions.stop(session.id);
      // A task between two turns (a gate check) ends here.
      if (this.#get(id).state === "checking") void this.#finish(id, "timeout", this.#limitWords(id));
    }, limits.maxMinutes * minute);
    this.#timers.set(id, timer);
    this.#options.sessions.prompt(session.id, prompt, request.context ?? []);
    return task;
  }

  /**
   * Start a group of parallel tasks: the same prompt for each variant (with its place in the group), or one
   * part of the work for each task of a split. Each task has its own session, so its changes wait in their own sets.
   */
  startGroup(project: string, request: TaskGroupRequest): AgentTaskInfo[] {
    const { kind, count, parts, ...rest } = request;
    const prompt = request.prompt.trim();
    const prompts =
      kind === "split"
        ? (parts ?? []).map((part) => part.trim()).filter((part) => part !== "")
        : Array.from({ length: count ?? 3 }, (_, at) => variantPrompt(prompt, at + 1, count ?? 3));
    if (kind === "variants" && prompt === "") throw new Error("The prompt of the task is empty.");
    if (prompts.length < GROUP_MIN || prompts.length > GROUP_MAX)
      throw new Error(`A group has ${String(GROUP_MIN)} to ${String(GROUP_MAX)} tasks.`);
    this.#count += 1;
    const id = `g${String(this.#count)}-${Date.now().toString(36)}`;
    const given = request.name?.trim() ?? "";
    const name = given !== "" ? given : (prompt === "" ? (prompts[0] ?? "") : prompt).slice(0, 40);
    return prompts.map((text, at) => {
      const group: TaskGroup = { id, kind, index: at + 1, count: prompts.length };
      return this.start(project, {
        ...rest,
        prompt: text,
        name: `${name} ${String(at + 1)}/${String(prompts.length)}`,
        group,
      });
    });
  }

  /** The owner stops a task. Its turn stops, and the task ends with no check. */
  stop(id: string): AgentTaskInfo {
    const task = this.#get(id);
    if (taskEnded(task)) return task;
    this.#stopped.add(id);
    this.#options.sessions.stop(task.session);
    if (task.state === "checking") void this.#finish(id, "stopped", "The owner stopped the task.");
    return this.#get(id);
  }

  /** Watch the events of the sessions: the cost and the end of each turn of a task. */
  observe(event: AgentEvent): void {
    if (event.type === "agent.session") {
      const id = this.#bySession.get(event.session.id);
      const task = id === undefined ? null : this.#store.get(id);
      if (task !== null && task.costUsd !== event.session.costUsd)
        this.#put({ ...task, costUsd: event.session.costUsd });
    } else if (event.type === "agent.closed") {
      const id = this.#bySession.get(event.session);
      if (id !== undefined) void this.#finish(id, "stopped", "The session of the task closed.");
    } else if (event.type === "agent.item" && event.item.kind === "end") {
      const id = this.#bySession.get(event.session);
      if (id !== undefined) void this.#turnEnded(id, event.item.reason, event.item.turn);
    }
  }

  #get(id: string): AgentTaskInfo {
    const task = this.#store.get(id);
    if (task === null) throw new Error(`No task ${id}.`);
    return task;
  }

  #put(task: AgentTaskInfo): void {
    this.#store.put(task);
    this.#options.emit({ type: "agent.task", task });
  }

  #patch(id: string, patch: Partial<AgentTaskInfo>): AgentTaskInfo {
    const next = { ...this.#get(id), ...patch };
    this.#put(next);
    return next;
  }

  /** The words of the end of a task at a limit: the error of its session, or the time limit. */
  #limitWords(id: string): string {
    const task = this.#get(id);
    if (this.#timedOut.has(id)) return `The task ran ${String(task.maxMinutes)} minutes, its limit, and stopped.`;
    const session = this.#options.sessions.list(task.project).find((item) => item.id === task.session);
    return lastError(session?.items ?? []) ?? "The task stopped at a limit.";
  }

  /** The end of a turn of a task: the gate, the next turn or the end. */
  async #turnEnded(id: string, reason: "done" | "stopped" | "error", turn: number): Promise<void> {
    const task = this.#get(id);
    if (taskEnded(task)) return;
    const sets = [...task.sets, `${task.session}#${String(turn)}`];
    this.#patch(id, { state: "checking", sets });
    if (this.#stopped.has(id)) return this.#finish(id, "stopped", "The owner stopped the task.");
    if (reason !== "done") {
      // A turn that stops at a limit or fails gets one last check of the gate (the end check of the workbench).
      const state: TaskState = this.#timedOut.has(id) ? "timeout" : "failed";
      const words = this.#limitWords(id);
      if (task.gate !== "none") this.#patch(id, { check: await this.#gate(id) });
      return this.#finish(id, state, words);
    }
    if (task.gate === "none") return this.#finish(id, "done", "The turn ended; the task has no gate.");
    const check = await this.#gate(id);
    if (taskEnded(this.#get(id))) return;
    if (check.passed !== false) {
      this.#patch(id, { check, refusals: 0 });
      return this.#finish(id, "done", check.passed === null ? check.message : "The gate passed.");
    }
    const refusals = this.#get(id).refusals + 1;
    this.#patch(id, { check, refusals });
    const most = this.#options.maxRefusals ?? MAX_REFUSALS;
    if (refusals > most) return this.#finish(id, "failed", `The gate failed ${String(refusals)} times in a row.`);
    try {
      this.#options.sessions.prompt(task.session, gatePrompt(check));
      this.#patch(id, { state: "running" });
    } catch (error) {
      await this.#finish(id, "failed", error instanceof Error ? error.message : String(error));
    }
  }

  /** The check of the gate of a task: the rules, then (the gate `check`) `scenity check` of the task folder. */
  async #gate(id: string): Promise<TaskCheck> {
    const rules = await this.#check(id);
    if (this.#get(id).gate !== "check" || rules.passed === false) return rules;
    return this.#projectCheck(id);
  }

  /** `scenity check` of the task folder, with the scene of the window after the change sets (a worktree). */
  async #projectCheck(id: string): Promise<TaskCheck> {
    const task = this.#get(id);
    const folder = task.worktree ?? this.#options.dirOf(task.project);
    const at = Date.now();
    if (folder === null) return { passed: null, message: "The check did not run: the project has no folder.", at };
    try {
      if (task.worktree != null) {
        const port = this.#options.port(task.project);
        const scene = await callTyped(port, TASK_DOCUMENT_CALL, [task.session], GATE_TIMEOUT_MS);
        const file = resolve(folder, scene.path);
        if (relative(folder, file).startsWith("..")) throw new Error(`the scene ${scene.path} is not in the project`);
        writeFileSync(file, scene.text);
      }
      const run = await runProjectCheck(this.#options.cli ?? cliCommand(), folder);
      return { passed: run.passed, message: run.message, at: Date.now() };
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error);
      return { passed: null, message: `The check did not run: ${words}`, at: Date.now() };
    }
  }

  /** The worktree of a new task (its folder: the option, else `worktrees` beside the record file). */
  #worktree(project: string, id: string): TaskWorktree {
    const dir = this.#options.dirOf(project);
    if (dir === null) throw new Error(`No folder of the project ${project}.`);
    const file = this.#options.file ?? join(tmpdir(), "scenity-studio", "agent-tasks.json");
    return makeWorktree(dir, this.#options.worktrees ?? join(dirname(file), "worktrees"), id);
  }

  /** A check of the gate in the editor window of the project. An error is a check that did not run. */
  async #check(id: string): Promise<TaskCheck> {
    const task = this.#get(id);
    try {
      const port = this.#options.port(task.project);
      const answer = await callTyped(port, TASK_GATE_CALL, [task.session], GATE_TIMEOUT_MS);
      return { passed: answer.passed, message: answer.message, at: Date.now() };
    } catch (error) {
      const words = error instanceof Error ? error.message : String(error);
      return { passed: null, message: `The gate did not run: ${words}`, at: Date.now() };
    }
  }

  /** The end of a task: its state, its review pack (not after a stop of the owner) and the record. */
  async #finish(id: string, state: TaskState, reason: string): Promise<void> {
    if (taskEnded(this.#get(id))) return;
    clearTimeout(this.#timers.get(id));
    this.#timers.delete(id);
    const task = this.#patch(id, { state: "checking", endedAt: Date.now(), reason });
    const dir = this.#options.dirOf(task.project);
    let pack: string | null = null;
    if (state !== "stopped" && dir !== null) {
      const pictures = await this.#pictures(task);
      const turns = this.#options.sessions.turnRecords(task.session);
      pack = writePack(dir, { ...task, state }, turns, pictures);
    }
    this.#bySession.delete(task.session);
    this.#stopped.delete(id);
    this.#timedOut.delete(id);
    this.#patch(id, { state, pack });
  }

  /** The pictures before and after the change sets of a task (none with no window). */
  async #pictures(task: AgentTaskInfo): Promise<PackPicture[]> {
    try {
      const port = this.#options.port(task.project);
      const frames = await callTyped(port, TASK_FRAMES_CALL, [task.session], GATE_TIMEOUT_MS);
      return frames.map((frame) => captureOf(frame));
    } catch {
      return [];
    }
  }
}
