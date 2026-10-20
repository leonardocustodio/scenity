// SPDX-License-Identifier: Apache-2.0
/**
 * The project budgets of `scenity bench`. The budget of a run is `quality.budgets.scene.<tier>` of the project, and the
 * group `scene.<backend>` replaces its values for one backend.
 *
 * Two kinds of values:
 *
 * - counts (`drawCalls`, `triangles`, `bytes`: the asset bytes that the page loaded). They do not change with the load
 *   or the renderer, so the bench always judges them;
 * - times (`workP95Ms`, `gpuP95Ms`, `firstFrameMs`). The bench judges a time only on a GPU renderer at a load under
 *   the limit (default 4, the rule of `apps/editor/perf-budgets.json`). A CPU renderer (the CI runners) or a busy
 *   machine gives times that are not a measure of the budget: the time is "not judged", and `--check` exits with 3.
 *
 * A value that the budget names and the bench does not measure (`textures`, `textureBytes`, `maxTextureSize`) is
 * "not measured" and never fails.
 */
import { projectBudget, type Budget, type ProjectDocument } from "@scenity/scene";
import { peakLoad } from "./machine";
import type { BenchBackend, BenchMeasure, BenchRun, BenchVerdict, BudgetRow } from "./report";

/** The highest 1-minute load average at which the bench judges a time. */
export const DEFAULT_MAX_LOAD = 4;

const TIME_KEYS: ReadonlySet<string> = new Set(["workP95Ms", "gpuP95Ms", "firstFrameMs"]);

/** The budget of a tier and a backend, or null when the project has none. */
export function benchBudget(project: ProjectDocument, tier: string, backend: BenchBackend): Budget | null {
  const base = projectBudget(project, "scene", tier);
  const own = projectBudget(project, `scene.${backend}`, tier);
  if (base === undefined && own === undefined) return null;
  return { ...base, ...own };
}

/** The measured value of a budget key, or null when the bench does not measure it. */
export function measuredValue(measure: BenchMeasure, key: string): number | null {
  switch (key) {
    case "drawCalls":
      return measure.drawCalls;
    case "triangles":
      return measure.triangles;
    case "bytes":
      return measure.assetBytes;
    case "workP95Ms":
      return measure.workP95;
    case "gpuP95Ms":
      return measure.gpuP95Ms;
    case "firstFrameMs":
      return measure.firstFrameMs;
    default:
      return null;
  }
}

/** Why the bench does not judge the times of a run, or null when it judges them. */
export function timeRefusal(measure: BenchMeasure, load: number, maxLoad: number): string | null {
  if (measure.software) {
    return `the browser draws on the CPU (${measure.gpuName ?? "a software renderer"}): its times do not measure a GPU`;
  }
  if (load > maxLoad) {
    return `the load ${load.toFixed(2)} is over ${String(maxLoad)}: a busy machine gives high times, run again when it is quiet`;
  }
  return null;
}

/** The rows of a budget: each value with its limit and result. `refusal` stops the judgement of the times. */
export function budgetRows(budget: Budget, measure: BenchMeasure, refusal: string | null): BudgetRow[] {
  const rows: BudgetRow[] = [];
  for (const key of Object.keys(budget).sort() as (keyof Budget)[]) {
    const limit = budget[key];
    if (limit === undefined) continue;
    const value = measuredValue(measure, key);
    const result =
      value === null
        ? "not measured"
        : TIME_KEYS.has(key) && refusal !== null
          ? "not judged"
          : value > limit
            ? "over"
            : "pass";
    rows.push({ key, limit, value, result });
  }
  return rows;
}

/** A run with its budget rows and the note of its times. */
export function judgeRun(run: Omit<BenchRun, "rows" | "budget">, budget: Budget | null, maxLoad: number): BenchRun {
  if (run.status !== "ok" || run.measure === null || budget === null) return { ...run, budget, rows: [] };
  const refusal = timeRefusal(run.measure, peakLoad([run.load.before, run.load.after]), maxLoad);
  const rows = budgetRows(budget, run.measure, refusal);
  const refused = rows.some((row) => row.result === "not judged");
  return { ...run, note: refused ? refusal : run.note, budget, rows };
}

/** The verdict of the runs: 1 for a failed run or a value over its budget, 3 for a value that is not judged. */
export function benchVerdict(runs: readonly BenchRun[], maxLoad: number): BenchVerdict {
  const over: string[] = [];
  const open: string[] = [];
  for (const run of runs) {
    if (run.status === "failed") over.push(`${run.backend}: the run failed: ${run.note ?? "no reason"}`);
    if (run.status === "n/a" && run.budget !== null) open.push(`${run.backend}: n/a: ${run.note ?? "no reason"}`);
    for (const row of run.rows) {
      if (row.result === "over") over.push(`${run.backend}: ${row.key} ${String(row.value)} > ${String(row.limit)}`);
    }
    if (run.rows.some((row) => row.result === "not judged")) {
      const keys = run.rows.filter((row) => row.result === "not judged").map((row) => row.key);
      open.push(`${run.backend}: ${keys.join(", ")} not judged: ${run.note ?? "no reason"}`);
    }
  }
  const load = peakLoad(runs.flatMap((run) => [run.load.before, run.load.after]));
  const code = over.length > 0 ? 1 : open.length > 0 ? 3 : 0;
  return { code, passed: code === 0, peakLoad: load, maxLoad, reasons: [...over, ...open] };
}
