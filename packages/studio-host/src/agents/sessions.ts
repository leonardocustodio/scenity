// SPDX-License-Identifier: Apache-2.0
/**
 * The agent sessions of the studio host. A session belongs to a project and has a name, a colour, a mode, a model, an
 * effort, a cost and a transcript. A prompt starts a turn. A prompt during a turn waits in a queue. Stop ends the turn
 * and clears the queue. The driver (driver.ts) runs the turn. The tools go to the newest editor window of the project
 * over the page bridge (bridgeHub.ts).
 *
 * The mode applies at each tool call. Ask refuses the edit tools. Review sends each edit as a proposal. Auto lets the
 * switch of the window decide (the agent panel sets the switch to "apply" for an Auto session). Each action goes
 * through the gate of its kind (gate.ts): allowed, denied, or an approval card for the person. A role limits the
 * modes. An Auto session needs a budget, and a session stops at its budget.
 */
import {
  callTyped,
  jobOutput,
  jobRunFor,
  jobStatus,
  STUDIO_TOOLS,
  listingsOf,
  type ToolDef,
  type ToolListing,
  type ToolResult,
} from "@scenity/agent-tools";
import type { BridgeHub } from "../bridgeHub";
import type { JobService } from "../jobs";
import { AGENT_JOBS } from "./jobPort";
import { chipLines, type AgentChip } from "./context";
import type { AgentDriver, TurnInput } from "./driver";
import { Approvals, type ApprovalDecision } from "./approvals";
import { sessionPermit, type GateOutcome, type GateRequest } from "./gate";
import { HOST_TOOLS, runHostTool, type HostToolParts } from "./hostTools";
import { Questions } from "./questions";
import { Connections } from "./external";
import { instructionsText, readInstructions } from "./instructions";
import {
  budgetText,
  minutesText,
  nextLimits,
  overBudget,
  turnRefusal,
  type LimitsPatch,
  type UsageLedger,
} from "./limits";
import { projectKindValues, roleAllows, type AgentRole, type KindValues } from "./permissions";
import { PictureStore } from "./pictures";
import { runToolCall } from "./toolCalls";
import { newSession, newSessionInfo, sessionContext, sessionPort, type Session } from "./session";
import { AgentTasks } from "./tasks";
import { revertTurn, turnFiles, TurnRecords, type TurnRecordView } from "./turns";
import { TURN_CHECKPOINT_CALL } from "@scenity/bridge";
import {
  AGENT_COLOURS,
  type AgentEffort,
  type AgentEvent,
  type AgentItem,
  type AgentMode,
  type AgentSessionInfo,
  type AgentSessionView,
} from "./protocol";

/** The pause of an external agent that ends its turn (ms). */
export const EXTERNAL_PAUSE_MS = 60_000;
/** The wait for the checkpoint of a window at the start of a turn (ms). */
const CHECKPOINT_TIMEOUT_MS = 5000;

export interface AgentSessionsOptions {
  readonly driver: AgentDriver;
  readonly hub: BridgeHub;
  /** The folder of a project (for a session of a task: the worktree of its task), or null. */
  dirOf(project: string, session?: string): string | null;
  emit(event: AgentEvent): void;
  readonly tools?: readonly ToolDef[];
  /** The tools of the host faces of the plugins of a project. They come after the core tools. */
  pluginTools?(project: string): readonly ToolDef[];
  /** The jobs of the studio (the job tools). Absent: no job tool. */
  readonly jobs?: JobService;
  /** The agent preferences of the person (the values per kind, the default budget). */
  preferences?(): { readonly kinds?: KindValues; readonly budgetUsd?: number };
  /** The role of the person (default: admin, the owner of the studio). */
  readonly role?: AgentRole;
  /** The ledger of the use of each day. */
  readonly ledger?: UsageLedger;
  /** The record file of the background tasks, and the length of a minute of their time limit (ms). */
  readonly tasksFile?: string | null;
  readonly taskMinuteMs?: number;
}

