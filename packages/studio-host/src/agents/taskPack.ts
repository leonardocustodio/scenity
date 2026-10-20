// SPDX-License-Identifier: Apache-2.0
/**
 * The review pack of a background task. At the end of a task, the host writes `.scenity/tasks/<task>/` in the project
 * folder. The pack has `REVIEW.md` (the prompt, the state, the use of the budget, the gate checks, the change sets,
 * the tools and the files of each turn). It also has the pictures of the view camera before and after the change sets
 * of the task (from the editor window of the project).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentTaskInfo } from "./protocol";
import type { TurnRecordView } from "./turns";

/** A picture of the pack. */
export interface PackPicture {
  readonly mime: string;
  readonly bytes: Uint8Array | ArrayBuffer;
}

/** The folder of the pack of a task (a path in the project). */
export function packFolder(task: string): string {
  return `.scenity/tasks/${task}`;
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

/** The words of a gate check. */
export function checkWords(task: Pick<AgentTaskInfo, "gate" | "check">): string {
  if (task.gate === "none") return "none";
  if (task.check === null) return "rules (no check)";
  const result = task.check.passed === null ? "did not run" : task.check.passed ? "passed" : "failed";
  return `rules: ${result}. ${task.check.message}`.trim();
}

/** The text of `REVIEW.md`. */
export function packText(
  task: AgentTaskInfo,
  turns: readonly TurnRecordView[],
  pictures: readonly string[],
  now = Date.now(),
): string {
  const minutes = Math.max(0, Math.round(((task.endedAt ?? now) - task.startedAt) / 60_000));
  const lines = [
    `# Task: ${task.name}`,
    "",
    `- Prompt: ${task.prompt}`,
    `- State: ${task.state}${task.reason === null ? "" : ` (${task.reason})`}`,
    `- Session: ${task.session}${task.branch === null ? "" : ` · Branch: ${task.branch}`}`,
    `- Budget: ${money(task.costUsd)} of ${money(task.budgetUsd)} · Turns: ${String(turns.length)} of ` +
      `${String(task.maxTurns)} · Minutes: ${String(minutes)} of ${String(task.maxMinutes)}`,
    `- Gate: ${checkWords(task)} (${String(task.refusals)} failed checks in a row)`,
    "",
    "## Change sets",
    "",
    ...(task.sets.length === 0 ? ["None."] : task.sets.map((set) => `- ${set}`)),
    "",
    "## Turns",
  ];
  for (const turn of turns) {
    lines.push("", `### Turn ${String(turn.turn)}: ${turn.prompt}`, "");
    lines.push(`- Tools: ${turn.tools.join(", ") || "none"}`);
    lines.push(`- Files: ${turn.files.join(", ") || "none"}`);
    lines.push(`- Cost: ${money(turn.costUsd)}`);
  }
  if (pictures.length > 0) {
    lines.push("", "## Pictures", "", ...pictures.map((file) => `![${file.replace(/\.\w+$/, "")}](${file})`));
  }
  return `${lines.join("\n")}\n`;
}

/** The file extension of a picture type. */
function extension(mime: string): string {
  return mime === "image/jpeg" ? "jpg" : (mime.split("/")[1] ?? "bin");
}

/** Write the pack of a task in the project folder. The result is the folder of the pack (a path in the project). */
export function writePack(
  dir: string,
  task: AgentTaskInfo,
  turns: readonly TurnRecordView[],
  pictures: readonly PackPicture[],
): string {
  const folder = packFolder(task.id);
  const out = join(dir, folder);
  mkdirSync(out, { recursive: true });
  const names = ["before", "after"];
  const files = pictures.slice(0, names.length).map((picture, index) => {
    const file = `${names[index] ?? "picture"}.${extension(picture.mime)}`;
    const bytes = picture.bytes instanceof Uint8Array ? picture.bytes : new Uint8Array(picture.bytes);
    writeFileSync(join(out, file), bytes);
    return file;
  });
  writeFileSync(join(out, "REVIEW.md"), packText(task, turns, files));
  return folder;
}
