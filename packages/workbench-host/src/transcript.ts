// SPDX-License-Identifier: Apache-2.0
/**
 * The export of a transcript. The scrollback of a terminal holds only the last redraws of the TUI. Thus the record of
 * a loop takes its transcript from the session file of the CLI (`~/.claude/projects/<cwd key>/<id>.jsonl`). The host
 * writes it as Markdown into a folder of the checkout that the owner selects (a run or a record folder). The text has
 * the prompts, the text of Claude, the tool calls and their results, with the local time of each step. Long inputs and
 * results are cut.
 *
 * The denylist applies (denylist.ts): the target must not be a denylisted path, and a tool call that names a
 * denylisted file (for example a `Read` of `.env`) shows no result.
 */
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve } from "node:path";
import { checkAllowed, isDenied } from "./denylist";
import { isRecord } from "./protocol";

/** The longest tool input and tool result in the text (characters). */
export const INPUT_CHARS = 700;
export const RESULT_CHARS = 500;
const HIDDEN = "(hidden: the call names a file of the workbench denylist)";

type Json = Record<string, unknown>;

function cutText(value: string, max: number): string {
  return value.length <= max ? value : `${value.slice(0, max)} … [${String(value.length - max)} more chars]`;
}

/** A fenced block whose fence is longer than any run of backticks in the text. */
function fenced(language: string, body: string): string {
  const longest = Math.max(2, ...(body.match(/`+/g) ?? []).map((run) => run.length));
  const fence = "`".repeat(longest + 1);
  return `${fence}${language}\n${body}\n${fence}`;
}

/** The local time of an ISO time (HH:MM:SS), or an empty text. */
function clock(value: unknown): string {
  if (typeof value !== "string") return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toTimeString().slice(0, 8);
}

/** The words of a tool input that look like paths, and its command. */
function inputPaths(input: Json): string[] {
  const words: string[] = [];
  for (const key of ["file_path", "notebook_path", "path", "command", "pattern"]) {
    const value = input[key];
    if (typeof value === "string") words.push(...value.split(/[\s"'`;|&<>()]+/));
  }
  return words.filter((word) => word !== "");
}

/** The text of a tool result (a text, or a list of text and image blocks). */
function resultText(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .map((block: unknown) => {
      if (!isRecord(block)) return "";
      if (block.type === "text" && typeof block.text === "string") return block.text;
      return block.type === "image" ? "[image]" : "";
    })
    .filter((part) => part !== "")
    .join("\n");
}

interface State {
  readonly out: string[];
  /** The IDs of the tool calls that name a denylisted file. */
  readonly hidden: Set<string>;
  messages: number;
}

function userEntry(entry: Json, message: Json, state: State): void {
  const time = clock(entry.timestamp);
  const content = message.content;
  const blocks = Array.isArray(content) ? (content as unknown[]).filter(isRecord) : [];
  const prompt =
    typeof content === "string"
      ? content
      : blocks.every((block) => block.type !== "tool_result")
        ? resultText(blocks)
        : "";
  if (prompt.trim() !== "") {
    if (entry.isMeta === true) return;
    state.out.push(`## ${time} Prompt`, "", fenced("text", prompt), "");
    state.messages += 1;
    return;
  }
  for (const block of blocks) {
    if (block.type !== "tool_result") continue;
    const id = typeof block.tool_use_id === "string" ? block.tool_use_id : "";
    const text = state.hidden.has(id) ? HIDDEN : cutText(resultText(block.content), RESULT_CHARS);
    state.out.push(`${time} result:`, "", fenced("text", text), "");
  }
}

function assistantEntry(entry: Json, message: Json, state: State): void {
  const time = clock(entry.timestamp);
  if (!Array.isArray(message.content)) return;
  for (const block of message.content as unknown[]) {
    if (!isRecord(block)) continue;
    if (block.type === "text" && typeof block.text === "string" && block.text.trim() !== "") {
      state.out.push(`**${time} Claude:** ${block.text.trim()}`, "");
      state.messages += 1;
    } else if (block.type === "tool_use") {
      const input = isRecord(block.input) ? block.input : {};
      if (inputPaths(input).some(isDenied) && typeof block.id === "string") state.hidden.add(block.id);
      const name = typeof block.name === "string" ? block.name : "?";
      state.out.push(`${time} call \`${name}\`:`, "", fenced("json", cutText(JSON.stringify(input), INPUT_CHARS)), "");
    }
  }
}

/** The Markdown of the lines of a session file, and the count of prompts and texts of Claude. */
export function transcriptMarkdown(jsonl: string, session: string): { markdown: string; messages: number } {
  const state: State = { out: [], hidden: new Set(), messages: 0 };
  for (const line of jsonl.split("\n")) {
    if (line.trim() === "") continue;
    let entry: unknown;
    try {
      entry = JSON.parse(line);
    } catch {
      continue;
    }
    if (!isRecord(entry) || entry.isSidechain === true || !isRecord(entry.message)) continue;
    if (entry.type === "user") userEntry(entry, entry.message, state);
    else if (entry.type === "assistant") assistantEntry(entry, entry.message, state);
  }
  const head = [
    `# Transcript of the Claude session ${session}`,
    "",
    "From the session file of the `claude` CLI, exported by the Scenity workbench, in the local time of the " +
      `run. Tool inputs are cut at ${String(INPUT_CHARS)} characters and results at ${String(RESULT_CHARS)}; a call ` +
      "that names a file of the workbench denylist shows no result.",
    "",
  ];
  return { markdown: `${[...head, ...state.out].join("\n").trimEnd()}\n`, messages: state.messages };
}

/** The folder of an export: a folder of the checkout (relative or absolute) that is not on the denylist. */
export function exportFolder(checkout: string, folder: string): string {
  const real = realpathSync(checkout);
  const target = resolve(real, folder);
  const near = relative(real, target);
  if (near.startsWith("..") || isAbsolute(near)) throw new Error(`The folder must be in the checkout: ${folder}`);
  return checkAllowed(target);
}

/** Write the transcript of a session file as `transcript-<id>.md` into a folder of the checkout. */
export function exportTranscript(options: {
  readonly checkout: string;
  readonly session: string;
  readonly folder: string;
  readonly file: string;
}): { path: string; messages: number } {
  if (!existsSync(options.file)) throw new Error(`The CLI has no transcript of the session ${options.session}.`);
  const folder = exportFolder(options.checkout, options.folder);
  const { markdown, messages } = transcriptMarkdown(readFileSync(options.file, "utf8"), options.session);
  mkdirSync(folder, { recursive: true });
  const path = checkAllowed(join(folder, `transcript-${options.session.slice(0, 8)}.md`));
  writeFileSync(path, markdown);
  return { path, messages };
}
