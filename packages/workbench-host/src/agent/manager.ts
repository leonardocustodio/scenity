// SPDX-License-Identifier: Apache-2.0
/**
 * The chat sessions of the host: start, resume and fork, the routes of the `agent.*` requests, the SDK session ID per
 * checkout (the state folder) and the notification of an open approval. The SDK runs in the host process. A test
 * gives a fake `AgentSdk`.
 *
 * Every session gets the same parts as the terminal mode: the in-process MCP server over `workbenchTools()`
 * (mcpServer.ts) and the hook callbacks over `handleHook` (sdkHooks.ts), with the tool context and the hook
 * dependencies of the host.
 *
 * The host keeps the last options of each SDK session (keptOptions.ts). A resume or a fork uses them unless the
 * request gives others. A session without kept options gets the defaults of the start form (`formDefaults`).
 */
import type {
  AgentAsk,
  AgentCredential,
  AgentLive,
  AgentSessionEntry,
  AgentSessionInfo,
  AgentStartParams,
} from "../agentProtocol";
import { formDefaults, isAgentCredential, isAgentEffort, isAgentMode } from "../agentProtocol";
import type { HookDeps } from "../hooks";
import type { AgentMode, HostEvent } from "../protocol";
import { REMOTE_BYPASS_REFUSED } from "../remote";
import type { HostState } from "../state";
import { workbenchTools, type ToolContext, type ToolDef } from "../tools/index";
import { createWorkbenchServer } from "./mcpServer";
import { join } from "node:path";
import { ENV_FILE, resolveCredential, withCredential, type ResolvedCredential } from "./credential";
import { keptParams, mergeParams, OptionsStore } from "./keptOptions";
import { agentEnv, sessionOptions } from "./options";
import { realSdk, type AgentSdk } from "./sdk";
import { sdkHooks } from "./sdkHooks";
import type { PictureSink } from "./messages";
import { AgentSession } from "./session";
import { CostStore, listCheckoutSessions } from "./sessionsList";

export interface AgentManagerDeps {
  /** The current open checkout. A new session runs in it. */
  checkout(): string;
  readonly state: HostState;
  emit(event: HostEvent): void;
  /** The hook dependencies of the host (the same object as for `POST /hooks/<event>`). */
  hooks(): HookDeps;
  /** The tool context of the open checkout (the same function as for `POST /tools/<name>`). */
  toolContext(): ToolContext;
  /** The environment of the host. The default is `process.env`. */
  readonly env?: Readonly<Record<string, string | undefined>>;
  /** The origin of the host, for the environment of a session. */
  readonly origin?: string | null;
  readonly sdk?: AgentSdk;
  readonly tools?: readonly ToolDef[];
  /** The picture store of the host. The images of the messages go there. */
  readonly pictures?: PictureSink;
  /** Refuse the mode "all" (`bypassPermissions`) at a start, a resume and a mode change (the remote mode). */
  readonly refuseBypass?: boolean;
  /** The absolute path of the credential file of the project (default: `.env` of the checkout). */
  readonly credentialFile?: () => string;
}

const MODE_ERROR = 'The parameter "mode" must be default, acceptEdits or bypassPermissions.';

/** Check the parameters of a start. The mode is necessary. */
export function startParams(params: object): AgentStartParams {
  const value = params as Record<string, unknown>;
  if (!isAgentMode(value.mode)) throw new Error(MODE_ERROR);
  return { ...optionalParams(value), mode: value.mode };
}

/** Check the parameters of a resume. Each one is optional. The kept options give the others. */
export function resumeOverrides(params: object): Partial<AgentStartParams> {
  const value = params as Record<string, unknown>;
  if (value.mode === undefined || value.mode === null) return optionalParams(value);
  if (!isAgentMode(value.mode)) throw new Error(MODE_ERROR);
  return { ...optionalParams(value), mode: value.mode };
}

