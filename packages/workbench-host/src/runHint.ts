// SPDX-License-Identifier: Apache-2.0
/**
 * The hint for a run of the project in `Bash`. Claude can run the checks of the lab in `Bash`, and then the owner
 * does not see them in the Runs tab. The `PreToolUse` hook does not block such a command (the owner can want it).
 * It adds a short note for Claude that names `workbench_run` and the run. The runs are the runs of the open project
 * that the agent can start, with their command lines and their aliases (runCatalog.ts).
 */
import type { ProjectRun } from "./protocol";
import { activeRunCatalog, agentRuns, commandWords, type RunCatalog } from "./runCatalog";

/** A variable before a command (`NAME=value`). */
const VARIABLE = /^[A-Za-z_][A-Za-z0-9_]*=/;

/** The parts of a shell command line between `&&`, `||`, `;` and `|`, without the brackets of a subshell. */
function commandParts(command: string): string[] {
  return command
    .split(/&&|\|\||[;|\n]/)
    .map((part) => part.trim().replace(/^\(+/, "").replace(/\)+$/, "").trim())
    .filter((part) => part !== "");
}

/** True when the words of a part start with the words of a command line. */
function startsWith(words: readonly string[], line: string): boolean {
  const head = commandWords(line);
  return head.length > 0 && head.every((word, index) => words[index] === word);
}

/** The first run of the project for the agent that a shell command runs, or null. */
export function runOfCommand(command: string, catalog: RunCatalog = activeRunCatalog()): ProjectRun | null {
  const runs = agentRuns(catalog);
  for (const part of commandParts(command)) {
    const words = commandWords(part);
    while (words[0] !== undefined && VARIABLE.test(words[0])) words.shift();
    const run = runs.find((item) => [item.command, ...item.aliases].some((line) => startsWith(words, line)));
    if (run !== undefined) return run;
  }
  return null;
}

/** The note for Claude about a run of the project in `Bash`, or null for another command. */
export function runHint(command: string, catalog: RunCatalog = activeRunCatalog()): string | null {
  const run = runOfCommand(command, catalog);
  if (run === null) return null;
  return (
    `Workbench: use the tool mcp__workbench__workbench_run (command "${run.id}") for \`${run.command}\`, not Bash. ` +
    "The owner then sees the run, its summary and its images in the Runs tab of the workbench. This Bash command " +
    "still runs."
  );
}
