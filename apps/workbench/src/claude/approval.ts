// SPDX-License-Identifier: Apache-2.0
/**
 * The readers of an approval card and a question card: a diff for an edit (`Edit`, `MultiEdit`, `Write`), the
 * command of `Bash`, and the questions of `AskUserQuestion`. The diff is the unified diff text that the diff view of
 * the dock reads. This module has no framework.
 */
import { isRecord } from "@scenity/workbench-host/protocol";

/** The most lines of a written file that the card shows. */
export const WRITE_LINES_MAX = 400;

function str(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function lines(text: string, mark: "+" | "-"): string[] {
  if (text === "") return [];
  return text
    .replace(/\n$/, "")
    .split("\n")
    .map((line) => `${mark}${line}`);
}

function header(path: string): string[] {
  return [`diff --git a/${path} b/${path}`, `--- a/${path}`, `+++ b/${path}`];
}

/** The unified diff text of an edit tool call, or null for another tool. */
export function approvalPatch(tool: string, input: unknown): string | null {
  if (!isRecord(input)) return null;
  const path = str(input.file_path) ?? str(input.notebook_path) ?? "file";
  if (tool === "Edit") {
    const all = input.replace_all === true ? " (every match)" : "";
    const old = str(input.old_string) ?? "";
    const next = str(input.new_string) ?? "";
    return [...header(path), `@@ edit${all} @@`, ...lines(old, "-"), ...lines(next, "+")].join("\n");
  }
  if (tool === "MultiEdit" && Array.isArray(input.edits)) {
    const hunks = input.edits.flatMap((edit, index) =>
      isRecord(edit)
        ? [
            `@@ edit ${String(index + 1)} @@`,
            ...lines(str(edit.old_string) ?? "", "-"),
            ...lines(str(edit.new_string) ?? "", "+"),
          ]
        : [],
    );
    return [...header(path), ...hunks].join("\n");
  }
  if (tool === "Write") {
    const written = lines(str(input.content) ?? "", "+");
    const cut =
      written.length > WRITE_LINES_MAX ? [`@@ ${String(written.length - WRITE_LINES_MAX)} more lines @@`] : [];
    return [...header(path), "@@ new content @@", ...written.slice(0, WRITE_LINES_MAX), ...cut].join("\n");
  }
  return null;
}

/** The command and its description of a `Bash` call, or null for another tool. */
export function bashCall(tool: string, input: unknown): { command: string; description: string | null } | null {
  if (tool !== "Bash" || !isRecord(input)) return null;
  const command = str(input.command);
  return command === null ? null : { command, description: str(input.description) };
}

/** One question of `AskUserQuestion`. */
export interface Question {
  readonly question: string;
  readonly header: string;
  readonly options: readonly { readonly label: string; readonly description: string }[];
  readonly multiSelect: boolean;
}

/** The questions of an `AskUserQuestion` input. */
export function questionsOf(input: unknown): Question[] {
  const list = isRecord(input) && Array.isArray(input.questions) ? input.questions : [];
  return list.filter(isRecord).map((item) => ({
    question: str(item.question) ?? "",
    header: str(item.header) ?? "",
    options: (Array.isArray(item.options) ? item.options : []).filter(isRecord).map((option) => ({
      label: str(option.label) ?? "",
      description: str(option.description) ?? "",
    })),
    multiSelect: item.multiSelect === true,
  }));
}

/** The answer text of one question: the picked labels joined with ", ", or the text of "Other". */
export function answerText(picked: readonly string[], other: string): string {
  const parts = [...picked, ...(other.trim() === "" ? [] : [other.trim()])];
  return parts.join(", ");
}

/** A short line of a tool input for a folded tool call: the path, the command or the first fields. */
export function inputSummary(tool: string, input: unknown): string {
  if (!isRecord(input)) return "";
  const first = str(input.file_path) ?? str(input.command) ?? str(input.pattern) ?? str(input.url) ?? str(input.path);
  if (first !== null) return first.split("\n")[0] ?? "";
  const text = JSON.stringify(input);
  return tool.startsWith("mcp__") || text.length <= 80 ? text.slice(0, 120) : `${text.slice(0, 80)}…`;
}