function optionalParams(value: Record<string, unknown>): Partial<AgentStartParams> {
  const out: { -readonly [K in keyof AgentStartParams]?: AgentStartParams[K] } = {};
  if (value.credential !== undefined && value.credential !== null) {
    if (!isAgentCredential(value.credential))
      throw new Error('The parameter "credential" must be subscription or api-key.');
    out.credential = value.credential;
  }
  if (value.model !== undefined && value.model !== null) {
    if (typeof value.model !== "string" || value.model === "") throw new Error('The parameter "model" must be a text.');
    out.model = value.model;
  }
  if (value.effort !== undefined && value.effort !== null) {
    if (!isAgentEffort(value.effort)) throw new Error('The parameter "effort" is not an effort level.');
    out.effort = value.effort;
  }
  for (const name of ["maxBudgetUsd", "maxTurns"] as const) {
    const limit = value[name];
    if (limit === undefined || limit === null) continue;
    if (typeof limit !== "number" || !Number.isFinite(limit) || limit <= 0) {
      throw new Error(`The parameter "${name}" must be a number above 0.`);
    }
    out[name] = name === "maxTurns" ? Math.round(limit) : limit;
  }
  return out;
}

/** The notice of an open approval or question (the `agent.notify` event of the page). */
export function askNotice(ask: AgentAsk): HostEvent {
  const question = ask.kind === "question";
  return {
    type: "agent.notify",
    session: ask.session,
    kind: question ? "question" : "permission_prompt",
    title: question ? "Claude asks a question" : "Claude waits for an approval",
    message: ask.title ?? (question ? "Open the chat to answer." : `${ask.tool}: open the chat to allow or deny.`),
  };
}

export class AgentManager {
  readonly #deps: AgentManagerDeps;
  readonly #sdk: AgentSdk;
  readonly #costs: CostStore;
  readonly #options: OptionsStore;
  readonly #sessions = new Map<string, AgentSession>();
  #next = 1;

  constructor(deps: AgentManagerDeps) {
    this.#deps = deps;
    this.#sdk = deps.sdk ?? realSdk;
    this.#costs = new CostStore(deps.state.dir);
    this.#options = new OptionsStore(deps.state.dir);
  }

  /**
   * Start a new session in the open checkout on the credential of the parameters (default: the subscription). An
   * `api-key` session without a usable key throws with the reason.
   */
  start(params: AgentStartParams): { session: string; info: AgentSessionInfo } {
    this.#checkMode(params.mode);
    return this.#open(params, {}, this.#credential(params));
  }

  /** The mode that a resume with these overrides gets (the role check of agent/routes.ts). */
  resumeMode(overrides: Partial<AgentStartParams>, sessionId: string): AgentMode {
    return mergeParams(this.resumeOptions(sessionId).options, overrides).mode;
  }

