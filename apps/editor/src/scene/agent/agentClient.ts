// SPDX-License-Identifier: Apache-2.0
/**
 * The client of the agent sessions of the studio host. It uses the API `/api/agent/sessions` with the session of the
 * studio (the CSRF header), and the events `agent.*` of the socket `/events`. The types are the JSON of the host
 * (`@scenity/studio-host` agents/protocol.ts).
 */
import { csrfValue } from "../../hub/studioApi";

export type AgentMode = "ask" | "review" | "auto";
export type AgentEffort = "low" | "medium" | "high" | "max";

/** A chip that went with a prompt (no picture data). */
export interface ChipLine {
  readonly kind: string;
  readonly label: string;
  readonly text: string;
  readonly picture: boolean;
}

/** A chip as the host takes it with a prompt. */
export interface PromptChip {
  readonly kind: string;
  readonly label: string;
  readonly text: string;
  readonly picture?: { readonly mime: string; readonly data: string };
}

/** The answer to an approval card. */
export type ApprovalDecision = "once" | "session" | "deny";

/** One item of a transcript. */
export type AgentItem =
  | {
      readonly id: number;
      readonly kind: "prompt";
      readonly text: string;
      readonly context?: readonly ChipLine[];
      /** The turn of the prompt and its time (its checkpoint). */
      readonly turn?: number;
      readonly at?: number;
    }
  | { readonly id: number; readonly kind: "text"; readonly text: string }
  | { readonly id: number; readonly kind: "error"; readonly text: string }
  | {
      readonly id: number;
      readonly kind: "tool";
      readonly name: string;
      readonly input: unknown;
      readonly result: string | null;
      readonly isError: boolean;
      /** The IDs of the pictures of the result (`/api/agent/pictures/<id>`). */
      readonly pictures: readonly string[];
    }
  | { readonly id: number; readonly kind: "end"; readonly reason: "done" | "stopped" | "error"; readonly turn?: number }
  | {
      readonly id: number;
      readonly kind: "approval";
      readonly approval: string;
      /** The kind of the action: scene, files, runs, imports, network or git. */
      readonly action: string;
      readonly title: string;
      readonly detail: string;
      readonly decision: ApprovalDecision | null;
    }
  | {
      readonly id: number;
      readonly kind: "plan";
      /** The ID of the approval of the plan, its title, its steps, files and risks, the decision. */
      readonly approval: string;
      readonly title: string;
      readonly steps: readonly { readonly text: string; readonly state: "todo" | "doing" | "done" | "skipped" }[];
      readonly files: readonly string[];
      readonly risks: readonly string[];
      readonly decision: "approved" | "denied" | null;
      readonly summary: string | null;
      readonly path: string | null;
    }
  | {
      readonly id: number;
      readonly kind: "question";
      /** The ID of the question, its text, its choices, and the answer or null. */
      readonly question: string;
      readonly text: string;
      readonly options: readonly string[];
      readonly answer: string | null;
    }
  | {
      readonly id: number;
      readonly kind: "undone";
      readonly turn: number;
      readonly restore?: boolean;
      readonly files: readonly string[];
      readonly steps: number;
      readonly error: string | null;
    };

/** A session without its transcript. */
export interface AgentSessionInfo {
  readonly id: string;
  readonly project: string;
  readonly name: string;
  /** The colour token of the session (`agent-1` to `agent-6`). */
  readonly colour: string;
  readonly mode: AgentMode;
  readonly model: string;
  readonly effort: AgentEffort;
  readonly running: boolean;
  readonly queued: number;
  readonly costUsd: number;
  readonly contextShare: number | null;
  /** The budget (USD) or null. `waiting` is true while an approval card waits. */
  readonly budgetUsd?: number | null;
  readonly waiting?: boolean;
  /** The tokens of the session, the maximum number of turns and the maximum minutes of a turn. */
  readonly tokens?: number;
  readonly maxTurns?: number | null;
  readonly maxMinutes?: number | null;
  /** Each turn needs an approved plan before an edit. */
  readonly planFirst?: boolean;
  /** The session of an external agent (no prompt of the panel). */
  readonly external?: boolean;
}

export interface AgentSessionView extends AgentSessionInfo {
  readonly items: readonly AgentItem[];
}

/** The answer of the list: the driver, the choices and the sessions. */
export interface AgentListing {
  readonly driver: string;
  readonly modes: readonly AgentMode[];
  readonly models: readonly string[];
  readonly efforts: readonly AgentEffort[];
  readonly sessions: readonly AgentSessionView[];
}

/** A connection request of an external agent. */
export interface ConnectionView {
  readonly id: string;
  readonly name: string;
  readonly project: string | null;
  readonly state: "pending" | "allowed" | "denied";
  readonly session: string | null;
  readonly at: number;
}

/** The states of a background task. */
export type TaskState = "running" | "checking" | "done" | "failed" | "stopped" | "timeout";

