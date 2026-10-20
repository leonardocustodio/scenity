// SPDX-License-Identifier: Apache-2.0
/**
 * The record of the background tasks: each task with its state, its
 * cost, its change sets, its gate checks and its review pack, in the studio state folder (`agent-tasks.json`, the
 * newest first). A search finds old tasks by project, state and text (the experiment log of the workbench). At the
 * next start, a task that ran when the host stopped gets the state "stopped".
 */
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { AgentTaskInfo, TaskState } from "./protocol";

/** The most tasks in the record. */
export const TASKS_MAX = 500;

/** A search of the tasks. */
export interface TaskQuery {
  readonly project?: string;
  readonly state?: TaskState;
  /** Words that the prompt, the name, the reason or the gate words contain (no case). */
  readonly text?: string;
  readonly limit?: number;
}

/** True when a task is at its end. */
export function taskEnded(task: Pick<AgentTaskInfo, "state">): boolean {
  return task.state !== "running" && task.state !== "checking";
}

/** True when a task matches a search. */
export function taskMatches(task: AgentTaskInfo, query: TaskQuery): boolean {
  if (query.project !== undefined && task.project !== query.project) return false;
  if (query.state !== undefined && task.state !== query.state) return false;
  const words = (query.text ?? "").toLowerCase().split(/\s+/).filter(Boolean);
  const hay = [task.prompt, task.name, task.reason ?? "", task.check?.message ?? "", task.branch ?? ""]
    .join(" ")
    .toLowerCase();
  return words.every((word) => hay.includes(word));
}

/** The record of the tasks (none: a host with no state folder, a test). */
export class TaskStore {
  readonly #file: string | null;
  #tasks: AgentTaskInfo[] = [];

  constructor(file: string | null, now = Date.now()) {
    this.#file = file;
    if (file === null || !existsSync(file)) return;
    try {
      const value = JSON.parse(readFileSync(file, "utf8")) as { tasks?: AgentTaskInfo[] };
      this.#tasks = (value.tasks ?? []).map((task) =>
        taskEnded(task) ? task : { ...task, state: "stopped", endedAt: now, reason: "The studio stopped." },
      );
    } catch {
      this.#tasks = [];
    }
  }

  get(id: string): AgentTaskInfo | null {
    return this.#tasks.find((task) => task.id === id) ?? null;
  }

  /** Keep a task (a new task goes first) and write the record. */
  put(task: AgentTaskInfo): void {
    const at = this.#tasks.findIndex((item) => item.id === task.id);
    if (at < 0) this.#tasks = [task, ...this.#tasks].slice(0, TASKS_MAX);
    else this.#tasks[at] = task;
    if (this.#file === null) return;
    const temp = `${this.#file}.tmp`;
    writeFileSync(temp, `${JSON.stringify({ format: "scenity.agent-tasks/1", tasks: this.#tasks })}\n`);
    renameSync(temp, this.#file);
  }

  /** The tasks of a search, the newest first (default 50, at most 200). */
  search(query: TaskQuery = {}): AgentTaskInfo[] {
    const limit = Math.min(200, Math.max(1, query.limit ?? 50));
    return this.#tasks.filter((task) => taskMatches(task, query)).slice(0, limit);
  }
}