/** The changes of a session that a person can make. */
export interface AgentSessionPatch extends LimitsPatch {
  readonly name?: string;
  readonly mode?: AgentMode;
  readonly model?: string;
  readonly effort?: AgentEffort;
  /** Each turn needs an approved plan before an edit. */
  readonly planFirst?: boolean;
  /** The session of an external agent. */
  readonly external?: boolean;
  /** The background task of the session. */
  readonly task?: string;
}

/** The sessions of the host. */
export class AgentSessions {
  readonly #options: AgentSessionsOptions;
  readonly #sessions = new Map<string, Session>();
  readonly #tools: (project: string) => readonly ToolDef[];
  /** The pictures of the tool results. */
  readonly pictures = new PictureStore();
  /** The turn records (the file snapshots, the tools, the cost). */
  readonly turns = new TurnRecords();
  /** The approval cards that wait. */
  readonly approvals = new Approvals();
  /** The connection requests of the external agents. */
  readonly connections = new Connections();
  /** The questions of the agents that wait. */
  readonly questions = new Questions();
  /** The background tasks. They watch the events of the sessions. */
  readonly tasks: AgentTasks;
  /** The steps of the edits of plans by approval. */
  readonly #planEdits = new Map<string, readonly string[]>();
  #count = 0;

  constructor(options: AgentSessionsOptions) {
    // The tasks watch the events of the sessions.
    const emit = (event: AgentEvent): void => {
      options.emit(event);
      this.tasks.observe(event);
    };
    this.#options = { ...options, emit, dirOf: (project, session) => this.tasks.folderOf(project, session) };
    this.tasks = new AgentTasks({
      ...{ sessions: this, file: options.tasksFile ?? null, minuteMs: options.taskMinuteMs },
      ...{ dirOf: (project) => options.dirOf(project), emit: (event) => options.emit(event) },
      port: (project) => sessionPort(options.hub, project),
    });
    const run = options.jobs === undefined ? null : jobRunFor(AGENT_JOBS);
    const jobTools = run === null ? [] : [run, jobStatus, jobOutput];
    const base = options.tools ?? [...STUDIO_TOOLS, ...jobTools];
    this.#tools = (project) => [...base, ...(options.pluginTools?.(project) ?? [])];
  }

  /** The cost and the tokens of the day. */
  today(): { readonly costUsd: number; readonly tokens: number } {
    return this.#options.ledger?.today() ?? { costUsd: 0, tokens: 0 };
  }

  /** The name of the driver. */
  get driver(): string {
    return this.#options.driver.name;
  }

