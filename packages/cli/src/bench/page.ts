// SPDX-License-Identifier: Apache-2.0
/**
 * One run of `scenity bench` in headless Chromium. The run opens the player page (page/serve.ts), waits for the first
 * frame with every asset, drives the frames for a warm-up, and then reads the frame statistics of the player at the
 * start and at the end of the measure window.
 *
 * The core draws a frame only when something changes, so a still scene gives no frames in a plain play. The run drives
 * the frames, as the crowd test does with `__scenity.frame()`: with a sequence, each `seek` of the player
 * waits for one new frame of the core, at the wall clock time of the play (it loops at the end of the sequence); with
 * no sequence, `setCamera(null)` asks for a new frame of the same camera. At most one frame per display frame.
 *
 * The browser is the headless Chromium of page/browser.ts.
 *
 * The statistics of the core keep its last 600 frames. The player API reads them with no reset, so in a short run the
 * statistics also hold frames of the warm-up: the report gives both counts (`windowFrames`, `statsFrames`).
 */
import type { Browser, Page } from "@playwright/test";
import { PAGE_SETTLED, PAGE_STATE } from "../page/serve";
import type { BenchMeasure } from "./report";

/** The viewport of a run: a 16:9 page of 720p. */
const VIEWPORT = { width: 1280, height: 720 } as const;
/** The most frames in the statistics of the core (STATS_WINDOW of the scene core). */
const STATS_WINDOW = 600;
const SOFTWARE = /swiftshader|llvmpipe|softpipe|software|basic render/i;

export interface PageTiming {
  readonly warmupMs: number;
  readonly windowMs: number;
  /** The longest wait for the first frame. */
  readonly readyMs: number;
}

/** The frame statistics of the player (the fields of `SceneStats` that the bench reads) and its path. */
export interface PlayerStats {
  readonly frames?: number;
  readonly tier?: string;
  readonly workP50?: number;
  readonly workP95?: number;
  readonly intervalP50?: number;
  readonly intervalP95?: number;
  readonly drawCalls?: number;
  readonly triangles?: number;
  readonly instances?: number;
  readonly entities?: number;
  readonly visibleEntities?: number;
  readonly memory?: { geometries?: number; textures?: number; programs?: number; bytes?: number };
  readonly gpu?: { p95?: number } | null;
  readonly backend?: string;
  readonly renderer?: string | null;
  readonly fallbacks?: readonly { from: { backend: string }; to: { backend: string } | null; reason: string }[];
}

/** What the page gives besides the statistics. */
export interface PageInfo {
  readonly gpuName: string | null;
  readonly pageHeapMb: number | null;
}

const STATS_SCRIPT = `(async () => {
  const player = document.querySelector("scenity-player")?.player;
  if (!player) return null;
  const stats = await player.stats();
  const element = document.querySelector("scenity-player");
  // The worker statistics name no backend: the "ready" event of the player gives it (data-backend).
  const backend = stats.backend ?? element?.dataset.backend;
  return { ...stats, backend, renderer: player.renderer, fallbacks: player.fallbacks };
})()`;

/**
 * Drive the frames of the player for a time (ms). With a sequence, each seek waits for the frame of its time; with no
 * sequence the player has no clock, so `setCamera(null)` with the current camera asks for a new frame. One request per
 * display frame.
 */
function driveScript(ms: number): string {
  return `(async () => {
  const player = document.querySelector("scenity-player")?.player;
  if (!player) return 0;
  const start = performance.now();
  const from = player.time;
  let frames = 0;
  while (performance.now() - start < ${String(ms)}) {
    const t = from + performance.now() - start;
    const asked = player.duration > 0 ? player.seek(t % player.duration) : player.setCamera(null);
    // A core that draws no frame for 5 s does not stop the run.
    await Promise.race([asked, new Promise((done) => setTimeout(done, 5000))]);
    await new Promise((done) => requestAnimationFrame(done));
    frames += 1;
  }
  return frames;
})()`;
}

