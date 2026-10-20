// SPDX-License-Identifier: Apache-2.0
/**
 * The messages of the chat mode: the Agent SDK sessions of the host, their approvals and questions, and the list of
 * the earlier sessions of a checkout. `protocol.ts` exports them. This module is pure (no `node:` or `bun:` import),
 * so the page gets them through
 * `@scenity/workbench-host/protocol`.
 */
import type { AgentDecision, AgentMode } from "./protocol";

/** The effort levels of the Agent SDK (`Options.effort`, `applyFlagSettings({ effortLevel })`). */
export const AGENT_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export type AgentEffort = (typeof AGENT_EFFORTS)[number];

/**
 * The credential of a chat session. `subscription` (the default) runs the SDK on the claude.ai login of the machine.
 * `api-key` runs it on `ANTHROPIC_API_KEY` of `.env` at the checkout root (or of the environment of the host). The
 * owner picks the API key explicitly.
 */
export const AGENT_CREDENTIALS = ["subscription", "api-key"] as const;
export type AgentCredential = (typeof AGENT_CREDENTIALS)[number];

/** Where the API key of a session comes from: the `.env` file of the checkout root or the environment of the host. */
export type AgentKeyFrom = ".env" | "environment";

/**
 * The state of a chat session: the SDK starts, the session waits for a prompt, a turn runs, a turn waits for the
 * owner (an approval or a question), the message loop stopped with an error (the page shows Resume), or it ended.
 */
export type AgentState = "starting" | "idle" | "running" | "waiting" | "error" | "ended";

/** The tokens and the estimated cost of one model in a session (`modelUsage` of the SDK result). */
export interface AgentModelUsage {
  readonly inputTokens: number;
  readonly outputTokens: number;
  readonly cacheReadInputTokens: number;
  readonly cacheCreationInputTokens: number;
  readonly costUsd: number;
}

/** A model that the session can use (`supportedModels()` of the SDK). */
export interface AgentModelChoice {
  readonly value: string;
  readonly label: string;
  /** The effort levels of the model; empty when the model has no effort parameter. */
  readonly efforts: readonly string[];
}

/** The state of one chat session of the host. */
export interface AgentSessionInfo {
  /** The ID of the session in the host (for example "chat-1"). */
  readonly session: string;
  /** The session ID of the SDK (from the init message), or null before the init. */
  readonly sdkSessionId: string | null;
  readonly checkout: string;
  readonly state: AgentState;
  /** The error of the message loop, or null. */
  readonly error: string | null;
  readonly mode: AgentMode;
  readonly model: string | null;
  readonly effort: AgentEffort | null;
  /** The credential that the owner picked for the session. */
  readonly credential: AgentCredential;
  /** The source of the API key of an `api-key` session, or null (a `subscription` session). Never the key. */
  readonly keyFrom: AgentKeyFrom | null;
  /** The credential source of the init message (`apiKeySource`), or null before the init. */
  readonly apiKeySource: string | null;
  /** The version of the bundled Claude Code (`claude_code_version`), or null before the init. */
  readonly claudeCodeVersion: string | null;
  /** The limits of the session: the spend in USD and the model requests of one prompt (mode "all"). */
  readonly maxBudgetUsd: number | null;
  readonly maxTurns: number | null;
  /** The current total of the estimated cost (`total_cost_usd` of the last result). An estimate, not the bill. */
  readonly costUsd: number;
  /** The tokens per model (`modelUsage` of the last result). */
  readonly modelUsage: Readonly<Record<string, AgentModelUsage>>;
  /** The count of results (one per prompt). */
  readonly results: number;
  /** The last result: its subtype, its time and its model requests, or null. */
  readonly lastResult: {
    readonly subtype: string;
    readonly durationMs: number;
    readonly numTurns: number;
    readonly stopReason: string | null;
  } | null;
  /** The models of the session, after the init. */
  readonly models: readonly AgentModelChoice[];
  /** The ISO time of the start. */
  readonly started: string;
  /** The session that this session forks, or null. */
  readonly forkOf: string | null;
}

/** An approval or a question that waits for the owner (the `agent.ask` event). */
export interface AgentAsk {
  readonly session: string;
  readonly ask: string;
  readonly kind: "tool" | "question";
  readonly tool: string;
  readonly input: unknown;
  /** Why Claude Code asks (`decisionReason`), or null. */
  readonly reason: string | null;
  /** The sentence of the prompt (`title`, for example "Claude wants to edit a.ts"), or null. */
  readonly title?: string | null;
  /** True when the SDK gave rules for "Allow for the session". */
  readonly canRemember?: boolean;
}

/** One earlier session of the checkout, from `listSessions` of the SDK. */
export interface AgentSessionEntry {
  readonly sessionId: string;
  /** The title (`customTitle`, else the summary of the SDK). */
  readonly title: string;
  readonly firstPrompt: string | null;
  /** The epoch times in ms. */
  readonly lastModified: number;
  readonly createdAt: number | null;
  readonly gitBranch: string | null;
  /** The last estimated cost that this host saw for the session, or null. */
  readonly costUsd: number | null;
  /** True when the host recorded the session (a chat or a terminal session of the workbench). */
  readonly workbench: boolean;
  /** The host session that runs it at this time, or null. */
  readonly live: string | null;
  /**
   * The options that a resume or a fork without other options uses: the last options of the session that the host
   * kept, else the defaults of the chat start form (`formDefaults`). Never a key.
   */
  readonly options: AgentStartParams;
  /** True when the options are the kept options of the session; false for the defaults of the start form. */
  readonly kept: boolean;
}

