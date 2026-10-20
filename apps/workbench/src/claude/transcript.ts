// SPDX-License-Identifier: Apache-2.0
/**
 * The transcript of a chat session: the trimmed SDK messages of the host (`agent.message`), folded into entries that
 * the page shows. This module has no framework, so a unit test can give it messages.
 *
 * - The text deltas of the stream events fill `streaming`. The full assistant message replaces it.
 * - A tool call is one entry with its input. Its result (texts and images) joins it when the tool result arrives.
 * - A result gives the cost line: the total of the session up to now (`total_cost_usd`, an estimate).
 */
import { PROMPT_ECHO, isPictureId, isRecord } from "@scenity/workbench-host/protocol";

/** A picture of a tool result: an ID of the picture store of the host, never base64 data. */
export interface ChatImage {
  readonly mime: string;
  readonly picture: string;
}

export interface ToolOutcome {
  readonly isError: boolean;
  readonly texts: readonly string[];
  readonly images: readonly ChatImage[];
}

export type ChatEntry =
  | { readonly kind: "prompt"; readonly id: string; readonly text: string }
  | { readonly kind: "text"; readonly id: string; readonly text: string }
  | { readonly kind: "thinking"; readonly id: string; readonly text: string }
  | {
      readonly kind: "tool";
      readonly id: string;
      readonly name: string;
      readonly input: unknown;
      readonly outcome: ToolOutcome | null;
    }
  | {
      readonly kind: "result";
      readonly id: string;
      readonly subtype: string;
      readonly costUsd: number;
      readonly durationMs: number;
      readonly numTurns: number;
      readonly errors: readonly string[];
    }
  | { readonly kind: "system"; readonly id: string; readonly text: string };

export interface Transcript {
  readonly entries: readonly ChatEntry[];
  /** The text of the answer that streams now, or an empty text. */
  readonly streaming: string;
}

export const EMPTY_TRANSCRIPT: Transcript = { entries: [], streaming: "" };

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/** The texts and pictures of a tool result content. */
export function outcomeOf(block: Record<string, unknown>): ToolOutcome {
  const content = block.content;
  const texts: string[] = [];
  const images: ChatImage[] = [];
  for (const item of typeof content === "string"
    ? [{ type: "text", text: content }]
    : Array.isArray(content)
      ? content
      : []) {
    if (!isRecord(item)) continue;
    if (item.type === "text" && typeof item.text === "string") texts.push(item.text);
    // The host stores the picture and sends its ID (agent/messages.ts `trimImage`).
    const picture = isRecord(item.picture) ? item.picture : null;
    if (item.type === "image" && picture !== null && isPictureId(picture.id)) {
      images.push({ mime: str(picture.mime) ?? "image/png", picture: picture.id });
    }
  }
  return { isError: block.is_error === true, texts, images };
}

