// SPDX-License-Identifier: Apache-2.0
/**
 * The stream-json output of `claude -p --output-format stream-json --verbose` for a background run. Each line is
 * one JSON message: `system` (`init` with the
 * session ID), `assistant` (text and tool calls), `user` (tool results) and at the end `result` (the stop reason, the
 * turns, the cost estimate and the last text). The reader keeps the facts of the run and gives a short progress line
 * per message for the page.
 */
import { isRecord, parseJson } from "./protocol";

/** The facts of a run from its stream. */
export interface StreamFacts {
  session: string | null;
  model: string | null;
  turns: number | null;
  costUsd: number | null;
  /** The subtype of the `result` message, or null before it. */
  subtype: string | null;
  isError: boolean;
  result: string | null;
  /** The last text block of Claude (the result of an error run has no text). */
  lastText: string | null;
}

/** The longest progress line (characters). */
export const MAX_LINE = 240;
/** The longest result text that the host keeps (characters). */
export const MAX_RESULT = 2000;

function short(text: string, max = MAX_LINE): string {
  const line = text.replace(/\s+/g, " ").trim();
  return line.length > max ? `${line.slice(0, max - 1)}…` : line;
}

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function num(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** A short text of the input of a tool call: the command, the file, the pattern or the first fields. */
export function toolInputText(input: unknown): string {
  if (!isRecord(input)) return "";
  for (const key of ["command", "file_path", "notebook_path", "pattern", "url", "path", "prompt"]) {
    const value = str(input[key]);
    if (value !== null) return value;
  }
  return Object.keys(input).slice(0, 3).join(", ");
}

function assistantLines(message: Record<string, unknown>, facts: StreamFacts): string[] {
  const content = isRecord(message.message) ? message.message.content : undefined;
  if (!Array.isArray(content)) return [];
  const lines: string[] = [];
  for (const block of content) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      facts.lastText = block.text.slice(0, MAX_RESULT);
      lines.push(short(`Claude: ${block.text}`));
    } else if (block.type === "tool_use") {
      lines.push(short(`tool ${str(block.name) ?? "?"}: ${toolInputText(block.input)}`));
    }
  }
  return lines;
}

function userLines(message: Record<string, unknown>): string[] {
  const content = isRecord(message.message) ? message.message.content : undefined;
  if (!Array.isArray(content)) return [];
  return content
    .filter((block): block is Record<string, unknown> => isRecord(block) && block.type === "tool_result")
    .filter((block) => block.is_error === true)
    .map((block) => {
      const text = Array.isArray(block.content)
        ? block.content.map((part) => (isRecord(part) ? (str(part.text) ?? "") : "")).join(" ")
        : (str(block.content) ?? "");
      return short(`tool error: ${text}`);
    });
}

function resultLine(message: Record<string, unknown>, facts: StreamFacts): string {
  facts.subtype = str(message.subtype);
  facts.isError = message.is_error === true;
  facts.turns = num(message.num_turns) ?? facts.turns;
  facts.costUsd = num(message.total_cost_usd) ?? facts.costUsd;
  facts.session = str(message.session_id) ?? facts.session;
  const text = str(message.result);
  facts.result = text === null ? facts.lastText : text.slice(0, MAX_RESULT);
  const cost = facts.costUsd === null ? "?" : facts.costUsd.toFixed(4);
  return `result ${facts.subtype ?? "?"}: ${String(facts.turns ?? "?")} turns, about $${cost}`;
}

/** Read one message of the stream into the facts. Give the progress lines of the message (none for most). */
export function readStreamMessage(value: unknown, facts: StreamFacts): string[] {
  if (!isRecord(value)) return [];
  switch (value.type) {
    case "system": {
      if (value.subtype !== "init") return [];
      facts.session = str(value.session_id) ?? facts.session;
      facts.model = str(value.model) ?? facts.model;
      return [`session ${facts.session ?? "?"} · model ${facts.model ?? "?"}`];
    }
    case "assistant":
      return assistantLines(value, facts);
    case "user":
      return userLines(value);
    case "result":
      return [resultLine(value, facts)];
    default:
      return [];
  }
}

/** A reader of the stdout of the CLI: it splits the text into lines and reads each JSON line. */
export class StreamReader {
  readonly facts: StreamFacts = {
    session: null,
    model: null,
    turns: null,
    costUsd: null,
    subtype: null,
    isError: false,
    result: null,
    lastText: null,
  };
  #rest = "";
  readonly #onLine: (line: string) => void;

  constructor(onLine: (line: string) => void) {
    this.#onLine = onLine;
  }

  /** Add a part of the stdout. */
  push(text: string): void {
    const parts = (this.#rest + text).split("\n");
    this.#rest = parts.pop() ?? "";
    for (const part of parts) this.#read(part);
  }

  /** Read the last line without a line end. */
  end(): void {
    if (this.#rest !== "") this.#read(this.#rest);
    this.#rest = "";
  }

  #read(line: string): void {
    if (line.trim() === "") return;
    const value = parseJson(line);
    if (value === undefined) {
      this.#onLine(short(line));
      return;
    }
    for (const progress of readStreamMessage(value, this.facts)) this.#onLine(progress);
  }
}
