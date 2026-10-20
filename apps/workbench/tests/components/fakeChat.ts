// SPDX-License-Identifier: Apache-2.0
/**
 * A fake host client for the chat tests. The requests answer from a table, and the test emits the events of the host.
 */
import type {
  AgentSessionInfo,
  EventPayload,
  EventType,
  RequestParams,
  RequestResult,
  RequestType,
} from "@scenity/workbench-host/protocol";
import type { ChatClient } from "../../src/claude/useChat";

export const CHECKOUT = "/repo";

export function sessionInfo(patch: Partial<AgentSessionInfo> = {}): AgentSessionInfo {
  return {
    session: "chat-1",
    sdkSessionId: "s-1",
    checkout: CHECKOUT,
    state: "idle",
    error: null,
    mode: "default",
    model: "claude-haiku-5-5",
    effort: null,
    credential: "subscription",
    keyFrom: null,
    apiKeySource: "none",
    claudeCodeVersion: "2.1.284",
    maxBudgetUsd: null,
    maxTurns: null,
    costUsd: 0,
    modelUsage: {},
    results: 0,
    lastResult: null,
    models: [{ value: "claude-haiku-5-5", label: "Haiku", efforts: ["low", "high"] }],
    started: "2026-10-12T10:00:00.000Z",
    forkOf: null,
    ...patch,
  };
}

type Answer = (params: unknown) => unknown;

export function fakeChatClient(answers: Partial<Record<RequestType, Answer>> = {}) {
  const calls: { type: RequestType; params: unknown }[] = [];
  const listeners = new Map<string, Set<(payload: never) => void>>();
  const hello = new Set<() => void>();
  const client: ChatClient = {
    request: <T extends RequestType>(type: T, params: RequestParams<T>): Promise<RequestResult<T>> => {
      calls.push({ type, params });
      const answer =
        answers[type] ?? (type === "agent.live" ? () => ({ sessions: [], credential: "subscription" }) : () => null);
      try {
        return Promise.resolve(answer(params) as RequestResult<T>);
      } catch (error) {
        return Promise.reject(error instanceof Error ? error : new Error(String(error)));
      }
    },
    on: <T extends EventType>(type: T, listener: (payload: EventPayload<T>) => void) => {
      const set = listeners.get(type) ?? new Set();
      listeners.set(type, set);
      set.add(listener);
      return () => set.delete(listener);
    },
    onHello: (listener) => {
      const wrapped = (): void => listener({ protocol: 1, checkout: null, surfaces: [] });
      hello.add(wrapped);
      return () => hello.delete(wrapped);
    },
  };
  const emit = <T extends EventType>(type: T, payload: EventPayload<T>): void => {
    for (const listener of listeners.get(type) ?? []) (listener as (value: EventPayload<T>) => void)(payload);
  };
  return { client, calls, emit, of: (type: RequestType) => calls.filter((call) => call.type === type) };
}
