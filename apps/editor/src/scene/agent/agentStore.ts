// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the agent panel: the sessions of the project with their transcripts, the active session, and the
 * choices of the host (the modes, the models and the efforts). The events of the host keep the state current. Each new
 * connection of the event socket reads the full list again. The mode of the active session sets the proposal switch of
 * the window. Auto applies the edits immediately. Ask and Review keep proposals.
 */
import { shallowRef, type ShallowRef } from "vue";
import type { ProposalMode } from "@scenity/editor-core";
import { createChipState, type AgentContextPort, type ChipState } from "./agentChips";
import type { AgentChip } from "./agentContext";
import type {
  AgentClient,
  ApprovalDecision,
  ConnectionView,
  RecipeInfo,
  AgentEffort,
  AgentEvent,
  AgentItem,
  AgentMode,
  AgentPatch,
  AgentSessionView,
  AgentTaskInfo,
  TaskRequest,
} from "./agentClient";

export interface AgentStoreParts {
  readonly project: string;
  readonly client: AgentClient;
  /** Set the proposal switch of the window. */
  setSwitch(mode: ProposalMode): void;
  /** The context of the window for the chips. When it is absent, the composer has no chip. */
  readonly context?: AgentContextPort;
}

/** The choices of the host. */
export interface AgentChoices {
  readonly driver: string;
  readonly modes: readonly AgentMode[];
  readonly models: readonly string[];
  readonly efforts: readonly AgentEffort[];
}

export interface AgentStore {
  readonly sessions: ShallowRef<readonly AgentSessionView[]>;
  readonly active: ShallowRef<string | null>;
  readonly choices: ShallowRef<AgentChoices | null>;
  /** The last error of a request, or null. */
  readonly error: ShallowRef<string | null>;
  /** The text of the composer. */
  readonly draft: ShallowRef<string>;
  /** The chips of the composer, and the context port (mentions, a region of the view). */
  readonly chips: ChipState;
  /** The connection requests of the external agents that wait for the owner, and the answer of the owner. */
  readonly connections: ShallowRef<readonly ConnectionView[]>;
  answerConnection(id: string, allow: boolean): Promise<void>;
  /** The background tasks of the project (the newest first), a new task, and the stop of a task. */
  readonly tasks: ShallowRef<readonly AgentTaskInfo[]>;
  startTask(request: TaskRequest): Promise<AgentTaskInfo | null>;
  stopTask(id: string): Promise<void>;
  /** The recipes of the project (`/` in the composer), and the run of one (the page sets it). */
  readonly recipes: ShallowRef<readonly RecipeInfo[]>;
  runRecipe: (id: string) => void;
  readonly context: AgentContextPort | null;
  /** The active session, or null. */
  current(): AgentSessionView | null;
  select(id: string): void;
  /** Make a new session (with a name, a mode, …). It becomes the active session. */
  create(patch?: AgentPatch): Promise<void>;
  /**
   * Send an inline prompt with the chips of its position to the active session, or to a new session with the name of
   * the subject. Return true when the prompt went.
   */
  sendInline(text: string, chips: readonly AgentChip[], subject: string): Promise<boolean>;
  send(text: string): Promise<boolean>;
  /** Send the text of the composer and clear it. */
  submit(): Promise<void>;
  stop(): Promise<void>;
  close(id: string): Promise<void>;
  /** Make a fork of the active session. It becomes the active session. */
  fork(): Promise<void>;
  /** "Undo the turn" of the active session. */
  undoTurn(turn: number): Promise<void>;
  /** Answer a question of the agent of the active session. */
  answerQuestion(question: string, answer: string): Promise<void>;
  /** Answer an approval card of the active session. */
  answer(approval: string, decision: ApprovalDecision, steps?: readonly string[]): Promise<void>;
  /** Restore the checkpoint of a turn of the active session. */
  restore(turn: number): Promise<void>;
  /** The files that the turns from `turn` and after wrote (the files of a restore). */
  filesSince(turn: number): Promise<string[]>;
  patch(patch: AgentPatch): Promise<void>;
  /** Start the events and read the list. The returned function stops the events. */
  start(): () => void;
}

/** The switch of the window for a mode. */
export function switchOf(mode: AgentMode): ProposalMode {
  return mode === "auto" ? "apply" : "propose";
}

/** The translate function of the export. */
export type ExportTranslate = (id: string, args?: Record<string, string | number>) => string;

