// SPDX-License-Identifier: Apache-2.0
/**
 * One chat session of the host: one SDK `query()` with a prompt queue (a stream input). Thus one session takes many
 * turns, and `interrupt()`, `setModel()` and `setPermissionMode()` work.
 *
 * The session reads the message loop in the background. Each message goes to the page as a trimmed `agent.message`
 * event. The init gives the SDK session ID and the credential source. Each result gives the current cost and the
 * tokens. After an error result, the SDK can throw from the loop. The session catches the error and goes to the state
 * "error", and the page offers a resume. An `api-key` session that reports `apiKeySource: "none"` runs on the
 * claude.ai login, because the key did not apply. The session stops it. A `subscription` session expects that source.
 * The texts of an `api-key` session (the events, the error) never hold the key: `redactKey` replaces it.
 */
import type {
  AgentAsk,
  AgentContextUsage,
  AgentEffort,
  AgentModelChoice,
  AgentSessionInfo,
  AgentStartParams,
} from "../agentProtocol";
import type { AgentDecision, AgentMode, HostEvent } from "../protocol";
import { AskBroker } from "./asks";
import { redactKey, type ResolvedCredential } from "./credential";
import { initFacts, promptEcho, resultFacts, trimMessage, type PictureSink } from "./messages";
import { sessionLimits } from "./options";
import { PromptQueue } from "./queue";
import type { CanUseTool, Options, QueryLike } from "./sdk";

/** The count of messages that a session keeps for a page that reloads. */
export const LOG_MAX = 400;
/** The stop of an `api-key` session whose key did not apply. */
export const NO_KEY_SOURCE =
  'The SDK reports apiKeySource "none" for the API key option: the key did not apply, and the session would use ' +
  "the claude.ai login of this machine. The host stopped the session.";

export interface AgentSessionDeps {
  readonly id: string;
  readonly checkout: string;
  readonly params: AgentStartParams;
  /** The credential of the session. The key stays in the SDK options and in the redaction of the texts. */
  readonly credential: ResolvedCredential;
  /** Start the SDK query with the prompt stream and the options. */
  start(prompt: PromptQueue, options: Options): QueryLike;
  /** The SDK options of the session around its approval callback and its stderr reader. */
  options(canUseTool: CanUseTool, stderr: (data: string) => void): Options;
  emit(event: HostEvent): void;
  /** The SDK session ID is known (the host records it per checkout). */
  onSdkSession?(sdkSessionId: string): void;
  /** A result gave the current cost of the SDK session. */
  onCost?(sdkSessionId: string, costUsd: number): void;
  /** An approval or a question waits (the notification path). */
  onAsk?(ask: AgentAsk): void;
  /** The session that this one forks, or null. */
  readonly forkOf?: string | null;
  /** The SDK session ID that the session resumes, if known before the init. */
  readonly resume?: string;
  /** The picture store. The images of the messages go there, and the page gets their IDs. */
  readonly pictures?: PictureSink;
}

function errorText(error: unknown): string {
  return (error instanceof Error ? error.message : String(error)).split("\n")[0] ?? "error";
}

export class AgentSession {
  readonly id: string;
  readonly done: Promise<void>;
  readonly #deps: AgentSessionDeps;
  readonly #queue = new PromptQueue();
  readonly #asks: AskBroker;
  readonly #query: QueryLike;
  readonly #log: unknown[] = [];
  #info: AgentSessionInfo;
  #stderr = "";
  #closing = false;

