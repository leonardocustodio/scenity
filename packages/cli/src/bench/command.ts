// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity bench`. Run it from the repo root:
 *
 *   bun packages/cli/src/cli.ts bench [project] [--scene <path>] [--sequence <path>] [--backend webgl|webgpu|both]
 *     [--tier <tier>] [--quick] [--json] [--check] [--out <dir>] [--dist <dir>] [--build] [--lock <file>]
 *     [--max-load <n>]
 *
 * The project folder defaults to the work folder. The command prints the Markdown table of the report, or the JSON
 * report with `--json`, and writes both into the report folder. The exit codes:
 *
 * - 0: the runs finished (with `--check`: and each value of each budget passes);
 * - 1: a run or the setup failed (with `--check`: or a value is over its budget);
 * - 2: a usage error;
 * - 3: with `--check`, a time of a budget is not judged: the load is over the limit (default 4) or the browser draws
 *   on the CPU. The output gives the reason. The bench judges the counts in all cases: a count over its budget gives 1.
 */
import { DEFAULT_MAX_LOAD } from "./budgets";
import { benchMarkdown } from "./report";
import { BENCH_TIERS, BenchSetupError, runBench, type BenchBackendOption, type BenchOptions } from "./run";

export const BENCH_USAGE =
  "bun packages/cli/src/cli.ts bench [project] [--scene <path>] [--sequence <path>] [--backend webgl|webgpu|both] " +
  "[--tier <tier>] [--quick] [--json] [--check] [--out <dir>] [--dist <dir>] [--build] [--lock <file>] [--max-load <n>]";

const VALUE_FLAGS = new Set([
  "--scene",
  "--sequence",
  "--backend",
  "--tier",
  "--out",
  "--dist",
  "--lock",
  "--max-load",
]);
const BACKENDS: readonly string[] = ["webgl", "webgpu", "both"];

export interface BenchArgs {
  readonly options: BenchOptions;
  readonly json: boolean;
  readonly check: boolean;
}

/** The options of the arguments after the word `bench`, or null for a usage error. */
export function parseBenchArgs(argv: readonly string[]): BenchArgs | null {
  const values: Record<string, string> = {};
  const plain: string[] = [];
  const flags = new Set<string>();
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (arg === "--json" || arg === "--check" || arg === "--quick" || arg === "--build") flags.add(arg);
    else if (VALUE_FLAGS.has(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      values[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--")) return null;
    else plain.push(arg);
  }
  const { backend, tier } = values;
  const maxLoad = values["max-load"] === undefined ? DEFAULT_MAX_LOAD : Number(values["max-load"]);
  if (plain.length > 1 || !Number.isFinite(maxLoad) || maxLoad < 0) return null;
  if (backend !== undefined && !BACKENDS.includes(backend)) return null;
  if (tier !== undefined && !(BENCH_TIERS as readonly string[]).includes(tier)) return null;
  const pick = (key: string): Record<string, string> => (values[key] === undefined ? {} : { [key]: values[key] });
  const options: BenchOptions = {
    dir: plain[0] ?? ".",
    ...pick("scene"),
    ...pick("sequence"),
    ...pick("tier"),
    ...pick("out"),
    ...pick("dist"),
    ...pick("lock"),
    ...(backend === undefined ? {} : { backend: backend as BenchBackendOption }),
    quick: flags.has("--quick"),
    build: flags.has("--build"),
    maxLoad,
  };
  return { options, json: flags.has("--json"), check: flags.has("--check") };
}

/** The exit code of a report: a failed run gives 1; with `--check` the code of the verdict. */
export function benchExitCode(
  report: { runs: readonly { status: string }[]; verdict: { code: number } },
  check: boolean,
) {
  if (report.runs.some((run) => run.status === "failed")) return 1;
  return check ? report.verdict.code : 0;
}

/** Run `scenity bench` with the arguments after the word `bench`. Progress lines go to `log`. */
export async function runBenchCommand(
  argv: readonly string[],
  log: (text: string) => void = (text) => console.error(text),
): Promise<{ out: string[]; code: number }> {
  const parsed = parseBenchArgs(argv);
  if (parsed === null) return { out: [`usage: ${BENCH_USAGE}`], code: 2 };
  try {
    const result = await runBench(parsed.options, log);
    const out = parsed.json
      ? [JSON.stringify(result.report, null, 2)]
      : [benchMarkdown(result.report), `report: ${result.out}`];
    return { out, code: benchExitCode(result.report, parsed.check) };
  } catch (error) {
    if (!(error instanceof BenchSetupError)) throw error;
    const out = parsed.json ? [JSON.stringify({ error: error.message, passed: false }, null, 2)] : [error.message];
    return { out, code: 1 };
  }
}