/** The transcript of a session as Markdown (the export of the ⋯ menu). */
export function exportText(session: AgentSessionView, translate: ExportTranslate): string {
  const { mode, model, effort } = session;
  const lines = [`# ${session.name}`, "", translate("agent-export-options", { mode, model, effort }), ""];
  for (const item of session.items) {
    if (item.kind === "prompt") lines.push(`**${translate("agent-you")}** ${item.text}`, "");
    else if (item.kind === "text") lines.push(item.text, "");
    else if (item.kind === "error") lines.push(`> ${item.text}`, "");
    else if (item.kind === "tool") {
      lines.push(`\`${item.name}\` ${JSON.stringify(item.input)}`, "", "```", item.result ?? "", "```", "");
    } else if (item.kind === "end") {
      if (item.reason !== "done") lines.push(`_${translate(`agent-end-${item.reason}`)}_`, "");
    } else if (item.kind === "approval") lines.push(`> ${item.title}: ${item.decision ?? "…"}`, "");
    else if (item.kind === "plan") lines.push(`**${item.title}**`, ...item.steps.map((step) => `- ${step.text}`), "");
    else if (item.kind === "question") lines.push(`> ${item.text} ${item.answer ?? "…"}`, "");
    else
      lines.push(
        `_${translate("agent-turn-undone", { turn: item.turn, files: item.files.length, steps: item.steps })}_`,
        "",
      );
  }
  return lines.join("\n");
}

/** The items with one item added, or changed in place (the same ID). */
function withItem(items: readonly AgentItem[], item: AgentItem): AgentItem[] {
  const at = items.findIndex((old) => old.id === item.id);
  if (at < 0) return [...items, item];
  return items.map((old, index) => (index === at ? item : old));
}

/** The sessions after an event. */
export function applyEvent(sessions: readonly AgentSessionView[], event: AgentEvent): AgentSessionView[] {
  if (event.type === "agent.connections" || event.type === "agent.task") return [...sessions];
  if (event.type === "agent.closed") return sessions.filter((session) => session.id !== event.session);
  if (event.type === "agent.item") {
    return sessions.map((session) =>
      session.id === event.session ? { ...session, items: withItem(session.items, event.item) } : session,
    );
  }
  const known = sessions.some((session) => session.id === event.session.id);
  if (!known) return [...sessions, { ...event.session, items: [] }];
  return sessions.map((session) => (session.id === event.session.id ? { ...session, ...event.session } : session));
}

/** The tasks after a change of one task (a new task goes first). */
export function withTask(tasks: readonly AgentTaskInfo[], task: AgentTaskInfo): AgentTaskInfo[] {
  return tasks.some((item) => item.id === task.id)
    ? tasks.map((item) => (item.id === task.id ? task : item))
    : [task, ...tasks];
}

/** The error text of a failed request. */
function failureText(failure: unknown): string {
  return failure instanceof Error ? failure.message : String(failure);
}

/** The state of the store and its base actions. */
function storeCore(parts: AgentStoreParts) {
  const sessions = shallowRef<readonly AgentSessionView[]>([]);
  const active = shallowRef<string | null>(null);
  const choices = shallowRef<AgentChoices | null>(null);
  const error = shallowRef<string | null>(null);
  const draft = shallowRef("");
  const recipes = shallowRef<readonly RecipeInfo[]>([]);
  const connections = shallowRef<readonly ConnectionView[]>([]);
  const tasks = shallowRef<readonly AgentTaskInfo[]>([]);
  const chips = createChipState(parts.context ?? null, () => active.value);
  const current = (): AgentSessionView | null => sessions.value.find((item) => item.id === active.value) ?? null;
  const guard = async <T>(work: () => Promise<T>): Promise<T | null> => {
    try {
      const value = await work();
      error.value = null;
      return value;
    } catch (failure) {
      error.value = failureText(failure);
      return null;
    }
  };
  const select = (id: string): void => {
    active.value = id;
    const session = current();
    if (session !== null) parts.setSwitch(switchOf(session.mode));
  };
  const load = async (): Promise<void> => {
    const requests = await guard(() => parts.client.connections());
    if (requests !== null) connections.value = requests.connections;
    const known = await guard(() => parts.client.tasks(parts.project));
    if (known !== null) tasks.value = known.tasks;
    const listing = await guard(() => parts.client.list(parts.project));
    if (listing === null) return;
    const { sessions: list, ...rest } = listing;
    choices.value = rest;
    // Keep a session that the panel made after the host sent the list (its events keep it).
    const listed = new Set(list.map((item) => item.id));
    sessions.value = [...list, ...sessions.value.filter((item) => !listed.has(item.id))];
    if (current() === null && list.length > 0) select(list.at(-1)?.id ?? "");
  };
  /** The creation of a session in progress. A prompt that comes during the creation goes to the new session. */
  let creating: Promise<void> | null = null;
  const create = (patch: AgentPatch = {}): Promise<void> => {
    creating = (async () => {
      const made = await guard(() => parts.client.create(parts.project, patch));
      if (made === null) return;
      if (!sessions.value.some((item) => item.id === made.id)) sessions.value = [...sessions.value, made];
      select(made.id);
    })();
    return creating;
  };
  const settled = async (): Promise<void> => {
    await creating;
  };
  const context = parts.context ?? null;
  return {
    sessions,
    active,
    choices,
    error,
    draft,
    chips,
    recipes,
    connections,
    tasks,
    runRecipe: (): void => undefined,
    context,
    current,
    guard,
    select,
    load,
    create,
    settled,
  };
}