  constructor(deps: AgentSessionDeps) {
    this.id = deps.id;
    this.#deps = deps;
    const limits = sessionLimits(deps.params);
    this.#info = {
      session: deps.id,
      sdkSessionId: deps.resume ?? null,
      checkout: deps.checkout,
      state: "starting",
      error: null,
      mode: deps.params.mode,
      model: deps.params.model ?? null,
      effort: deps.params.effort ?? null,
      credential: deps.credential.credential,
      keyFrom: deps.credential.keyFrom,
      apiKeySource: null,
      claudeCodeVersion: null,
      maxBudgetUsd: limits.maxBudgetUsd ?? null,
      maxTurns: limits.maxTurns ?? null,
      costUsd: 0,
      modelUsage: {},
      results: 0,
      lastResult: null,
      models: [],
      started: new Date().toISOString(),
      forkOf: deps.forkOf ?? null,
    };
    this.#asks = new AskBroker({
      session: deps.id,
      emit: (event) => {
        deps.emit(event);
        if (event.type === "agent.ask") deps.onAsk?.(event);
      },
      onCount: (count) => this.#onAskCount(count),
    });
    const stderr = (data: string): void => void (this.#stderr = (this.#stderr + data).slice(-2_000));
    this.#query = deps.start(this.#queue, deps.options(this.#asks.canUseTool, stderr));
    this.done = this.#read();
  }

  info(): AgentSessionInfo {
    return this.#info;
  }

  /** The kept messages, the oldest first. */
  messages(): unknown[] {
    return [...this.#log];
  }

  asks(): AgentAsk[] {
    return this.#asks.pending();
  }

  /** Send a prompt of the owner. */
  prompt(text: string): void {
    if (text.trim() === "") throw new Error("The prompt is empty.");
    if (this.#info.state === "error" || this.#info.state === "ended") {
      throw new Error("The session is not running. Resume it to send a prompt.");
    }
    this.#queue.push(text);
    this.#keep(promptEcho(text));
    if (this.#info.state !== "waiting") this.#set({ state: "running" });
  }

  /** Stop the turn now. The session stays open. */
  async interrupt(): Promise<void> {
    await this.#query.interrupt();
    this.#asks.cancelAll("The owner stopped the turn.");
  }

  answer(ask: string, decision: AgentDecision): void {
    this.#asks.answer(ask, decision);
  }

  async setMode(mode: AgentMode): Promise<void> {
    if (mode === "bypassPermissions" && this.#info.maxBudgetUsd === null) {
      throw new Error('The mode "all" needs a budget. Start a new session in the mode "all".');
    }
    await this.#query.setPermissionMode(mode);
    this.#set({ mode });
  }

  async setModel(model: string): Promise<void> {
    await this.#query.setModel(model);
    this.#set({ model });
  }

  async setEffort(effort: AgentEffort): Promise<void> {
    if (this.#query.applyFlagSettings === undefined) throw new Error("This SDK cannot change the effort.");
    await this.#query.applyFlagSettings({ effortLevel: effort });
    this.#set({ effort });
  }

  /** The context use, or null when the SDK does not give it. */
  async contextUsage(): Promise<AgentContextUsage | null> {
    if (this.#query.getContextUsage === undefined) return null;
    const usage = await this.#query.getContextUsage();
    return { totalTokens: usage.totalTokens, maxTokens: usage.maxTokens, percentage: usage.percentage };
  }

  /** End the session: the prompt stream ends, the open asks are denied and the SDK process stops. */
  async close(): Promise<void> {
    this.#closing = true;
    this.#queue.end();
    this.#asks.cancelAll("The session ended.");
    this.#query.close();
    await Promise.race([this.done, Bun.sleep(5_000)]);
  }

  async #read(): Promise<void> {
    try {
      for await (const message of this.#query) this.#onMessage(message);
      if (this.#info.state !== "error") this.#set({ state: "ended" });
    } catch (error) {
      if (this.#info.state === "error") return;
      if (this.#closing) this.#set({ state: "ended" });
      else this.#fail(errorText(error));
    } finally {
      this.#asks.cancelAll("The session ended.");
    }
  }

  /** Keep a message for a reload (not a stream event) and send it to the page. */
  #keep(raw: Record<string, unknown>): void {
    const message = this.#redact(raw);
    if (message.type !== "stream_event") {
      this.#log.push(message);
      this.#log.splice(0, Math.max(0, this.#log.length - LOG_MAX));
    }
    this.#deps.emit({ type: "agent.message", session: this.id, message });
  }

  /** A copy of a message without the key of the session (an `api-key` session only). */
  #redact(message: Record<string, unknown>): Record<string, unknown> {
    const { key } = this.#deps.credential;
    if (key === null) return message;
    const text = JSON.stringify(message);
    return text.includes(key) ? (JSON.parse(redactKey(text, key)) as Record<string, unknown>) : message;
  }

  #fail(error: string): void {
    const tail = this.#stderr.trim().split("\n").pop() ?? "";
    const text = tail === "" || error.includes(tail) ? error : `${error} (${tail.slice(0, 300)})`;
    this.#set({ state: "error", error: redactKey(text, this.#deps.credential.key) });
  }

  #onMessage(message: unknown): void {
    const trimmed = trimMessage(message, this.#deps.pictures);
    if (trimmed !== null) this.#keep(trimmed);
    const init = initFacts(message);
    if (init !== null) this.#onInit(init);
    const result = resultFacts(message);
    if (result !== null) {
      const sdkSessionId = result.sessionId ?? this.#info.sdkSessionId;
      if (sdkSessionId !== null) this.#deps.onCost?.(sdkSessionId, result.costUsd);
      this.#set({
        state: this.#asks.pending().length > 0 ? "waiting" : "idle",
        costUsd: result.costUsd,
        modelUsage: result.modelUsage,
        results: this.#info.results + 1,
        lastResult: {
          subtype: result.subtype,
          durationMs: result.durationMs,
          numTurns: result.numTurns,
          stopReason: result.stopReason,
        },
      });
    }
  }

  #onInit(init: NonNullable<ReturnType<typeof initFacts>>): void {
    const first = this.#info.state === "starting";
    this.#set({
      sdkSessionId: init.sessionId ?? this.#info.sdkSessionId,
      model: init.model ?? this.#info.model,
      apiKeySource: init.apiKeySource,
      claudeCodeVersion: init.claudeCodeVersion,
      ...(first ? { state: "idle" } : {}),
    });
    if (init.sessionId !== null) this.#deps.onSdkSession?.(init.sessionId);
    if (init.apiKeySource === "none" && this.#info.credential === "api-key") {
      this.#fail(NO_KEY_SOURCE);
      this.#closing = true;
      this.#queue.end();
      this.#query.close();
      return;
    }
    if (first) void this.#loadModels();
  }

  async #loadModels(): Promise<void> {
    try {
      const models = (await this.#query.supportedModels?.()) ?? [];
      const choices: AgentModelChoice[] = models.map((model) => ({
        value: model.value,
        label: model.displayName,
        efforts: model.supportsEffort === true ? [...(model.supportedEffortLevels ?? [])] : [],
      }));
      this.#set({ models: choices });
    } catch {
      // The pickers keep the model of the init.
    }
  }

  #onAskCount(count: number): void {
    const { state } = this.#info;
    if (count > 0 && state !== "waiting" && state !== "error" && state !== "ended") this.#set({ state: "waiting" });
    if (count === 0 && state === "waiting") this.#set({ state: "running" });
  }

  #set(patch: Partial<AgentSessionInfo>): void {
    this.#info = { ...this.#info, ...patch };
    this.#deps.emit({ type: "agent.status", info: this.#info });
  }
}