/** The place of a task in a group of parallel tasks (agents/protocol.ts `TaskGroup`). */
export interface TaskGroupInfo {
  readonly id: string;
  readonly kind: "variants" | "split";
  readonly index: number;
  readonly count: number;
}

/** A background task (the JSON of the host, agents/protocol.ts `AgentTaskInfo`). */
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
  readonly branch: string | null;
  /** The project folder in the worktree of the task, or null (absent) for a task in the project folder. */
  readonly worktree?: string | null;
  readonly gate: "rules" | "check" | "none";
  readonly refusals: number;
  readonly check: { readonly passed: boolean | null; readonly message: string; readonly at: number } | null;
  readonly reason: string | null;
  /** The folder of the review pack (a path in the project), or null. */
  readonly pack: string | null;
  /** The group of parallel tasks of the task (none: a task alone). */
  readonly group?: TaskGroupInfo;
}

/** The request of a new background task. */
export interface TaskRequest {
  readonly prompt: string;
  readonly name?: string;
  readonly budgetUsd?: number;
  readonly maxMinutes?: number;
  readonly maxTurns?: number;
  readonly gate?: "rules" | "check" | "none";
  /** When true, the task works in a Git worktree of the project on a branch of its own. */
  readonly worktree?: boolean;
  /** The count of the variants (2 to 6): one task for each, with the same prompt. */
  readonly variants?: number;
  /** The parts of a split (2 to 6): one task for each part. */
  readonly parts?: readonly string[];
}

/** The answer of the host to a new task: the task, or the tasks of a new group. */
export type TaskStart = AgentTaskInfo | { readonly tasks: readonly AgentTaskInfo[] };

export type AgentEvent =
  | { readonly type: "agent.task"; readonly task: AgentTaskInfo }
  | { readonly type: "agent.connections"; readonly connections: readonly ConnectionView[] }
  | { readonly type: "agent.session"; readonly session: AgentSessionInfo }
  | { readonly type: "agent.item"; readonly session: string; readonly item: AgentItem }
  | { readonly type: "agent.closed"; readonly session: string };

/** The changes of a session that a person can make. */
export interface AgentPatch {
  readonly name?: string;
  readonly mode?: AgentMode;
  readonly model?: string;
  readonly effort?: AgentEffort;
  readonly budgetUsd?: number;
  readonly planFirst?: boolean;
}

/** The instructions of a project: AGENTS.md, CLAUDE.md and the skills. */
export interface ProjectInstructions {
  readonly agents: string | null;
  readonly claude: string | null;
  readonly skills: readonly { readonly file: string; readonly name: string; readonly use: string }[];
}

/** A recipe: a saved prompt with parameters (`{name}` in the prompt). */
export interface RecipeInfo {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly params: readonly {
    readonly name: string;
    readonly label: string;
    readonly default?: string;
    readonly choices?: readonly string[];
  }[];
  readonly source: "studio" | "user" | "project" | "plugin";
}

export interface AgentClient {
  /** The connection requests of the external agents, and the answer of the owner. */
  connections(): Promise<{ readonly connections: readonly ConnectionView[] }>;
  allowConnection(id: string, project: string): Promise<void>;
  denyConnection(id: string): Promise<void>;
  /** An allowed connection for an MCP client over HTTP (Hub → Agents); the answer has its token once. */
  addConnection(name: string, project: string): Promise<ConnectionView & { readonly token: string }>;
  /** Revoke the token of a connection. */
  revokeConnection(id: string): Promise<void>;
  /** The background tasks of a project (a text searches old ones), a new task, and the stop of a task. */
  tasks(project: string, text?: string): Promise<{ readonly tasks: readonly AgentTaskInfo[] }>;
  startTask(project: string, request: TaskRequest): Promise<TaskStart>;
  stopTask(id: string): Promise<AgentTaskInfo>;
  /** Whether the studio runs agent sessions (false: `--no-agent`), and its driver. */
  status(): Promise<{ readonly available: boolean; readonly driver: string | null }>;
  /** The recipes of the studio, of the person and of the project. */
  recipes(project: string): Promise<{ readonly recipes: readonly RecipeInfo[] }>;
  /** Read the instructions of a project, and write its AGENTS.md. */
  instructions(project: string): Promise<ProjectInstructions>;
  saveInstructions(project: string, agents: string): Promise<ProjectInstructions>;
  list(project: string): Promise<AgentListing>;
  create(project: string, patch?: AgentPatch): Promise<AgentSessionView>;
  update(id: string, patch: AgentPatch): Promise<AgentSessionInfo>;
  prompt(id: string, text: string, context?: readonly PromptChip[]): Promise<{ queued: number }>;
  stop(id: string): Promise<void>;
  /** A new session with a copy of the transcript that continues the conversation. */
  fork(id: string): Promise<AgentSessionView>;
  /** "Undo the turn": revert the files and the document steps of a turn. */
  undoTurn(id: string, turn: number): Promise<unknown>;
  /** The answer of the person to a question of the agent. */
  answerQuestion(id: string, question: string, answer: string): Promise<void>;
  /** The answer of the person to an approval card. */
  answer(id: string, approval: string, decision: ApprovalDecision, steps?: readonly string[]): Promise<void>;
  /** Restore the checkpoint of a turn (its files and its scene). */
  restore(id: string, turn: number): Promise<unknown>;
  /** The files of each turn (the turn records of the host). */
  turns(id: string): Promise<{
    readonly turns: readonly { readonly turn: number; readonly files: readonly string[]; readonly undone?: boolean }[];
  }>;
  close(id: string): Promise<void>;
  /** Follow the events of the sessions. `opened` runs at each new connection. The returned function stops it. */
  events(listener: (event: AgentEvent) => void, opened?: () => void): () => void;
}