/** The actions of the turns of the active session. */
function turnActions(
  parts: AgentStoreParts,
  core: Pick<ReturnType<typeof storeCore>, "active" | "guard">,
): Pick<AgentStore, "undoTurn" | "answer" | "answerQuestion" | "restore" | "filesSince" | "answerConnection"> {
  const { active, guard } = core;
  return {
    answerConnection: async (id, allow) => {
      await guard(() => (allow ? parts.client.allowConnection(id, parts.project) : parts.client.denyConnection(id)));
    },
    undoTurn: async (turn) => {
      const id = active.value;
      if (id !== null) await guard(() => parts.client.undoTurn(id, turn));
    },
    answerQuestion: async (question, answer) => {
      const id = active.value;
      if (id !== null) await guard(() => parts.client.answerQuestion(id, question, answer));
    },
    answer: async (approval, decision, steps) => {
      const id = active.value;
      if (id !== null) await guard(() => parts.client.answer(id, approval, decision, steps));
    },
    restore: async (turn) => {
      const id = active.value;
      if (id !== null) await guard(() => parts.client.restore(id, turn));
    },
    filesSince: async (turn) => {
      const id = active.value;
      const answer = id === null ? null : await guard(() => parts.client.turns(id));
      const files = (answer?.turns ?? []).filter((item) => item.turn >= turn).flatMap((item) => item.files);
      return [...new Set(files)].sort();
    },
  };
}

/** A new background task and the stop of a task. */
function taskActions(parts: AgentStoreParts, core: ReturnType<typeof storeCore>) {
  const { guard, tasks } = core;
  return {
    startTask: async (request: TaskRequest): Promise<AgentTaskInfo | null> => {
      const started = await guard(() => parts.client.startTask(parts.project, request));
      if (started === null) return null;
      // A group answers with all its tasks.
      const list = "tasks" in started ? started.tasks : [started];
      for (const task of list) tasks.value = withTask(tasks.value, task);
      return list[0] ?? null;
    },
    stopTask: async (id: string): Promise<void> => {
      const task = await guard(() => parts.client.stopTask(id));
      if (task !== null) tasks.value = withTask(tasks.value, task);
    },
  };
}

/** Make the store of the panel. */
export function createAgentStore(parts: AgentStoreParts): AgentStore {
  const core = storeCore(parts);
  const { sessions, active, draft, chips, current, guard, select, create } = core;
  const send = async (text: string): Promise<boolean> => {
    if (text.trim() === "") return false;
    await core.settled();
    // A prompt with no session makes one first.
    if (current() === null) await create();
    const id = active.value;
    if (id === null) return false;
    // The chips that the person sees go with the prompt, and only these chips.
    const context = chips.list().map(({ kind, label, text: line, picture }) => ({
      kind,
      label,
      text: line,
      ...(picture === undefined ? {} : { picture }),
    }));
    const sent = (await guard(() => parts.client.prompt(id, text, context))) !== null;
    if (sent) chips.clear();
    return sent;
  };
  return {
    ...core,
    ...turnActions(parts, core),
    send,
    ...taskActions(parts, core),
    sendInline: async (text, chips, subject) => {
      await core.settled();
      if (current() === null) await create({ name: subject });
      const id = active.value;
      if (id === null || text.trim() === "") return false;
      const context = chips.map(({ kind, label, text: line }) => ({ kind, label, text: line }));
      return (await guard(() => parts.client.prompt(id, text, context))) !== null;
    },
    submit: async () => {
      const text = draft.value;
      draft.value = "";
      if (!(await send(text)) && draft.value === "") draft.value = text;
    },
    stop: async () => {
      const id = active.value;
      if (id !== null) await guard(() => parts.client.stop(id));
    },
    fork: async () => {
      const id = active.value;
      const made = id === null ? null : await guard(() => parts.client.fork(id));
      if (made === null) return;
      sessions.value = [...sessions.value.filter((item) => item.id !== made.id), made];
      select(made.id);
    },
    close: async (id) => {
      await guard(() => parts.client.close(id));
      sessions.value = sessions.value.filter((item) => item.id !== id);
      if (active.value !== id) return;
      active.value = null;
      const last = sessions.value.at(-1);
      if (last !== undefined) select(last.id);
    },
    patch: async (patch) => {
      const id = active.value;
      if (id === null) return;
      const info = await guard(() => parts.client.update(id, patch));
      if (info === null) return;
      sessions.value = applyEvent(sessions.value, { type: "agent.session", session: info });
      if (patch.mode !== undefined) parts.setSwitch(switchOf(patch.mode));
    },
    start: () =>
      parts.client.events(
        (event) => onEvent(parts.project, core, event),
        () => void core.load(),
      ),
  };
}

/** Keep the state after an event of the host. */
function onEvent(project: string, core: ReturnType<typeof storeCore>, event: AgentEvent): void {
  if (event.type === "agent.connections") {
    core.connections.value = event.connections;
    return;
  }
  if (event.type === "agent.task") {
    if (event.task.project === project) core.tasks.value = withTask(core.tasks.value, event.task);
    return;
  }
  if (event.type === "agent.session" && event.session.project !== project) return;
  core.sessions.value = applyEvent(core.sessions.value, event);
  if (event.type === "agent.closed" && core.active.value === event.session) core.active.value = null;
}
