// SPDX-License-Identifier: Apache-2.0
/**
 * The report of `scenity bench`: the JSON form (`bench.json`) and the Markdown table (`bench.md`, also the job summary
 * of CI). One report holds one scene or sequence of a project at one tier, with one run per renderer backend.
 */
import type { Budget } from "@scenity/scene";
import type { LoadSample, MachineInfo } from "./machine";

export const BENCH_FORMAT = "scenity.bench/1";
export const BENCH_JSON = "bench.json";
export const BENCH_MD = "bench.md";

export type BenchBackend = "webgl" | "webgpu";

/** The memory of a run; a value that the browser does not give is null. */
export interface BenchMemory {
  /** The geometries, textures and shader programs of the renderer. */
  readonly geometries: number | null;
  readonly textures: number | null;
  readonly programs: number | null;
  /** The GPU memory in bytes (WebGPU only). */
  readonly gpuBytes: number | null;
  /** The used JS heap of the page in MB (Chromium). */
  readonly pageHeapMb: number | null;
}

/** The numbers of one run of the player. */
export interface BenchMeasure {
  /** The backend of the frame statistics (a fallback can draw with another backend than the one asked). */
  readonly drawn: string | null;
  /** The path that draws: "worker" or "main". */
  readonly renderer: string | null;
  /** The quality tier of the frame statistics. */
  readonly tier: string | null;
  /** The renderer string of the browser (WebGL), or null. */
  readonly gpuName: string | null;
  /** True when the browser draws on the CPU (SwiftShader, llvmpipe): the times do not measure a GPU. */
  readonly software: boolean;
  /** The time from the page load to the first frame with every asset (the `ready` event of the player). */
  readonly firstFrameMs: number | null;
  /** The frames of the core from the load to the end of the window. */
  readonly frames: number;
  /** The frames of the measure window. */
  readonly windowFrames: number;
  /** The frames in the statistics of the core: its last 600 frames (more than the window in a short run). */
  readonly statsFrames: number;
  readonly workP50: number;
  readonly workP95: number;
  readonly intervalP50: number;
  readonly intervalP95: number;
  /** The GPU time p95 in ms, or null when the player gives no GPU time. */
  readonly gpuP95Ms: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly instances: number | null;
  readonly entities: number | null;
  readonly visibleEntities: number | null;
  /** The bytes of the asset files that the page loaded. */
  readonly assetBytes: number;
  readonly memory: BenchMemory;
  /** The renderer fallbacks of the player, each as `from -> to: reason`. */
  readonly fallbacks: readonly string[];
}

export type BudgetResult = "pass" | "over" | "not measured" | "not judged";

/** One value of the budget of a run. */
export interface BudgetRow {
  readonly key: string;
  readonly limit: number;
  readonly value: number | null;
  readonly result: BudgetResult;
}

export type RunStatus = "ok" | "n/a" | "failed";

/** The run of one renderer backend. */
export interface BenchRun {
  /** The backend that the bench asked for. */
  readonly backend: BenchBackend;
  readonly status: RunStatus;
  /** Why the run is "n/a" or failed, or why its times are not judged. */
  readonly note: string | null;
  readonly measure: BenchMeasure | null;
  readonly load: { readonly before: LoadSample; readonly after: LoadSample };
  /** The budget of the tier and the backend (`quality.budgets.scene` and `scene.<backend>`), or null. */
  readonly budget: Budget | null;
  readonly rows: readonly BudgetRow[];
}

/** The verdict of the budgets. The command uses its code only with `--check`. */
export interface BenchVerdict {
  /** 0: each value of each budget passes; 1: a value is over or a run failed; 3: a time is not judged. */
  readonly code: 0 | 1 | 3;
  readonly passed: boolean;
  /** The highest 1-minute load average of the runs and the limit of the load rule. */
  readonly peakLoad: number;
  readonly maxLoad: number;
  readonly reasons: readonly string[];
}