/** The wait before a closed event socket opens again (ms). */
const RETRY_MS = 2000;

/** The fetch of the client (a test gives a fake). */
export type AgentFetch = (input: string, init?: RequestInit) => Promise<Response>;

/** The client over `fetch` (a test gives a fake). */
export function agentClient(fetcher: AgentFetch = (input, init) => fetch(input, init)): AgentClient {
  const call = async <T>(path: string, method = "GET", body?: unknown): Promise<T> => {
    const headers: Record<string, string> = { "x-studio-csrf": csrfValue() };
    if (body !== undefined) headers["content-type"] = "application/json";
    const answer = await fetcher(path, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const data = (await answer.json().catch(() => ({}))) as T & { error?: string };
    if (!answer.ok) throw new Error(data.error ?? `${method} ${path}: ${String(answer.status)}`);
    return data;
  };
  const base = "/api/agent/sessions";
  const one = (id: string, action = ""): string => `${base}/${encodeURIComponent(id)}${action}`;
  return {
    connections: () => call("/api/agent/connections"),
    allowConnection: async (id, project) => {
      await call(`/api/agent/connections/${encodeURIComponent(id)}/allow`, "POST", { project });
    },
    denyConnection: async (id) => {
      await call(`/api/agent/connections/${encodeURIComponent(id)}/deny`, "POST", {});
    },
    addConnection: (name, project) => call("/api/agent/connections", "POST", { name, project }),
    revokeConnection: async (id) => {
      await call(`/api/agent/connections/${encodeURIComponent(id)}/revoke`, "POST", {});
    },
    status: () => call("/api/agent/status"),
    tasks: (project, text = "") =>
      call(
        `/api/agent/tasks?project=${encodeURIComponent(project)}${text === "" ? "" : `&q=${encodeURIComponent(text)}`}`,
      ),
    startTask: (project, request) => call("/api/agent/tasks", "POST", { ...request, project }),
    stopTask: (id) => call(`/api/agent/tasks/${encodeURIComponent(id)}/stop`, "POST", {}),
    recipes: (project) => call(`/api/agent/recipes?project=${encodeURIComponent(project)}`),
    instructions: (project) => call(`/api/agent/instructions?project=${encodeURIComponent(project)}`),
    saveInstructions: (project, agents) => call("/api/agent/instructions", "PUT", { project, agents }),
    list: (project) => call(`${base}?project=${encodeURIComponent(project)}`),
    create: (project, patch = {}) => call(base, "POST", { ...patch, project }),
    update: (id, patch) => call(one(id), "PATCH", patch),
    prompt: (id, text, context = []) => call(one(id, "/prompt"), "POST", { text, context }),
    stop: async (id) => {
      await call(one(id, "/stop"), "POST", {});
    },
    close: async (id) => {
      await call(one(id), "DELETE");
    },
    fork: (id) => call(one(id, "/fork"), "POST", {}),
    undoTurn: (id, turn) => call(one(id, `/turns/${String(turn)}/undo`), "POST", {}),
    restore: (id, turn) => call(one(id, `/turns/${String(turn)}/restore`), "POST", {}),
    answerQuestion: async (id, question, answer) => {
      await call(one(id, `/questions/${encodeURIComponent(question)}`), "POST", { answer });
    },
    answer: async (id, approval, decision, steps) => {
      const body = steps === undefined ? { decision } : { decision, steps };
      await call(one(id, `/approvals/${encodeURIComponent(approval)}`), "POST", body);
    },
    turns: (id) => call(one(id, "/turns")),
    events: (listener, opened) => {
      let stopped = false;
      let socket: WebSocket | null = null;
      const open = (): void => {
        if (stopped) return;
        socket = new WebSocket(`${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/events`);
        socket.onmessage = (message) => {
          const event = JSON.parse(String(message.data)) as { type?: unknown };
          if (typeof event.type === "string" && event.type.startsWith("agent.")) listener(event as AgentEvent);
        };
        socket.onopen = () => opened?.();
        socket.onclose = () => setTimeout(open, RETRY_MS);
      };
      open();
      return () => {
        stopped = true;
        socket?.close();
      };
    },
  };
}