const INFO_SCRIPT = `(() => {
  const gl = document.createElement("canvas").getContext("webgl2") ?? document.createElement("canvas").getContext("webgl");
  const debug = gl?.getExtension("WEBGL_debug_renderer_info");
  const gpuName = gl ? String(gl.getParameter(debug ? debug.UNMASKED_RENDERER_WEBGL : gl.RENDERER)) : null;
  const heap = performance.memory?.usedJSHeapSize;
  return { gpuName, pageHeapMb: typeof heap === "number" ? Math.round(heap / 1048576 * 10) / 10 : null };
})()`;

function round(value: number | undefined, digits = 2): number {
  const scale = 10 ** digits;
  return Math.round((value ?? 0) * scale) / scale;
}

function orNull(value: number | undefined): number | null {
  return value ?? null;
}

/** The measure of a run from the statistics at the start and at the end of the window. */
export function toMeasure(
  first: PlayerStats,
  last: PlayerStats,
  readyMs: number,
  info: PageInfo,
  assetBytes: number,
): BenchMeasure {
  const frames = last.frames ?? 0;
  const gpu = last.gpu?.p95;
  return {
    drawn: last.backend ?? null,
    renderer: last.renderer ?? null,
    tier: last.tier ?? null,
    gpuName: info.gpuName,
    software: info.gpuName !== null && SOFTWARE.test(info.gpuName),
    firstFrameMs: round(readyMs, 0),
    frames,
    windowFrames: Math.max(0, frames - (first.frames ?? 0)),
    statsFrames: Math.min(frames, STATS_WINDOW),
    workP50: round(last.workP50),
    workP95: round(last.workP95),
    intervalP50: round(last.intervalP50),
    intervalP95: round(last.intervalP95),
    gpuP95Ms: gpu === undefined ? null : round(gpu),
    drawCalls: last.drawCalls ?? 0,
    triangles: last.triangles ?? 0,
    instances: orNull(last.instances),
    entities: orNull(last.entities),
    visibleEntities: orNull(last.visibleEntities),
    assetBytes,
    memory: {
      geometries: orNull(last.memory?.geometries),
      textures: orNull(last.memory?.textures),
      programs: orNull(last.memory?.programs),
      gpuBytes: orNull(last.memory?.bytes),
      pageHeapMb: info.pageHeapMb,
    },
    fallbacks: (last.fallbacks ?? []).map(
      (step) => `${step.from.backend} -> ${step.to?.backend ?? "none"}: ${step.reason}`,
    ),
  };
}

async function readStats(page: Page): Promise<PlayerStats> {
  const stats = await page.evaluate<PlayerStats | null>(STATS_SCRIPT);
  if (stats === null) throw new Error("the bench page has no player");
  return stats;
}

/** The result of a run: the measure, or the reason of the failure. */
export type PageResult = { readonly measure: BenchMeasure } | { readonly error: string };

/** Open the bench page at `url`, play and measure. `bytes` reads the asset bytes of the server since the load. */
export async function measurePage(
  browser: Browser,
  url: string,
  timing: PageTiming,
  bytes: () => number,
): Promise<PageResult> {
  const context = await browser.newContext({ viewport: VIEWPORT });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(url);
    await page.waitForFunction(PAGE_SETTLED, undefined, { timeout: timing.readyMs });
    const bench = await page.evaluate<{ ready: number | null; error: string | null }>(PAGE_STATE);
    if (bench.ready === null) return { error: bench.error ?? errors[0] ?? "no first frame" };
    await page.evaluate(driveScript(timing.warmupMs));
    const first = await readStats(page);
    await page.evaluate(driveScript(timing.windowMs));
    const last = await readStats(page);
    const info = await page.evaluate<PageInfo>(INFO_SCRIPT);
    return { measure: toMeasure(first, last, bench.ready, info, bytes()) };
  } catch (error) {
    return { error: error instanceof Error ? (error.message.split("\n")[0] ?? "error") : String(error) };
  } finally {
    await context.close();
  }
}