export interface BenchReport {
  readonly format: typeof BENCH_FORMAT;
  readonly project: string;
  /** The scene path in the project folder. */
  readonly scene: string;
  readonly sequence: string | null;
  readonly tier: string;
  readonly quick: boolean;
  readonly date: string;
  readonly machine: MachineInfo;
  /** The build that served the player and the assets, and true when the bench made it. */
  readonly build: { readonly dir: string; readonly made: boolean };
  /** The warm-up after the first frame and the measure window, in ms. */
  readonly window: { readonly warmupMs: number; readonly windowMs: number };
  readonly runs: readonly BenchRun[];
  readonly verdict: BenchVerdict;
}

function ms(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : value.toFixed(2);
}

function count(value: number | null | undefined): string {
  return value === null || value === undefined ? "n/a" : String(Math.round(value));
}

function mb(bytes: number | null | undefined): string {
  return bytes === null || bytes === undefined ? "n/a" : (bytes / 1024 ** 2).toFixed(1);
}

function loadText(run: BenchRun): string {
  return `${run.load.before.avg[0].toFixed(2)} / ${run.load.after.avg[0].toFixed(2)}`;
}

/** The value of a budget row as the table shows it. */
function rowValue(row: BudgetRow): string {
  if (row.value === null) return "n/a";
  return row.key.endsWith("Ms") ? ms(row.value) : count(row.value);
}

const RUN_HEADER =
  "| backend | drawn | first frame ms | work p50 ms | work p95 ms | GPU p95 ms | interval p95 ms | draw calls | triangles | instances | assets MB | page heap MB | load before / after | budget |";

function runRow(run: BenchRun): string {
  const m = run.measure;
  const over = run.rows.filter((row) => row.result === "over").length;
  const open = run.rows.filter((row) => row.result === "not judged").length;
  const budget =
    run.status !== "ok"
      ? run.status
      : run.budget === null
        ? "no budget"
        : over > 0
          ? `${String(over)} over`
          : open > 0
            ? "not judged"
            : "pass";
  const drawn = m === null ? "n/a" : `${m.drawn ?? "?"} ${m.renderer ?? ""}${m.software ? " (CPU)" : ""}`.trim();
  const cells = [
    run.backend,
    drawn,
    ms(m?.firstFrameMs),
    ms(m?.workP50),
    ms(m?.workP95),
    ms(m?.gpuP95Ms),
    ms(m?.intervalP95),
    count(m?.drawCalls),
    count(m?.triangles),
    count(m?.instances),
    mb(m?.assetBytes),
    m?.memory.pageHeapMb == null ? "n/a" : m.memory.pageHeapMb.toFixed(1),
    loadText(run),
    budget,
  ];
  return `| ${cells.join(" | ")} |`;
}

/** The Markdown of a report: the runs, the budget rows and the verdict. */
export function benchMarkdown(report: BenchReport): string {
  const title = report.sequence === null ? report.scene : `${report.sequence} (scene ${report.scene})`;
  const lines = [
    `### ${report.project}: ${title}`,
    "",
    `Tier ${report.tier}, ${report.quick ? "quick" : "full"} window: ${String(report.window.warmupMs)} ms warm-up, ` +
      `${String(report.window.windowMs)} ms measure. ${report.machine.cpu}, ${String(report.machine.cores)} cores, ` +
      `${report.machine.system}. ${report.date}.`,
    "",
    RUN_HEADER,
    `|${" --- |".repeat(14)}`,
    ...report.runs.map(runRow),
    "",
  ];
  const rows = report.runs.flatMap((run) =>
    run.rows.map((row) => `| ${run.backend} | ${row.key} | ${rowValue(row)} | ${String(row.limit)} | ${row.result} |`),
  );
  if (rows.length > 0) lines.push("| backend | budget | value | limit | result |", "| --- | --- | --- | --- | --- |");
  lines.push(...rows, ...(rows.length > 0 ? [""] : []));
  for (const run of report.runs) if (run.note !== null) lines.push(`- ${run.backend}: ${run.note}`);
  const verdict = report.verdict;
  const word = verdict.code === 0 ? "pass" : verdict.code === 1 ? "fail" : "not judged";
  lines.push(
    `- Budgets: ${word} (load ${verdict.peakLoad.toFixed(2)}, limit ${String(verdict.maxLoad)}).`,
    ...verdict.reasons.map((reason) => `  - ${reason}`),
    "",
  );
  return lines.join("\n");
}