  /**
   * Resume an SDK session of the open checkout, or fork it first (a second try). Each option that `overrides` does not
   * give comes from the kept options of the session, else from the defaults of the start form.
   */
  async resume(
    overrides: Partial<AgentStartParams>,
    sessionId: string,
    fork: boolean,
  ): Promise<{ session: string; info: AgentSessionInfo }> {
    const params = mergeParams(this.resumeOptions(sessionId).options, overrides);
    this.#checkMode(params.mode);
    const credential = this.#credential(params);
    const checkout = this.#deps.checkout();
    const found = await this.#sdk.getSessionInfo(sessionId, { dir: checkout });
    if (found === undefined) throw new Error(`No session ${sessionId} in the checkout ${checkout}.`);
    for (const [id, session] of this.#sessions) {
      if (session.info().sdkSessionId === sessionId && !fork) await this.close(id);
    }
    const target = fork ? (await this.#sdk.forkSession(sessionId, { dir: checkout })).sessionId : sessionId;
    return this.#open(params, { resume: target, forkOf: fork ? sessionId : null }, credential);
  }

  /** The credential choice of the open checkout: the last one that the owner picked, else the subscription. */
  credential(): AgentCredential {
    return this.#deps.state.chatCredential(this.#deps.checkout()) ?? "subscription";
  }

  /** The options of a resume of an SDK session: the kept options, else the defaults of the start form. */
  resumeOptions(sessionId: string): { options: AgentStartParams; kept: boolean } {
    const defaults = formDefaults(this.credential());
    const kept = this.#options.get(sessionId);
    return kept === null ? { options: defaults, kept: false } : { options: mergeParams(defaults, kept), kept: true };
  }

  /** Change the permission mode of a session. The remote mode refuses the mode "all". */
  async setMode(id: string, mode: AgentMode): Promise<void> {
    const session = this.get(id);
    this.#checkMode(mode);
    await session.setMode(mode);
  }

  /** The session of a host ID, or an error. */
  get(id: string): AgentSession {
    const session = this.#sessions.get(id);
    if (session === undefined) throw new Error(`No chat session "${id}".`);
    return session;
  }

  /** The live sessions with their transcripts. */
  live(): AgentLive[] {
    return [...this.#sessions.values()].map((session) => ({
      info: session.info(),
      messages: session.messages(),
      asks: session.asks(),
    }));
  }

  /** The live sessions with an SDK session ID and their parameters: the restart state of the host. */
  resumable(): { sdkSessionId: string; params: AgentStartParams }[] {
    return this.live().flatMap(({ info }) =>
      info.sdkSessionId === null ? [] : [{ sdkSessionId: info.sdkSessionId, params: keptParams(info) }],
    );
  }

  /** The earlier sessions of the open checkout. */
  sessions(limit?: number): Promise<AgentSessionEntry[]> {
    const live = new Map<string, string>();
    for (const session of this.#sessions.values()) {
      const id = session.info().sdkSessionId;
      if (id !== null) live.set(id, session.id);
    }
    return listCheckoutSessions({
      sdk: this.#sdk,
      checkout: this.#deps.checkout(),
      state: this.#deps.state,
      costs: this.#costs,
      live,
      options: (sessionId) => this.resumeOptions(sessionId),
      ...(limit === undefined ? {} : { limit }),
    });
  }

  /** End a session and forget it. */
  async close(id: string): Promise<void> {
    const session = this.get(id);
    this.#sessions.delete(id);
    await session.close();
  }

  /** End every session (the host stops). */
  async closeAll(): Promise<void> {
    await Promise.all([...this.#sessions.keys()].map((id) => this.close(id)));
  }

  /** Resolve the credential of a start or a resume, and record the choice (never the key) for the checkout. */
  #credential(params: AgentStartParams): ResolvedCredential {
    const checkout = this.#deps.checkout();
    const file = this.#deps.credentialFile?.() ?? join(checkout, ENV_FILE);
    const resolved = resolveCredential(params.credential ?? "subscription", file, this.#deps.env ?? process.env);
    this.#deps.state.setChatCredential(checkout, resolved.credential);
    return resolved;
  }

  /** Throw for the mode "all" when the host refuses it (the remote mode, remote.ts). */
  #checkMode(mode: AgentMode): void {
    if (mode === "bypassPermissions" && this.#deps.refuseBypass === true) throw new Error(REMOTE_BYPASS_REFUSED);
  }

  #open(
    params: AgentStartParams,
    extra: { resume?: string; forkOf?: string | null },
    credential: ResolvedCredential,
  ): { session: string; info: AgentSessionInfo } {
    this.#checkMode(params.mode);
    const env = withCredential(agentEnv(this.#deps.env ?? process.env, this.#deps.origin ?? null), credential);
    const checkout = this.#deps.checkout();
    const id = `chat-${String(this.#next++)}`;
    const tools = this.#deps.tools ?? workbenchTools();
    const deps = this.#deps;
    const session = new AgentSession({
      id,
      checkout,
      params,
      credential,
      ...extra,
      start: (prompt, options) => this.#sdk.query({ prompt, options }),
      options: (canUseTool, stderr) =>
        sessionOptions({
          checkout,
          params,
          env,
          server: createWorkbenchServer(() => deps.toolContext(), tools),
          toolNames: tools.map((tool) => tool.name),
          hooks: sdkHooks(() => deps.hooks()),
          canUseTool,
          stderr,
          allowBypass: deps.refuseBypass !== true,
          ...(extra.resume === undefined ? {} : { resume: extra.resume }),
        }),
      emit: (event) => {
        if (event.type === "agent.status") this.#keep(event.info);
        deps.emit(event);
      },
      onSdkSession: (sdkSessionId) => deps.state.addSession(checkout, sdkSessionId),
      onCost: (sdkSessionId, costUsd) => this.#costs.set(sdkSessionId, costUsd),
      onAsk: (ask) => deps.emit(askNotice(ask)),
      ...(deps.pictures === undefined ? {} : { pictures: deps.pictures }),
    });
    this.#sessions.set(id, session);
    this.#keep(session.info());
    deps.emit({ type: "agent.status", info: session.info() });
    return { session: id, info: session.info() };
  }

  /** Keep the options of a session with an SDK session ID. The kept options never hold a key. */
  #keep(info: AgentSessionInfo): void {
    if (info.sdkSessionId !== null) this.#options.set(info.sdkSessionId, keptParams(info));
  }
}
