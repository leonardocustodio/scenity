// SPDX-License-Identifier: Apache-2.0
/**
 * A scripted Agent SDK for the end-to-end test of the workbench page. Each prompt of a
 * chat session plays the recorded turn `CHAT_TURN`: the calls that a real chat session makes, in the same order and
 * through the same seams of the host. No Claude Code process starts and no model request goes out.
 *
 * 1. The `UserPromptSubmit` hook of the session options: the host gives the context packet.
 * 2. A text of Claude that quotes the first line of the packet.
 * 3. A call of the tool `lab_frame` through the host route `POST /tools/lab_frame` (the same registry and tool
 *    context as the in-process server). Its text and picture return as the tool result.
 * 4. An approval: `canUseTool` for a Bash command. The host shows the approval card, and the owner allows or denies.
 * 5. The result message with a small cost.
 */
import type { CanUseTool, HookCallback, Options, QueryLike, SDKMessage, SDKUserMessage } from "../../src/agent/sdk";
import type { AgentSdk } from "../../src/agent/sdk";
import type { HostEndpoint } from "../../src/protocol";
import type { ToolResult } from "../../src/tools/kit";

/** The recorded chat turn: the tool call and the command that waits for an approval. */
export const CHAT_TURN = {
  frame: { name: "lab_frame", input: { t: 6000, width: 640 } },
  command: { command: "echo workbench-e2e", description: "Print one word" },
  costUsd: 0.0012,
} as const;

/** The SDK session ID of the scripted sessions. */
const SESSION_PREFIX = "e2e-chat";

/** A tool result content block of the Anthropic API from an MCP content block. */
function apiBlock(block: ToolResult["content"][number]): Record<string, unknown> {
  if (block.type === "text") return { type: "text", text: block.text };
  return { type: "image", source: { type: "base64", media_type: block.mimeType, data: block.data } };
}

/** The scripted query of one session: it plays `CHAT_TURN` for each prompt of the stream. */
class ScriptedQuery implements QueryLike {
  readonly #options: Options;
  readonly #endpoint: () => HostEndpoint;
  readonly #session: string;
  readonly #items: SDKMessage[] = [];
  readonly #abort = new AbortController();
  #wake: (() => void) | null = null;
  #ended = false;
  #turn = 0;

  constructor(prompt: AsyncIterable<SDKUserMessage>, options: Options, endpoint: () => HostEndpoint, id: number) {
    this.#options = options;
    this.#endpoint = endpoint;
    this.#session = `${SESSION_PREFIX}-${String(id)}`;
    this.#push(this.#init());
    void this.#readPrompts(prompt);
  }