  /** The sessions (of a project), the oldest first. */
  list(project?: string): AgentSessionView[] {
    return [...this.#sessions.values()]
      .filter((session) => project === undefined || session.info.project === project)
      .map((session) => ({ ...session.info, items: [...session.items] }));
  }

  /** A new session of a project. */
  create(project: string, patch: AgentSessionPatch = {}): AgentSessionView {
    this.#count += 1;
    const used = new Set(this.list(project).map((session) => session.colour));
    const colour = AGENT_COLOURS.find((item) => !used.has(item)) ?? AGENT_COLOURS[this.#count % AGENT_COLOURS.length];
    const id = `s${String(this.#count)}-${Date.now().toString(36)}`;
    const name = patch.name ?? `Session ${String(this.list(project).length + 1)}`;
    const session = newSession(newSessionInfo(id, project, name, colour ?? "agent-1", patch), (where, message) =>
      this.#options.hub.tell(where, { ...message }),
    );
    const { info } = session;
    this.#sessions.set(info.id, session);
    if (info.mode !== "review") this.update(info.id, { mode: info.mode });
    this.#options.emit({ type: "agent.session", session: info });
    return { ...info, items: [] };
  }

  /**
   * Change the name, the mode, the model, the effort or the budget of a session. The role limits the modes. Auto
   * needs a budget (the budget of the patch, of the session, or the default of the preferences).
   */
  update(id: string, patch: AgentSessionPatch): AgentSessionInfo {
    const session = this.#get(id);
    const name = patch.name?.trim();
    if (patch.mode !== undefined && !roleAllows(this.#options.role ?? "admin", patch.mode)) {
      throw new Error(`The role ${this.#options.role ?? "admin"} cannot choose the ${patch.mode} mode.`);
    }
    const auto = (patch.mode ?? session.info.mode) === "auto";
    const limits = nextLimits(session.info, patch, auto, this.#options.preferences?.().budgetUsd);
    this.#set(session, {
      ...(name === undefined || name === "" ? {} : { name }),
      ...(patch.mode === undefined ? {} : { mode: patch.mode }),
      ...(patch.model === undefined ? {} : { model: patch.model }),
      ...(patch.effort === undefined ? {} : { effort: patch.effort }),
      ...limits,
      ...(patch.planFirst === undefined ? {} : { planFirst: patch.planFirst }),
    });
    return session.info;
  }

  /** The answer of the person to an approval card, with the steps of an edit of a plan. */
  answer(id: string, approval: string, decision: ApprovalDecision, steps?: readonly string[]): void {
    this.#get(id);
    if (steps !== undefined) this.#planEdits.set(approval, steps);
    if (!this.approvals.answer(id, approval, decision)) throw new Error(`No approval ${approval} waits.`);
  }

  /** The answer of the person to a question of the agent. */
  answerQuestion(id: string, question: string, text: string): void {
    this.#get(id);
    if (!this.questions.answer(id, question, text)) throw new Error(`No question ${question} waits.`);
  }

  /** A fork of a session: a new session with a copy of its transcript and options. Its next turn continues it. */
  fork(id: string): AgentSessionView {
    const source = this.#get(id);
    const { mode, model, effort } = source.info;
    const made = this.create(source.info.project, { name: `${source.info.name} (fork)`, mode, model, effort });
    const session = this.#get(made.id);
    for (const item of source.items) this.#item(session, item);
    session.nextItem = source.nextItem;
    session.turn = source.turn;
    this.turns.copy(id, made.id);
    this.#options.driver.fork?.(id, made.id);
    return { ...session.info, items: [...session.items] };
  }

  /** Send a prompt with its chips. It starts a turn, or it waits in the queue during a turn. */
  prompt(id: string, text: string, context: readonly AgentChip[] = []): { queued: number } {
    const session = this.#get(id);
    if (text.trim() === "") throw new Error("The prompt is empty.");
    if (session.info.external) throw new Error("The session of an external agent takes no prompt.");
    const refusal = turnRefusal(session.info, session.turn + 1);
    if (refusal !== null) throw new Error(refusal);
    session.queue.push({ text, context });
    this.#set(session, { queued: session.queue.length });
    void this.#pump(session);
    return { queued: session.info.running ? session.queue.length : 0 };
  }

  /** Stop the turn and clear the queue. */
  stop(id: string): void {
    const session = this.#get(id);
    session.queue.length = 0;
    session.abort?.abort();
    this.approvals.denyAll(id);
    this.questions.endAll(id);
    // The turn of an external agent ends immediately.
    if (session.idle !== null) {
      clearTimeout(session.idle);
      session.idle = null;
      if (session.info.running) this.#end(session, "stopped");
    }
    this.#set(session, { queued: 0 });
  }

  /** Close a session: its turn stops, and the host deletes the session. */
  close(id: string): void {
    this.stop(id);
    this.#sessions.delete(id);
    this.#options.driver.close?.(id);
    this.turns.close(id);
    this.#options.emit({ type: "agent.closed", session: id });
  }

  /** Stop every turn (the host stops). */
  stopAll(): void {
    for (const id of this.#sessions.keys()) this.stop(id);
  }

  #get(id: string): Session {
    const session = this.#sessions.get(id);
    if (session === undefined) throw new Error(`No agent session ${id}.`);
    return session;
  }

  #set(session: Session, patch: Partial<AgentSessionInfo>): void {
    session.info = { ...session.info, ...patch };
    this.#options.emit({ type: "agent.session", session: session.info });
  }

  /** Add an item, or change the item with the same ID. */
  #item(session: Session, item: AgentItem): void {
    const at = session.items.findIndex((old) => old.id === item.id);
    if (at < 0) session.items.push(item);
    else session.items[at] = item;
    this.#options.emit({ type: "agent.item", session: session.info.id, item });
  }

