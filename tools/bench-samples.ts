// SPDX-License-Identifier: Apache-2.0
/**
 * The bench numbers of the samples. Run from the repo root:
 *
 *   bun run bench:samples [--out <dir>] [arguments of scenity bench, for example --quick --backend both --check]
 *
 * It runs `scenity bench` on the showroom (the main scene and the crowd of 500 tables at the medium tier), on the
 * characters sample (the sequence walk-wave), on the walkthrough (the sequence meet) and on the road crossing (the
 * sequence rush). It writes the report of each run into `<out>/<sample>/` (default
 * `test-results/bench-samples`), and `summary.md` and `summary.json` of all runs into `<out>`. CI runs it with
 * `--quick` after `build:samples`, uploads the folder and shows `summary.md` as the job summary.
 *
 * The rule of CI: the runners draw WebGL on the CPU (SwiftShader), so CI publishes the numbers and judges no budget.
 * A judgement of the time budgets needs a GPU and a load under 4 (`scenity bench --check` exits with 3 otherwise).
 *
 * The exit code is the worst code of the runs: 1 before 3 before 0 (2 for a usage error).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import {
  benchExitCode,
  benchMarkdown,
  BenchSetupError,
  parseBenchArgs,
  runBench,
  type BenchReport,
} from "../packages/cli/src/bench/index";

/** The runs of the samples: the project folder, the name of the report folder and the arguments. */
export const SAMPLE_RUNS: readonly { readonly dir: string; readonly name: string; readonly args: readonly string[] }[] =
  [
    {
      dir: "samples/showroom",
      name: "showroom-main-medium",
      args: ["--scene", "scenes/main.scene.json", "--tier", "medium"],
    },
    {
      dir: "samples/showroom",
      name: "showroom-crowd-medium",
      args: ["--scene", "scenes/crowd.scene.json", "--tier", "medium"],
    },
    {
      dir: "samples/characters",
      name: "characters-walk-wave",
      args: ["--sequence", "sequences/walk-wave.sequence.json"],
    },
    // The walkthrough (three characters on their routes) and the road crossing (the traffic simulation).
    {
      dir: "samples/walkthrough",
      name: "walkthrough-meet",
      args: ["--sequence", "sequences/meet.sequence.json"],
    },
    {
      dir: "samples/sim-road",
      name: "sim-road-rush",
      args: ["--sequence", "sequences/rush.sequence.json"],
    },
  ];

export const SUMMARY_RULE =
  "CI draws WebGL on the CPU (SwiftShader): it publishes these numbers and judges no budget. The counts (draw calls, " +
  "triangles, instances, asset bytes) do not change with the renderer; the times do. A judgement of the time budgets " +
  "needs a GPU and a load under 4 (`scenity bench --check`).";

/** The worst exit code: 1 before 3 before 0. */
export function worstCode(codes: readonly number[]): number {
  if (codes.includes(1)) return 1;
  return codes.includes(3) ? 3 : 0;
}

/** The summary of the reports as Markdown. */
export function summaryMarkdown(reports: readonly BenchReport[], failures: readonly string[]): string {
  const lines = ["## Bench of the samples", "", SUMMARY_RULE, ""];
  for (const report of reports) lines.push(benchMarkdown(report));
  for (const failure of failures) lines.push(`- ${failure}`);
  return `${lines.join("\n").trimEnd()}\n`;
}

async function main(argv: readonly string[]): Promise<number> {
  const at = argv.indexOf("--out");
  const root = resolve(at >= 0 ? (argv[at + 1] ?? "") : "test-results/bench-samples");
  const rest = at >= 0 ? [...argv.slice(0, at), ...argv.slice(at + 2)] : [...argv];
  const reports: BenchReport[] = [];
  const failures: string[] = [];
  const codes: number[] = [];
  for (const run of SAMPLE_RUNS) {
    const parsed = parseBenchArgs([run.dir, ...run.args, ...rest, "--out", join(root, run.name)]);
    if (parsed === null) {
      console.error("usage: bun run bench:samples [--out <dir>] [arguments of scenity bench]");
      return 2;
    }
    try {
      const result = await runBench(parsed.options, (text) => console.error(text));
      reports.push(result.report);
      codes.push(benchExitCode(result.report, parsed.check));
      console.log(benchMarkdown(result.report));
    } catch (error) {
      if (!(error instanceof BenchSetupError)) throw error;
      failures.push(`${run.name}: ${error.message}`);
      codes.push(1);
    }
  }
  mkdirSync(root, { recursive: true });
  writeFileSync(join(root, "summary.md"), summaryMarkdown(reports, failures));
  writeFileSync(join(root, "summary.json"), `${JSON.stringify({ reports, failures }, null, 2)}\n`);
  console.log(`bench:samples: the reports are in ${root}`);
  return worstCode(codes);
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
