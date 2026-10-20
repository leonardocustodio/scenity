// SPDX-License-Identifier: Apache-2.0
/**
 * The words of the agent sessions of the studio: a session, its
 * mode, its model and effort, and the items of its transcript. The host sends them as JSON on the API and as the
 * events `agent.session`, `agent.item` and `agent.closed` on `/events`.
 */
import type { ApprovalDecision } from "./approvals";
import type { ChipLine } from "./context";
import type { ConnectionView } from "./external";
import type { ActionKind } from "./permissions";
import type { Plan } from "./plans";

/** The mode of a session: Ask reads only, Review makes proposals, and Auto applies the edits immediately. */
export type AgentMode = "ask" | "review" | "auto";
export const AGENT_MODES: readonly AgentMode[] = ["ask", "review", "auto"];

/** The effort of a session. */
export type AgentEffort = "low" | "medium" | "high" | "max";
export const AGENT_EFFORTS: readonly AgentEffort[] = ["low", "medium", "high", "max"];

/** The models that a person can choose (the aliases of Claude Code). */
export const AGENT_MODELS: readonly string[] = ["opus", "sonnet", "haiku"];

/** The colour tokens of the sessions (`--sc-color-studio-agent-<n>`), in the order of use. */
export const AGENT_COLOURS: readonly string[] = ["agent-1", "agent-2", "agent-3", "agent-4", "agent-5", "agent-6"];

/** One item of a transcript. */
export type AgentItem =
  | {
      readonly id: number;
      readonly kind: "prompt";
      readonly text: string;
      /** The turn of the prompt and its time (the checkpoint of the turn). */
      readonly turn: number;
      readonly at: number;
      /** The chips that went with the prompt. */
      readonly context: readonly ChipLine[];
    }
  | { readonly id: number; readonly kind: "text"; readonly text: string }
  | {
      readonly id: number;
      readonly kind: "tool";
      readonly name: string;
      readonly input: unknown;
      /** The text of the result. Null while the tool runs. */
      readonly result: string | null;
      readonly isError: boolean;
      /** The IDs of the pictures of the result (`GET /api/agent/pictures/<id>`). */
      readonly pictures: readonly string[];
    }
  | { readonly id: number; readonly kind: "error"; readonly text: string }
  | {
      readonly id: number;
      readonly kind: "end";
      readonly reason: "done" | "stopped" | "error";
      /** The turn that ended ("Undo the turn" names it). */
      readonly turn: number;
    }
  | {
      readonly id: number;
      readonly kind: "approval";
      /** The ID of the card (the answer names it), the kind of the action, its title and its detail. */
      readonly approval: string;
      readonly action: ActionKind;
      readonly title: string;
      readonly detail: string;
      /** Null while the card waits, else the decision of the person. */
      readonly decision: ApprovalDecision | null;
    }
  | ({ readonly id: number; readonly kind: "plan"; readonly approval: string } & Plan)
  | {
      readonly id: number;
      readonly kind: "question";
      /** The ID of the question (the answer names it), its text, its choices, and the answer or null. */
      readonly question: string;
      readonly text: string;
      readonly options: readonly string[];
      readonly answer: string | null;
    }
  | {
      readonly id: number;
      readonly kind: "undone";
      readonly turn: number;
      /** True for a restore of the checkpoint of the turn, false for "Undo the turn". */
      readonly restore: boolean;
      /** The restored files, and the reverted steps of the documents. */
      readonly files: readonly string[];
      readonly steps: number;
      readonly error: string | null;
    };