  /** Run the turns of the queue, one at a time. */
  async #pump(session: Session): Promise<void> {
    if (session.info.running) return;
    const next = session.queue.shift();
    if (next === undefined) return;
    const { text: prompt, context } = next;
    const abort = await this.#begin(session, prompt, context);
    const id = session.info.id;
    let reason: "done" | "stopped" | "error" = "done";
    // A turn stops at the minutes of the session.
    const minutes = session.info.maxMinutes;
    const timer =
      minutes === null
        ? null
        : setTimeout(() => {
            this.#item(session, { id: session.nextItem++, kind: "error", text: minutesText(minutes) });
            this.stop(id);
          }, minutes * 60_000);
    try {
      await this.#options.driver.turn(this.#turnInput(session, prompt, context, abort.signal));
      if (abort.signal.aborted) reason = "stopped";
    } catch (error) {
      reason = abort.signal.aborted ? "stopped" : "error";
      if (reason === "error") {
        const text = error instanceof Error ? error.message : String(error);
        this.#item(session, { id: session.nextItem++, kind: "error", text });
      }
    }
    if (timer !== null) clearTimeout(timer);
    this.#end(session, reason);
    if (this.#sessions.has(id)) await this.#pump(session);
  }

  /** Begin a turn: its record, its presence, its prompt item and the checkpoint of the window. */
  async #begin(session: Session, prompt: string, context: readonly AgentChip[]): Promise<AbortController> {
    const abort = new AbortController();
    session.abort = abort;
    session.turn += 1;
    session.plan = null;
    session.presence.begin();
    const { turn } = session;
    const { id, project } = session.info;
    this.turns.begin(id, turn, prompt);
    this.#set(session, { running: true, queued: session.queue.length });
    const at = Date.now();
    this.#item(session, {
      id: session.nextItem++,
      kind: "prompt",
      text: prompt,
      context: chipLines(context),
      turn,
      at,
    });
    // No window: the files keep their records.
    const port = sessionPort(this.#options.hub, project);
    await callTyped(port, TURN_CHECKPOINT_CALL, [id, turn], CHECKPOINT_TIMEOUT_MS).catch(() => false);
    return abort;
  }

  /** End a turn: its record, its presence and its end item. */
  #end(session: Session, reason: "done" | "stopped" | "error"): void {
    session.abort = null;
    this.turns.end(session.info.id, session.turn);
    session.presence.end();
    this.#item(session, { id: session.nextItem++, kind: "end", reason, turn: session.turn });
    if (this.#sessions.has(session.info.id)) this.#set(session, { running: false });
  }

  /**
   * A tool call of an external agent (an MCP client of the studio). The first call after a pause begins a
   * turn of its session. The turn ends after `EXTERNAL_PAUSE_MS` with no call.
   */
  async external(id: string, name: string, input: unknown): Promise<ToolResult> {
    const session = this.#get(id);
    if (!session.info.running) await this.#begin(session, `${session.info.name}: tool calls`, []);
    if (session.idle !== null) clearTimeout(session.idle);
    session.idle = setTimeout(() => {
      session.idle = null;
      if (session.info.running) this.#end(session, "done");
    }, EXTERNAL_PAUSE_MS);
    return this.#runTool(session, name, input);
  }

  /** Tell the windows and the Hub the current connection requests. */
  connectionsChanged(): void {
    this.#options.emit({ type: "agent.connections", connections: this.connections.list() });
  }

  /** The listings of the tools of an external agent. */
  externalTools(): ToolListing[] {
    return listingsOf([...this.#tools(""), ...HOST_TOOLS]);
  }

  /** The input of a turn of the driver. */
  #turnInput(session: Session, prompt: string, context: readonly AgentChip[], signal: AbortSignal): TurnInput {
    const { id } = session.info;
    const { turn } = session;
    const dir = this.#options.dirOf(session.info.project, session.info.id);
    return {
      prompt,
      context,
      // The instructions of the project, read at the start of each turn.
      instructions: dir === null ? "" : instructionsText(readInstructions(dir)),
      session: session.info,
      dir,
      signal,
      tools: {
        listings: listingsOf([...this.#tools(session.info.project), ...HOST_TOOLS]),
        run: (name, input) => this.#runTool(session, name, input),
      },
      say: (text) => this.#item(session, { id: session.nextItem++, kind: "text", text }),
      usage: (costUsd, contextShare, tokens = 0) => {
        this.turns.cost(id, turn, costUsd);
        this.#options.ledger?.add(costUsd, tokens);
        this.#set(session, {
          costUsd: session.info.costUsd + costUsd,
          tokens: session.info.tokens + tokens,
          contextShare,
        });
        // The session stops at its budget and gives the cause.
        if (overBudget(session.info) && session.abort !== null && !session.abort.signal.aborted) {
          this.#item(session, { id: session.nextItem++, kind: "error", text: budgetText(session.info) });
          this.stop(id);
        }
      },
      permit: (request) => this.#permit(session, request),
      files: turnFiles(this.turns, { session: id, turn, dir }, (request) => this.#permit(session, request)),
    };
  }

  /** The turn records of a session. */
  turnRecords(id: string): TurnRecordView[] {
    this.#get(id);
    return this.turns.list(id);
  }

  /**
   * "Undo the turn": the host restores the files of the turn, and the newest editor window of the project reverts the
   * document part (one new step). A restore puts back the files and the scene of the checkpoint of the turn.
   * The transcript gets an `undone` item.
   */
  async undoTurn(id: string, turn: number, restore = false): Promise<Extract<AgentItem, { kind: "undone" }>> {
    const session = this.#get(id);
    const dir = this.#options.dirOf(session.info.project, session.info.id);
    if (dir === null) throw new Error("The session has no project folder.");
    if (session.info.running) throw new Error("A turn runs; stop it first.");
    const port = sessionPort(this.#options.hub, session.info.project);
    const back = await revertTurn(this.turns, { session: id, turn, dir, restore }, (call) =>
      callTyped(port, call, [id, turn]),
    );
    const item = { id: session.nextItem++, kind: "undone" as const, ...back };
    this.#item(session, item);
    return item;
  }

  /** The gate of an action of a session (an "ask" puts an approval card in the transcript and waits). */
  #permit(session: Session, request: GateRequest): Promise<GateOutcome> {
    return sessionPermit(
      {
        info: session.info,
        allowed: this.tasks.allowedOf(session.info.id, session.allowed),
        plan: session.plan?.plan.decision ?? null,
        values: [
          this.#options.preferences?.().kinds ?? {},
          projectKindValues(this.#options.dirOf(session.info.project, session.info.id)),
        ],
        nextId: () => session.nextItem++,
        item: (item) => this.#item(session, item),
        waiting: (on) => this.#set(session, { waiting: on }),
      },
      this.approvals,
      request,
    );
  }

  /** What the host tools (the plans, the questions) read of a session. */
  #hostParts(session: Session): HostToolParts {
    return {
      session: session.info.id,
      approvals: this.approvals,
      questions: this.questions,
      dir: this.#options.dirOf(session.info.project, session.info.id),
      plan: () => session.plan,
      setPlan: (next) => {
        session.plan = next;
      },
      nextId: () => session.nextItem++,
      item: (item) => this.#item(session, item),
      waiting: (on) => this.#set(session, { waiting: on }),
      edited: (approval) => this.#planEdits.get(approval) ?? null,
    };
  }

  /** Run a tool for a turn with the rules of the mode, and record it in the transcript. */
  async #runTool(session: Session, name: string, input: unknown): Promise<ToolResult> {
    return runToolCall(
      {
        session: { id: session.info.id, mode: session.info.mode, turn: session.turn },
        tools: this.#tools(session.info.project),
        pictures: this.pictures,
        turns: this.turns,
        nextId: () => session.nextItem++,
        item: (item) => this.#item(session, item),
        permit: (request) => this.#permit(session, request),
        context: () => sessionContext(session, this.#options),
        present: (call, callInput, pictures) => session.presence.call(call, callInput, pictures),
        host: (hostName, hostInput) => runHostTool(this.#hostParts(session), hostName, hostInput),
      },
      name,
      input,
    );
  }
}