  async #readPrompts(prompt: AsyncIterable<SDKUserMessage>): Promise<void> {
    for await (const message of prompt) {
      const content = message.message.content;
      await this.#play(typeof content === "string" ? content : JSON.stringify(content));
    }
    this.close();
  }

  #push(message: Record<string, unknown>): void {
    this.#items.push(message as unknown as SDKMessage);
    this.#wake?.();
  }

  #init(): Record<string, unknown> {
    return {
      type: "system",
      subtype: "init",
      session_id: this.#session,
      model: "claude-e2e-scripted",
      permissionMode: "default",
      apiKeySource: "ANTHROPIC_API_KEY",
      claude_code_version: "scripted",
      cwd: this.#options.cwd ?? "",
      tools: ["Bash", "Edit"],
      mcp_servers: [{ name: "workbench", status: "connected" }],
    };
  }

  /** Call the `UserPromptSubmit` callback of the options; give the additional context or an empty text. */
  async #promptHook(prompt: string): Promise<string> {
    const callback: HookCallback | undefined = this.#options.hooks?.UserPromptSubmit?.[0]?.hooks[0];
    if (callback === undefined) return "";
    const input = {
      hook_event_name: "UserPromptSubmit",
      session_id: this.#session,
      transcript_path: "",
      cwd: this.#options.cwd ?? "",
      prompt,
    };
    const output = (await callback(input as never, undefined, { signal: this.#abort.signal })) as {
      hookSpecificOutput?: { additionalContext?: string };
    };
    return output.hookSpecificOutput?.additionalContext ?? "";
  }

  /** Call a tool through the host route, as the in-process server does. */
  async #tool(name: string, input: unknown): Promise<ToolResult> {
    const { origin, token } = this.#endpoint();
    const response = await fetch(`${origin}/tools/${name}`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-workbench-token": token },
      body: JSON.stringify(input),
    });
    return (await response.json()) as ToolResult;
  }

  #assistant(blocks: readonly Record<string, unknown>[]): void {
    this.#push({ type: "assistant", session_id: this.#session, message: { role: "assistant", content: blocks } });
  }

  #toolResult(id: string, content: readonly Record<string, unknown>[], isError: boolean): void {
    this.#push({
      type: "user",
      session_id: this.#session,
      message: { role: "user", content: [{ type: "tool_result", tool_use_id: id, content, is_error: isError }] },
    });
  }

  async #play(prompt: string): Promise<void> {
    const turn = (this.#turn += 1);
    const packet = await this.#promptHook(prompt);
    const first = packet.split("\n").find((line) => line.trim() !== "") ?? "no packet";
    this.#assistant([{ type: "text", text: `Packet: ${first}` }]);
    const frameId = `toolu_frame_${String(turn)}`;
    this.#assistant([
      { type: "tool_use", id: frameId, name: "mcp__workbench__lab_frame", input: CHAT_TURN.frame.input },
    ]);
    const frame = await this.#tool(CHAT_TURN.frame.name, CHAT_TURN.frame.input);
    this.#toolResult(frameId, frame.content.map(apiBlock), frame.isError === true);
    await this.#ask(turn);
    this.#push({
      type: "result",
      subtype: "success",
      session_id: this.#session,
      duration_ms: 1200,
      num_turns: 2,
      stop_reason: "end_turn",
      total_cost_usd: CHAT_TURN.costUsd * turn,
      modelUsage: {},
      result: "Done.",
    });
  }

  /** Ask for the Bash command; run it (in words only) or report the denial. */
  async #ask(turn: number): Promise<void> {
    const canUseTool: CanUseTool | undefined = this.#options.canUseTool;
    const id = `toolu_bash_${String(turn)}`;
    this.#assistant([{ type: "tool_use", id, name: "Bash", input: CHAT_TURN.command }]);
    if (canUseTool === undefined) return;
    const decision = await canUseTool(
      "Bash",
      { ...CHAT_TURN.command },
      { signal: this.#abort.signal, toolUseID: id, requestId: `request-${id}` },
    );
    if (decision?.behavior === "allow") this.#toolResult(id, [{ type: "text", text: "workbench-e2e" }], false);
    else this.#toolResult(id, [{ type: "text", text: `Denied: ${decision?.message ?? "no answer"}` }], true);
  }

  async *[Symbol.asyncIterator](): AsyncIterator<SDKMessage> {
    for (;;) {
      const next = this.#items.shift();
      if (next !== undefined) {
        yield next;
        continue;
      }
      if (this.#ended) return;
      await new Promise<void>((resolve) => (this.#wake = resolve));
      this.#wake = null;
    }
  }

  interrupt(): Promise<undefined> {
    this.#abort.abort();
    return Promise.resolve(undefined);
  }

  setModel(): Promise<void> {
    return Promise.resolve();
  }

  setPermissionMode(): Promise<void> {
    return Promise.resolve();
  }

  close(): void {
    this.#ended = true;
    this.#abort.abort();
    this.#wake?.();
  }
}

/** The scripted SDK. `endpoint` gives the origin and the token of the host (known after its start). */
export function scriptedSdk(endpoint: () => HostEndpoint): AgentSdk {
  let next = 1;
  return {
    query: ({ prompt, options }) => new ScriptedQuery(prompt, options, endpoint, next++),
    listSessions: () => Promise.resolve([]),
    getSessionInfo: () => Promise.resolve(undefined),
    forkSession: (id) => Promise.resolve({ sessionId: `${id}-fork` }),
  };
}
