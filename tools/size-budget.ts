// SPDX-License-Identifier: Apache-2.0
/**
 * Check the size budgets of the entries of a runtime build.
 *
 * Run from the repo root with the `dist` folder of a runtime build and the entry spec of a plugin:
 *     bun tools/size-budget.ts --dist <dir> --budgets <spec>          # exit 1 when a budget is exceeded or a file
 *                                                                     # is missing
 *     bun tools/size-budget.ts --dist <dir> --budgets <spec> --json   # write the measures as JSON to stdout
 *     bun tools/size-budget.ts --dist <dir> --budgets <spec> --why x  # the modules of each entry by size
 *                                                                     # (moduleReport.ts)
 *     bun tools/size-budget.ts --dist <dir> --budgets <spec> --entries  # the entry budgets only, no marker gate (a lab
 *                                                                       # build; the parity suite of a plugin uses it)
 *
 * The tool has no default folder. Without `--dist` it measures nothing and passes.
 *
 * The generic part (the import graph, the gzip measures, the budgets and the exceptions) is in
 * `packages/cli/src/build/sizes.ts`. `scenity build` uses it for the player entries of a project. The entry specs,
 * `measureBuild` and the report are in `packages/cli/src/build/entryBudgets.ts` (`@scenity/cli/entryBudgets`). The
 * entries and their budgets come from the entry spec of a plugin (`--budgets <module>`; its default export is an
 * `EntrySpec`).
 * This tool names no plugin. It gives the spec the import graph of the build and the shell of `index.html`. Without
 * `--budgets` the tool measures no entry and gives only the information lines.
 *
 * Precompressed copies (apps/editor/scripts/static/precompress.ts): the build writes `<file>.br` and `<file>.gz` next
 * to each text file, and nginx sends them in place of the file. The tool measures the files themselves. The copies
 * are not files of the build. The tool checks that each copy is the compressed form of its file (a stale copy is a
 * problem). The information lines give the Brotli bytes ("br": the `.br` copy of each file, else its gzip-9 size):
 * the bytes on the network with `brotli_static on`.
 *
 * Exceptions (`tools/size-budget-exceptions.json`): an entry gives a budget a higher allowance with a reason
 * and the record that approves it. A measure above its limit passes only when it is at or below the
 * allowance. An entry for a measure that is at or below its limit is stale, and a stale entry fails the
 * check (as the wording allowlist does), so the file stays true.
 */
import { join, resolve } from "node:path";
import {
  formatReport,
  loadSpec,
  measureBuild,
  NO_ENTRIES,
  readExceptions,
} from "../packages/cli/src/build/entryBudgets";
import { whyEntries } from "./moduleReport";

export * from "../packages/cli/src/build/entryBudgets";
export {
  checkCopies,
  closure,
  findChunk,
  isCopy,
  judge,
  KB,
  parseEdges,
  readBuild,
  resolveSpecifier,
  type BudgetException,
  type BuiltFile,
  type Edges,
  type MeasureResult,
} from "../packages/cli/src/build/sizes";

export const WEB_ROOT = resolve(import.meta.dir, "..");
export const DEFAULT_EXCEPTIONS = join(WEB_ROOT, "tools", "size-budget-exceptions.json");

if (import.meta.main) {
  const args = process.argv.slice(2);
  const distIndex = args.indexOf("--dist");
  if (distIndex < 0) {
    // No default folder, so nothing to measure. `scenity build` checks the builds of the projects.
    process.stdout.write("size-budget: no build given (--dist <dir>); scenity build checks the project builds\n");
    process.exit(0);
  }
  const dist = resolve(args[distIndex + 1] ?? "");
  const specIndex = args.indexOf("--budgets");
  const spec = specIndex < 0 ? NO_ENTRIES : await loadSpec(args[specIndex + 1] ?? "");
  const report = measureBuild(dist, spec, readExceptions(DEFAULT_EXCEPTIONS, spec));
  const why = args.indexOf("--why");
  if (why >= 0) {
    // The module report of the entries: no budget check, only the list. The command fails when the build in `dist`
    // has no current report.
    const areas = spec.budgets.map((budget): [string, readonly string[]] => [
      budget.label,
      report.groups?.[budget.id] ?? [],
    ]);
    const modules = whyEntries(dist, areas);
    process.stdout.write(`${modules.text}\n`);
    process.exit(modules.ok ? 0 : 1);
  }
  if (args.includes("--json")) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`size-budget: ${dist}\n${formatReport(report)}\n`);
  }
  // The gate of the lab markers: no lab code in the runtime build. A lab build (the
  // editor) holds lab code on purpose, so `--entries` checks only the budgets of its runtime entries.
  const markers = await import("./lab-markers");
  const gate = args.includes("--entries") ? null : markers.markerGate(dist, markers.defaultLabsDist());
  if (gate !== null && !args.includes("--json")) process.stdout.write(`${markers.formatGate(gate).join("\n")}\n`);
  if (gate !== null && markers.gateFails(gate)) {
    process.stderr.write("size-budget: FAILED. Lab code is in the build, or the marker list is stale.\n");
    process.exit(1);
  }
  const failed = report.problems.length > 0 || report.measures.some((item) => !item.ok);
  if (failed) {
    process.stderr.write(
      "size-budget: FAILED. Make the chunk smaller (load the heavy part lazily), or record an approved exception " +
        "in tools/size-budget-exceptions.json.\n",
    );
    process.exit(1);
  }
}
