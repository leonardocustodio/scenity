// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity build`. Run it from the repo root:
 *
 *   bun packages/cli/src/cli.ts build [project] [--out <dir>] [--check] [--json]
 *
 * The project folder defaults to the work folder, the output folder to `<project>/dist`. `--check` does not write the
 * asset build of the project: it must be current. The command prints the entries with their sizes and budgets, the
 * result of the marker gate and the problems, or the JSON report. The exit code is 0 when the build passes, 1 when a
 * budget, the marker gate, the asset step or the setup fails, and 2 for a usage error. At the start of each step, a
 * line goes to stderr, so a job of the studio shows that the build runs.
 */
import { BuildSetupError, runBuild, shownPath, type BuildOptions } from "./run";
import { reportLines } from "./report";

export const BUILD_USAGE = "bun packages/cli/src/cli.ts build [project] [--out <dir>] [--check] [--json]";

/** The options of the arguments after the word `build`, or null for a usage error. */
export function parseBuildArgs(argv: readonly string[]): { options: BuildOptions; json: boolean } | null {
  const plain: string[] = [];
  let out: string | undefined;
  let check = false;
  let json = false;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json") json = true;
    else if (arg === "--check") check = true;
    else if (arg === "--out") {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      out = value;
      index += 1;
    } else if (arg.startsWith("--")) return null;
    else plain.push(arg);
  }
  if (plain.length > 1) return null;
  return { options: { dir: plain[0] ?? ".", check, ...(out === undefined ? {} : { out }) }, json };
}

/** Run `scenity build` with the arguments after the word `build`. */
export async function runBuildCommand(argv: readonly string[]): Promise<{ out: string[]; code: number }> {
  const parsed = parseBuildArgs(argv);
  if (parsed === null) return { out: [`usage: ${BUILD_USAGE}`], code: 2 };
  try {
    const result = await runBuild({ ...parsed.options, progress: (line) => console.error(line) });
    const out = parsed.json
      ? [JSON.stringify(result.report, null, 2)]
      : reportLines(result.report, shownPath(result.out));
    return { out, code: result.report.passed ? 0 : 1 };
  } catch (error) {
    if (!(error instanceof BuildSetupError)) throw error;
    const out = parsed.json ? [JSON.stringify({ error: error.message, passed: false }, null, 2)] : [error.message];
    return { out, code: 1 };
  }
}
