// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity check`. Run it from the repo root:
 *
 *   bun packages/cli/src/cli.ts check [project] [--scene <path>] [--sequence <path>] [--tier <tier>] [--json]
 *
 * The project folder defaults to the work folder. The command prints a table per scene (rule, scope, time, value,
 * limit, result) or the JSON report. The exit code is 0 when no failed `block` rule is left (a logged override with
 * the hash of the current scene file accepts a failure), 1 when a `block` rule fails or the setup fails (no project
 * file, no build), and 2 for a usage error.
 */
import { CheckSetupError } from "./assets";
import { reportText } from "./rows";
import { runCheck, type CheckOptions } from "./run";

export const CHECK_USAGE =
  "bun packages/cli/src/cli.ts check [project] [--scene <path>] [--sequence <path>] [--tier <tier>] [--json]";

/** The output lines and the exit code of a command. */
export interface CommandResult {
  readonly out: string[];
  readonly code: number;
}

const VALUE_FLAGS = new Set(["--scene", "--sequence", "--tier"]);

/** The options of the arguments after the word `check`, or null for a usage error. */
export function parseCheckArgs(argv: readonly string[]): { options: CheckOptions; json: boolean } | null {
  const values: Record<string, string> = {};
  const plain: string[] = [];
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") json = true;
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--")) return null;
    else plain.push(arg);
  }
  if (plain.length > 1 || (values.scene !== undefined && values.sequence !== undefined)) return null;
  const options: CheckOptions = {
    dir: plain[0] ?? ".",
    ...(values.scene === undefined ? {} : { scene: values.scene }),
    ...(values.sequence === undefined ? {} : { sequence: values.sequence }),
    ...(values.tier === undefined ? {} : { tier: values.tier }),
  };
  return { options, json };
}

/** Run `scenity check` with the arguments after the word `check`. */
export async function runCheckCommand(argv: readonly string[]): Promise<CommandResult> {
  const parsed = parseCheckArgs(argv);
  if (parsed === null) return { out: [`usage: ${CHECK_USAGE}`], code: 2 };
  try {
    const report = await runCheck(parsed.options);
    const out = parsed.json ? [JSON.stringify(report, null, 2)] : reportText(report);
    return { out, code: report.passed ? 0 : 1 };
  } catch (error) {
    if (!(error instanceof CheckSetupError)) throw error;
    const out = parsed.json ? [JSON.stringify({ error: error.message, passed: false }, null, 2)] : [error.message];
    return { out, code: 1 };
  }
}