/** The parameters of a new or resumed session. */
export interface AgentStartParams {
  readonly mode: AgentMode;
  /** The credential of the session. The default is `subscription`. */
  readonly credential?: AgentCredential;
  readonly model?: string;
  readonly effort?: AgentEffort;
  /** The spend limit in USD. The mode "all" needs it; the host gives a default. */
  readonly maxBudgetUsd?: number;
  /** The limit of model requests of one prompt. The mode "all" needs it; the host gives a default. */
  readonly maxTurns?: number;
}

/** A live session of the host with its transcript, for a page that opens or reloads. */
export interface AgentLive {
  readonly info: AgentSessionInfo;
  /** The trimmed SDK messages of the session, the oldest first (no stream events). */
  readonly messages: readonly unknown[];
  readonly asks: readonly AgentAsk[];
}

/** The context use of a session (`getContextUsage` of the SDK). */
export interface AgentContextUsage {
  readonly totalTokens: number;
  readonly maxTokens: number;
  readonly percentage: number;
}

/** The requests of the chat mode (page to host). `RequestMap` of protocol.ts extends this map. */
export interface AgentRequests {
  /**
   * Start a chat session in the open checkout. The host records the credential choice per checkout (never the
   * key). An `api-key` session without a usable key fails with the reason.
   */
  "agent.start": { params: AgentStartParams; result: { session: string; info: AgentSessionInfo } };
  /** A prompt of the owner. The `UserPromptSubmit` callback adds the context packet. */
  "agent.prompt": { params: { session: string; text: string }; result: null };
  /** Stop the turn immediately. The session stays open. */
  "agent.interrupt": { params: { session: string }; result: null };
  /** The answer to an approval card or a question card. */
  "agent.answer": { params: { session: string; ask: string; decision: AgentDecision }; result: null };
  /** Change the permission mode of a session. The mode "all" needs a session with a budget. */
  "agent.setMode": { params: { session: string; mode: AgentMode }; result: null };
  /** Change the model of a session. */
  "agent.setModel": { params: { session: string; model: string }; result: null };
  /** Change the effort of a session. */
  "agent.setEffort": { params: { session: string; effort: AgentEffort }; result: null };
  /**
   * Resume a session by its SDK session ID, or fork it for a second try. Each option that the request does not
   * give comes from the kept options of the session, else from the defaults of the start form (`formDefaults`).
   */
  "agent.resume": {
    params: Partial<AgentStartParams> & { sessionId: string; fork?: boolean };
    result: { session: string; info: AgentSessionInfo };
  };
  /** End a session (the SDK process stops; the transcript stays on disk for a resume). */
  "agent.close": { params: { session: string }; result: null };
  /**
   * The live sessions of the host with their transcripts (a page that opens or reloads), and the credential
   * that the owner picked last in the open checkout (`subscription` when none).
   */
  "agent.live": { params: object; result: { sessions: AgentLive[]; credential: AgentCredential } };
  /** The earlier sessions of the open checkout, the newest first. */
  "agent.sessions": { params: { limit?: number }; result: { sessions: AgentSessionEntry[] } };
  /** The context use of a session, or null when the SDK does not give it. */
  "agent.context": { params: { session: string }; result: AgentContextUsage | null };
}

/**
 * The field that marks a prompt of the owner in the transcript: the host adds `{ type: "user", workbenchPrompt: true,
 * message: { role: "user", content } }` for each prompt, because the SDK does not echo the prompts of a stream.
 */
export const PROMPT_ECHO = "workbenchPrompt";

/** The events of the chat mode (host to page). `EventMap` of protocol.ts extends this map. */
export interface AgentEvents {
  /** A message of the Agent SDK stream, trimmed (agent/messages.ts). */
  "agent.message": { session: string; message: unknown };
  /** Claude waits for an approval or for the answer to a question. */
  "agent.ask": AgentAsk;
  /** An approval or a question has its answer (or the turn stopped); the page removes its card. */
  "agent.askDone": { session: string; ask: string };
  /** The state of a session after a change. */
  "agent.status": { info: AgentSessionInfo };
}

/** The names of the requests of the chat mode. */
export const AGENT_REQUEST_NAMES: Readonly<Record<keyof AgentRequests, true>> = {
  "agent.start": true,
  "agent.prompt": true,
  "agent.interrupt": true,
  "agent.answer": true,
  "agent.setMode": true,
  "agent.setModel": true,
  "agent.setEffort": true,
  "agent.resume": true,
  "agent.close": true,
  "agent.live": true,
  "agent.sessions": true,
  "agent.context": true,
};

/** The names of the events of the chat mode. */
export const AGENT_EVENT_NAMES: Readonly<Record<keyof AgentEvents, true>> = {
  "agent.message": true,
  "agent.ask": true,
  "agent.askDone": true,
  "agent.status": true,
};

/** True for an effort level of the SDK. */
export function isAgentEffort(value: unknown): value is AgentEffort {
  return typeof value === "string" && (AGENT_EFFORTS as readonly string[]).includes(value);
}

/** True for a credential of the chat mode. */
export function isAgentCredential(value: unknown): value is AgentCredential {
  return typeof value === "string" && (AGENT_CREDENTIALS as readonly string[]).includes(value);
}

/**
 * The defaults of the chat start form: the mode "ask", the credential that the host remembers for the
 * checkout, and no model or effort (the defaults of the account). A resume of a session without kept options uses
 * them; the Sessions tab shows them.
 */
export function formDefaults(credential: AgentCredential): AgentStartParams {
  return { mode: "default", credential };
}

/** True for a permission mode of the chat panel. */
export function isAgentMode(value: unknown): value is AgentMode {
  return value === "default" || value === "acceptEdits" || value === "bypassPermissions";
}
