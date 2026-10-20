// SPDX-License-Identifier: Apache-2.0
/**
 * A fake Agent SDK for the tests of the chat mode: `query()` gives a `FakeQuery` that reads the prompt stream,
 * records the controls and yields the messages that a test pushes. No test starts Claude.
 */
import type { ModelInfo, SDKControlGetContextUsageResponse } from "@anthropic-ai/claude-agent-sdk";
import type { AgentSdk, Options, QueryLike, SDKMessage, SDKSessionInfo, SDKUserMessage } from "../src/agent/sdk";

export class FakeQuery implements QueryLike {
  readonly options: Options;
  readonly prompts: string[] = [];
  readonly calls: string[] = [];
  readonly #items: unknown[] = [];
  #wake: (() => void) | null = null;
  #ended = false;
  #error: Error | null = null;

  constructor(prompt: AsyncIterable<SDKUserMessage>, options: Options) {
    this.options = options;
    void (async () => {
      for await (const message of prompt) {
        const content = message.message.content;
        this.prompts.push(typeof content === "string" ? content : JSON.stringify(content));
      }
      this.calls.push("prompt stream ended");
    })();
  }

  /** Yield a message to the session. */
  push(message: Record<string, unknown>): void {
    this.#items.push(message);
    this.#wake?.();
  }

  /** End the message loop without an error. */
  end(): void {
    this.#ended = true;
    this.#wake?.();
  }

  /** End the message loop with an error (as the SDK after an error result). */
  fail(text: string): void {
    this.#error = new Error(text);
    this.#wake?.();
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    for (;;) {
      const next = this.#items.shift();
      if (next !== undefined) {
        yield next as SDKMessage;
        continue;
      }
      if (this.#error !== null) throw this.#error;
      if (this.#ended) return;
      await new Promise<void>((resolve) => (this.#wake = resolve));
      this.#wake = null;
    }
  }

  interrupt(): Promise<undefined> {
    this.calls.push("interrupt");
    return Promise.resolve(undefined);
  }

  setModel(model?: string): Promise<void> {
    this.calls.push(`setModel ${model ?? ""}`);
    return Promise.resolve();
  }

  setPermissionMode(mode: string): Promise<void> {
    this.calls.push(`setPermissionMode ${mode}`);
    return Promise.resolve();
  }

  applyFlagSettings(settings: Record<string, unknown>): Promise<void> {
    this.calls.push(`applyFlagSettings ${JSON.stringify(settings)}`);
    return Promise.resolve();
  }

  supportedModels(): Promise<ModelInfo[]> {
    return Promise.resolve([
      {
        value: "claude-haiku-5-5",
        displayName: "Haiku",
        description: "",
        supportsEffort: true,
        supportedEffortLevels: ["low", "high"],
      },
    ]);
  }

  getContextUsage(): Promise<SDKControlGetContextUsageResponse> {
    return Promise.resolve({
      totalTokens: 1200,
      maxTokens: 200000,
      percentage: 0.6,
    } as SDKControlGetContextUsageResponse);
  }

  close(): void {
    this.calls.push("close");
    this.end();
  }
}

/** An init message of the SDK. */
export function initMessage(sessionId: string, apiKeySource = "ANTHROPIC_API_KEY"): Record<string, unknown> {
  return {
    type: "system",
    subtype: "init",
    session_id: sessionId,
    model: "claude-haiku-5-5",
    permissionMode: "default",
    apiKeySource,
    claude_code_version: "2.1.284",
    cwd: "/repo",
    tools: ["Read", "Edit"],
    mcp_servers: [{ name: "workbench", status: "connected" }],
    skills: [],
    slash_commands: [],
  };
}

/** A result message of the SDK. */
export function resultMessage(sessionId: string, costUsd: number, subtype = "success"): Record<string, unknown> {
  return {
    type: "result",
    subtype,
    session_id: sessionId,
    duration_ms: 900,
    num_turns: 1,
    stop_reason: "end_turn",
    total_cost_usd: costUsd,
    modelUsage: {
      "claude-haiku-5-5": {
        inputTokens: 10,
        outputTokens: 5,
        cacheReadInputTokens: 0,
        cacheCreationInputTokens: 0,
        costUSD: costUsd,
      },
    },
    result: "Done.",
  };
}

/** A fake SDK: the queries it made and the sessions on its fake disk. */
export function fakeSdk(
  sessions: SDKSessionInfo[] = [],
): AgentSdk & { readonly queries: FakeQuery[]; forks: string[] } {
  const queries: FakeQuery[] = [];
  const forks: string[] = [];
  return {
    queries,
    forks,
    query: ({ prompt, options }) => {
      const made = new FakeQuery(prompt, options);
      queries.push(made);
      return made;
    },
    listSessions: () => Promise.resolve(sessions),
    getSessionInfo: (id) => Promise.resolve(sessions.find((item) => item.sessionId === id)),
    forkSession: (id) => {
      forks.push(id);
      return Promise.resolve({ sessionId: `${id}-fork` });
    },
  };
}