/** The state of a session without its transcript. */
export interface AgentSessionInfo {
  readonly id: string;
  readonly project: string;
  readonly name: string;
  readonly colour: string;
  readonly mode: AgentMode;
  readonly model: string;
  readonly effort: AgentEffort;
  /** True while a turn runs. */
  readonly running: boolean;
  /** The prompts that wait for the end of the turn. */
  readonly queued: number;
  /** The cost of the session (USD). */
  readonly costUsd: number;
  /** The budget of the session (USD), or null. An Auto session needs one, and it stops at the budget. */
  readonly budgetUsd: number | null;
  /** The tokens of the session, the most turns and the most minutes of a turn (null: no limit). */
  readonly tokens: number;
  readonly maxTurns: number | null;
  readonly maxMinutes: number | null;
  /** True while an approval card of the session waits for the person. */
  readonly waiting: boolean;
  /** True when each turn needs an approved plan before an edit, a write or a run. */
  readonly planFirst: boolean;
  /** True for the session of an external agent (an MCP client). It takes no prompt from the panel. */
  readonly external: boolean;
  /** The share of the context window that the last turn used (0 to 1), or null. */
  readonly contextShare: number | null;
  /** The background task of the session, or absent. */
  readonly task?: string;
}

/** The states of a background task. */
export const TASK_STATES = ["running", "checking", "done", "failed", "stopped", "timeout"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/**
 * The gates of a background task: the rules of the project (the default), the rules and then `scenity check`
 * of the task folder (`check`), or none.
 */
export const TASK_GATES = ["rules", "check", "none"] as const;
export type TaskGateKind = (typeof TASK_GATES)[number];

/** The kinds of a group of parallel tasks: one task for many agents, or a task in parts for many agents. */
export const TASK_GROUP_KINDS = ["variants", "split"] as const;
export type TaskGroupKind = (typeof TASK_GROUP_KINDS)[number];

/** The place of a task in a group of parallel tasks (each task has its own session and change sets). */
export interface TaskGroup {
  readonly id: string;
  readonly kind: TaskGroupKind;
  /** The place of the task in the group, from 1. */
  readonly index: number;
  readonly count: number;
}

/** A result of the gate of a task (`passed` null: the gate did not run). */
export interface TaskCheck {
  readonly passed: boolean | null;
  readonly message: string;
  readonly at: number;
}

/** A background task: a chain of turns of one session with a budget, a time limit and a gate. */
export interface AgentTaskInfo {
  readonly id: string;
  readonly project: string;
  readonly session: string;
  readonly name: string;
  readonly colour: string;
  readonly prompt: string;
  readonly state: TaskState;
  readonly startedAt: number;
  readonly endedAt: number | null;
  readonly budgetUsd: number;
  readonly maxTurns: number;
  readonly maxMinutes: number;
  readonly costUsd: number;
  /** The change sets of the turns (`<session>#<turn>`). */
  readonly sets: readonly string[];
  /** The Git branch of the project folder at the start (the branch of the worktree of a task in one), or null. */
  readonly branch: string | null;
  /** The project folder in the worktree of the task, or null (absent) for a task in the project folder. */
  readonly worktree?: string | null;
  readonly gate: TaskGateKind;
  /** The failed gate checks in a row. */
  readonly refusals: number;
  /** The last check of the gate, or null. */
  readonly check: TaskCheck | null;
  /** The words of the end, or null. */
  readonly reason: string | null;
  /** The folder of the review pack (a path in the project), or null. */
  readonly pack: string | null;
  /** The group of parallel tasks of the task (none: a task alone). */
  readonly group?: TaskGroup;
}

/** A session with its transcript. */
export interface AgentSessionView extends AgentSessionInfo {
  readonly items: readonly AgentItem[];
}

/** An event of the sessions on `/events`. */
export type AgentEvent =
  | { readonly type: "agent.session"; readonly session: AgentSessionInfo }
  | { readonly type: "agent.item"; readonly session: string; readonly item: AgentItem }
  | { readonly type: "agent.closed"; readonly session: string }
  | { readonly type: "agent.connections"; readonly connections: readonly ConnectionView[] }
  | { readonly type: "agent.task"; readonly task: AgentTaskInfo };

/** True for a mode. */
export function isAgentMode(value: unknown): value is AgentMode {
  return AGENT_MODES.includes(value as AgentMode);
}

/** True for an effort. */
export function isAgentEffort(value: unknown): value is AgentEffort {
  return AGENT_EFFORTS.includes(value as AgentEffort);
}
