// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity bench`: the performance harness on a scene or a sequence of any project, with the budgets of the project.
 *
 * 1. The build: the bench uses the `scenity build` folder of the project (default `<project>/dist`). With `--build`,
 *    or when the folder has no player, it makes the build first (`scenity build --check`: the asset build must be
 *    current). The scene and sequence documents come from the project folder (page/serve.ts).
 * 2. The GPU lock of the labs tools (page/lock.ts), for the whole run.
 * 3. One run per backend in headless Chromium (page.ts): the first frame time, the frame work, the GPU time when the
 *    player gives it, the draw calls, the triangles, the instances, the asset bytes, the memory and the load of the
 *    machine before and after the run.
 * 4. The budgets (budgets.ts) and the report (report.ts): `bench.json` and `bench.md` in the report folder.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { basename, join, relative, resolve } from "node:path";
import type { Browser } from "@playwright/test";
import type { ProjectDocument } from "@scenity/scene";
import { BuildSetupError, readBuildProject } from "../build/run";
import { launchChromium } from "../page/browser";
import { gpuLock } from "../page/lock";
import { PLAYER_PAGE, servePlayerPage } from "../page/serve";
import { playerBuild, playTarget, SetupError } from "../page/setup";
import { benchBudget, benchVerdict, DEFAULT_MAX_LOAD, judgeRun } from "./budgets";
import { loadSample, machineInfo } from "./machine";
import { measurePage, type PageTiming } from "./page";
import { BENCH_FORMAT, BENCH_JSON, BENCH_MD, benchMarkdown, type BenchBackend, type BenchReport } from "./report";
import type { BenchRun } from "./report";

/** A setup problem: no project, a scene that does not exist, no build (the setup error of the shared page code). */
export { SetupError as BenchSetupError, projectFile } from "../page/setup";

export const BENCH_TIERS = ["ultra", "high", "medium", "low"] as const;
export type BenchBackendOption = BenchBackend | "both";

export interface BenchOptions {
  /** The project folder. */
  readonly dir: string;
  /** A scene file (a path in the project folder, or from the work folder). Default: the first scene of the project. */
  readonly scene?: string;
  /** A sequence file; the scene is the project scene that the sequence animates. */
  readonly sequence?: string;
  readonly backend?: BenchBackendOption;
  /** The quality tier of the player (default "high"). */
  readonly tier?: string;
  readonly quick?: boolean;
  /** The build folder (default `<project>/dist`). */
  readonly dist?: string;
  /** True: make a new build first. */
  readonly build?: boolean;
  /** The GPU lock file (default the lock of the labs tools). */
  readonly lock?: string;
  readonly maxLoad?: number;
  /** The report folder (default `<build>/bench/<name>-<tier>`). */
  readonly out?: string;
}

export interface BenchResult {
  readonly report: BenchReport;
  /** The report folder. */
  readonly out: string;
}

/** The warm-up and measure windows: `--quick` for CI and a fast look, else longer windows. */
export function benchTiming(quick: boolean): PageTiming {
  return quick
    ? { warmupMs: 1000, windowMs: 5000, readyMs: 120_000 }
    : { warmupMs: 3000, windowMs: 15_000, readyMs: 120_000 };
}

/** The scene and the sequence of a run. A sequence with no `--scene` plays on the project scene with its ID. */
export function benchTarget(
  dir: string,
  project: ProjectDocument,
  options: Pick<BenchOptions, "scene" | "sequence">,
): { scene: string; sequence: string | null } {
  return playTarget(dir, project, options);
}

interface RunContext {
  readonly out: string;
  readonly dir: string;
  readonly target: { scene: string; sequence: string | null };
  readonly tier: string;
  readonly timing: PageTiming;
  readonly project: ProjectDocument;
  readonly maxLoad: number;
}

/** One run of one backend. */
async function runBackend(browser: Browser, context: RunContext, backend: BenchBackend): Promise<BenchRun> {
  const { scene, sequence } = context.target;
  const server = servePlayerPage(context.out, context.dir, { scene, sequence, backend, tier: context.tier });
  const budget = benchBudget(context.project, context.tier, backend);
  try {
    const before = loadSample();
    const result = await measurePage(browser, server.origin + PLAYER_PAGE, context.timing, () => server.assetBytes());
    const load = { before, after: loadSample() };
    if ("error" in result) {
      return judgeRun({ backend, status: "failed", note: result.error, measure: null, load }, budget, context.maxLoad);
    }
    const drawn = result.measure.drawn;
    const other = drawn !== backend;
    const fallbacks = result.measure.fallbacks.join("; ") || "no fallback step";
    const note = other ? `the player drew with ${drawn ?? "no backend"} (${fallbacks})` : null;
    const run = { backend, status: other ? "n/a" : "ok", note, measure: result.measure, load } as const;
    return judgeRun(run, budget, context.maxLoad);
  } finally {
    server.stop();
  }
}

/** The name of the report folder: the file name of the sequence or scene and the tier. */
export function reportName(target: { scene: string; sequence: string | null }, tier: string): string {
  const name = basename(target.sequence ?? target.scene).replace(/\.(scene|sequence)\.json$/, "");
  return `${name}-${tier}`;
}

/** Run `scenity bench`. `log` gets the progress lines. */
export async function runBench(
  options: BenchOptions,
  log: (text: string) => void = () => undefined,
): Promise<BenchResult> {
  const dir = resolve(options.dir);
  let project: ProjectDocument;
  try {
    project = readBuildProject(dir);
  } catch (error) {
    if (error instanceof BuildSetupError) throw new SetupError(error.message);
    throw error;
  }
  const target = benchTarget(dir, project, options);
  const tier = options.tier ?? "high";
  const quick = options.quick === true;
  const maxLoad = options.maxLoad ?? DEFAULT_MAX_LOAD;
  const build = await playerBuild(
    dir,
    {
      tool: "scenity bench",
      build: options.build === true,
      ...(options.dist === undefined ? {} : { dist: options.dist }),
    },
    log,
  );
  const timing = benchTiming(quick);
  const backends: BenchBackend[] = options.backend === "both" ? ["webgl", "webgpu"] : [options.backend ?? "webgl"];
  const context: RunContext = { out: build.out, dir, target, tier, timing, project, maxLoad };
  const runs: BenchRun[] = [];
  const release = await gpuLock({ ...(options.lock === undefined ? {} : { path: options.lock }), log });
  try {
    const browser = await launchChromium();
    try {
      for (const backend of backends) {
        log(`scenity bench: ${project.id} ${reportName(target, tier)} on ${backend}`);
        runs.push(await runBackend(browser, context, backend));
      }
    } finally {
      await browser.close();
    }
  } finally {
    release();
  }
  const report: BenchReport = {
    format: BENCH_FORMAT,
    project: project.id,
    scene: target.scene,
    sequence: target.sequence,
    tier,
    quick,
    date: new Date().toISOString(),
    machine: machineInfo(),
    build: { dir: relative(process.cwd(), build.out) || ".", made: build.made },
    window: { warmupMs: timing.warmupMs, windowMs: timing.windowMs },
    runs,
    verdict: benchVerdict(runs, maxLoad),
  };
  const out = resolve(options.out ?? join(build.out, "bench", reportName(target, tier)));
  writeBenchReport(report, out);
  return { report, out };
}

/** Write `bench.json` and `bench.md` into a folder. */
export function writeBenchReport(report: BenchReport, out: string): void {
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, BENCH_JSON), `${JSON.stringify(report, null, 2)}\n`);
  writeFileSync(join(out, BENCH_MD), benchMarkdown(report));
}