function assistantEntries(message: Record<string, unknown>, base: string): ChatEntry[] {
  const body = isRecord(message.message) ? message.message : {};
  const content = Array.isArray(body.content) ? body.content : [];
  const out: ChatEntry[] = [];
  content.forEach((block, index) => {
    if (!isRecord(block)) return;
    const id = `${base}:${String(index)}`;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      out.push({ kind: "text", id, text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string" && block.thinking.trim() !== "") {
      out.push({ kind: "thinking", id, text: block.thinking });
    } else if (block.type === "tool_use") {
      out.push({
        kind: "tool",
        id: str(block.id) ?? id,
        name: str(block.name) ?? "tool",
        input: block.input,
        outcome: null,
      });
    }
  });
  return out;
}

/**
 * Put the tool results of a user message into their tool entries, in place (no copy of the list). A result
 * comes soon after its call, so the search starts at the end. Give true when an entry changed.
 */
function putResults(entries: ChatEntry[], message: Record<string, unknown>): boolean {
  const body = isRecord(message.message) ? message.message : {};
  const content = Array.isArray(body.content) ? body.content : [];
  let changed = false;
  for (const block of content) {
    if (!isRecord(block) || block.type !== "tool_result" || typeof block.tool_use_id !== "string") continue;
    for (let index = entries.length - 1; index >= 0; index -= 1) {
      const entry = entries[index];
      if (entry?.kind !== "tool" || entry.id !== block.tool_use_id) continue;
      entries[index] = { ...entry, outcome: outcomeOf(block) };
      changed = true;
      break;
    }
  }
  return changed;
}

function initLine(message: Record<string, unknown>): string {
  const parts = [
    `Session ${str(message.session_id) ?? "?"}`,
    str(message.model) ?? "",
    // The source "none" is the claude.ai login (the subscription credential).
    `credential ${str(message.apiKeySource)?.replace(/^none$/, "none (claude.ai login)") ?? "unknown"}`,
    `Claude Code ${str(message.claude_code_version) ?? "?"}`,
  ];
  return parts.filter((part) => part !== "").join(" · ");
}

/** A transcript that `appendMessage` changes in place. useChat.ts keeps it in shallow reactive objects. */
export interface LiveTranscript {
  readonly entries: ChatEntry[];
  streaming: string;
}

/** The result entry of a `result` message. */
function resultEntry(message: Record<string, unknown>, id: string): ChatEntry {
  const errors = Array.isArray(message.errors) ? message.errors.filter((item) => typeof item === "string") : [];
  return {
    kind: "result",
    id,
    subtype: str(message.subtype) ?? "unknown",
    costUsd: num(message.total_cost_usd),
    durationMs: num(message.duration_ms),
    numTurns: num(message.num_turns),
    errors,
  };
}

/**
 * Add one message of the host to a transcript in place. The new entries go at the end, a tool result replaces one
 * entry, and nothing copies the list. `seq` makes the IDs of entries without an SDK ID. Give true when
 * the transcript changed.
 */
export function appendMessage(target: LiveTranscript, message: unknown, seq: number): boolean {
  if (!isRecord(message)) return false;
  const id = str(message.uuid) ?? `m${String(seq)}`;
  switch (message.type) {
    case "stream_event": {
      const event = isRecord(message.event) ? message.event : {};
      const delta = isRecord(event.delta) ? event.delta : {};
      const text = delta.type === "text_delta" ? str(delta.text) : null;
      if (text === null) return false;
      target.streaming += text;
      return true;
    }
    case "assistant":
      target.entries.push(...assistantEntries(message, id));
      target.streaming = "";
      return true;
    case "user": {
      if (message[PROMPT_ECHO] !== true) return putResults(target.entries, message);
      const body = isRecord(message.message) ? message.message : {};
      target.entries.push({ kind: "prompt", id, text: str(body.content) ?? "" });
      target.streaming = "";
      return true;
    }
    case "result":
      target.entries.push(resultEntry(message, id));
      target.streaming = "";
      return true;
    case "system":
      if (message.subtype !== "init") return false;
      target.entries.push({ kind: "system", id, text: initLine(message) });
      return true;
    default:
      return false;
  }
}

/** Add one message of the host to a transcript; a new transcript, or the same one when nothing changed. */
export function applyMessage(transcript: Transcript, message: unknown, seq: number): Transcript {
  const next: LiveTranscript = { entries: [...transcript.entries], streaming: transcript.streaming };
  return appendMessage(next, message, seq) ? next : transcript;
}

/** Fold a list of messages (the log of a live session) into a transcript: one list, filled in place. */
export function foldMessages(messages: readonly unknown[]): LiveTranscript {
  const transcript: LiveTranscript = { entries: [], streaming: "" };
  messages.forEach((message, index) => appendMessage(transcript, message, index));
  return transcript;
}

/** A cost in USD for the page: "$0.0123 (estimate)". */
export function costText(usd: number): string {
  const digits = usd < 1 ? 4 : 2;
  return `$${usd.toFixed(digits)} (estimate)`;
}
