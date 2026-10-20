// SPDX-License-Identifier: Apache-2.0
/**
 * The SDK messages for the page. The host sends each message of a session as a trimmed `agent.message` event. The
 * host cuts long texts, big tool inputs and long lists. The images of tool results go to the picture store, and the
 * page gets their IDs (up to `IMAGE_MAX_CHARS`). Of the stream events, only the text and thinking deltas go to the
 * page (the stream text). The module also reads the init and result messages into the session state.
 */
import { PROMPT_ECHO, type AgentModelUsage } from "../agentProtocol";
import { isCaptureMime, isRecord, type CaptureMime } from "../protocol";

/** The longest text of a message field (characters). */
export const TEXT_MAX_CHARS = 4_000;
/** The longest text of a tool result (characters). */
export const RESULT_MAX_CHARS = 8_000;
/** The longest base64 data of an image (about 1.5 MB). A bigger image becomes a note. */
export const IMAGE_MAX_CHARS = 2_000_000;
/** The longest list. */
const LIST_MAX = 60;
/** The deepest object. */
const DEPTH_MAX = 8;

/** The picture store of the host (pictures.ts), as the trim uses it. */
export interface PictureSink {
  put(bytes: Uint8Array, mime: CaptureMime): string;
}

/** Cut a text to `max` characters with a note of the rest. */
export function cutText(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}… (${String(text.length - max)} more characters)`;
}

/**
 * An image block of a message becomes a reference of the picture store (`{ type: "image", picture: { id, mime } }`).
 * The page reads the bytes at `GET /pictures/<id>`, so no base64 goes to the page.
 */
function trimImage(block: Record<string, unknown>, pictures: PictureSink | undefined): Record<string, unknown> {
  const source = isRecord(block.source) ? block.source : null;
  const data = source !== null && typeof source.data === "string" ? source.data : null;
  if (data === null) return { type: "text", text: "[image without data]" };
  if (data.length > IMAGE_MAX_CHARS) {
    return { type: "text", text: `[image of ${String(Math.round((data.length * 3) / 4 / 1024))} KB, too big to show]` };
  }
  const mime = source?.media_type;
  if (pictures === undefined || !isCaptureMime(mime)) {
    return { type: "text", text: `[image ${typeof mime === "string" ? mime : "of an unknown type"}, not stored]` };
  }
  try {
    return { type: "image", picture: { id: pictures.put(new Uint8Array(Buffer.from(data, "base64")), mime), mime } };
  } catch {
    return { type: "text", text: "[image: the picture store failed]" };
  }
}

/** Trim a value of a message: texts, lists and depth. An image block goes to the picture store. */
export function trimValue(value: unknown, max = TEXT_MAX_CHARS, depth = 0, pictures?: PictureSink): unknown {
  if (typeof value === "string") return cutText(value, max);
  if (Array.isArray(value)) {
    const items = value.slice(0, LIST_MAX).map((item) => trimValue(item, max, depth + 1, pictures));
    if (value.length > LIST_MAX) items.push(`… and ${String(value.length - LIST_MAX)} more`);
    return items;
  }
  if (!isRecord(value)) return value;
  if (value.type === "image") return trimImage(value, pictures);
  if (depth >= DEPTH_MAX) return "[…]";
  const out: Record<string, unknown> = {};
  for (const [key, item] of Object.entries(value)) {
    const limit = key === "content" && value.type === "tool_result" ? RESULT_MAX_CHARS : max;
    out[key] = trimValue(item, limit, depth + 1, pictures);
  }
  return out;
}

/** The stream event of a text or thinking delta, or null for another stream event. */
function trimStreamEvent(message: Record<string, unknown>): Record<string, unknown> | null {
  const event = isRecord(message.event) ? message.event : null;
  if (event?.type !== "content_block_delta" || !isRecord(event.delta)) return null;
  const { delta } = event;
  if (delta.type === "text_delta" && typeof delta.text === "string") {
    return {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "text_delta", text: delta.text } },
    };
  }
  if (delta.type === "thinking_delta" && typeof delta.thinking === "string") {
    return {
      type: "stream_event",
      event: { type: "content_block_delta", delta: { type: "thinking_delta", thinking: delta.thinking } },
    };
  }
  return null;
}

/** The fields of the init message that the page shows; the long lists become counts. */
function trimInit(message: Record<string, unknown>): Record<string, unknown> {
  const count = (name: string): number => (Array.isArray(message[name]) ? message[name].length : 0);
  return {
    type: "system",
    subtype: "init",
    session_id: message.session_id,
    model: message.model,
    permissionMode: message.permissionMode,
    apiKeySource: message.apiKeySource,
    claude_code_version: message.claude_code_version,
    cwd: message.cwd,
    mcp_servers: trimValue(message.mcp_servers),
    tools: count("tools"),
    skills: count("skills"),
    slash_commands: count("slash_commands"),
  };
}

/** The prompt of the owner as a transcript message: the SDK does not echo the prompts of a prompt stream. */
export function promptEcho(text: string): Record<string, unknown> {
  return { type: "user", [PROMPT_ECHO]: true, message: { role: "user", content: cutText(text, RESULT_MAX_CHARS) } };
}

/** The message for the page, or null when the page does not need it. Its images go to the picture store. */
export function trimMessage(message: unknown, pictures?: PictureSink): Record<string, unknown> | null {
  if (!isRecord(message)) return null;
  if (message.type === "stream_event") return trimStreamEvent(message);
  if (message.type === "system" && message.subtype === "init") return trimInit(message);
  return trimValue(message, TEXT_MAX_CHARS, 0, pictures) as Record<string, unknown>;
}

/** The fields of an init message that the session state keeps. */
export interface InitFacts {
  readonly sessionId: string | null;
  readonly model: string | null;
  readonly apiKeySource: string | null;
  readonly claudeCodeVersion: string | null;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** Read an init message, or null for another message. */
export function initFacts(message: unknown): InitFacts | null {
  if (!isRecord(message) || message.type !== "system" || message.subtype !== "init") return null;
  return {
    sessionId: str(message.session_id),
    model: str(message.model),
    apiKeySource: str(message.apiKeySource),
    claudeCodeVersion: str(message.claude_code_version),
  };
}

/** The fields of a result message that the session state keeps. */
export interface ResultFacts {
  readonly subtype: string;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly numTurns: number;
  readonly stopReason: string | null;
  readonly modelUsage: Record<string, AgentModelUsage>;
  readonly sessionId: string | null;
}

/** Read a result message, or null for another message. */
export function resultFacts(message: unknown): ResultFacts | null {
  if (!isRecord(message) || message.type !== "result") return null;
  const usage: Record<string, AgentModelUsage> = {};
  if (isRecord(message.modelUsage)) {
    for (const [model, item] of Object.entries(message.modelUsage)) {
      if (!isRecord(item)) continue;
      usage[model] = {
        inputTokens: num(item.inputTokens),
        outputTokens: num(item.outputTokens),
        cacheReadInputTokens: num(item.cacheReadInputTokens),
        cacheCreationInputTokens: num(item.cacheCreationInputTokens),
        costUsd: num(item.costUSD),
      };
    }
  }
  return {
    subtype: str(message.subtype) ?? "unknown",
    costUsd: num(message.total_cost_usd),
    durationMs: num(message.duration_ms),
    numTurns: num(message.num_turns),
    stopReason: str(message.stop_reason),
    modelUsage: usage,
    sessionId: str(message.session_id),
  };
}
