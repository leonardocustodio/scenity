// SPDX-License-Identifier: Apache-2.0
/**
 * The pace of the indexer window: how long the indexer waits before its next draw. This module has no side effects,
 * so a test gives the reports.
 *
 * - A frame cap: at most `capFps` draws per second.
 * - Yield to the main window: the main page reports the frames and the 95th percentile of the frame interval of its
 *   lab once per second (`frame_pace`, desktop/framePace.ts). A report says that the main lab suffers when three
 *   conditions are true. The main lab draws. It misses the target (a p95 above `yieldP95Ms`, or a rate under
 *   `minMainFps`). The default `yieldP95Ms` is 17.5 ms: one frame at 60 Hz and a margin. The report is also worse than
 *   its own baseline with a margin. The baseline is the last report of a second without a draw of the indexer. A
 *   report that suffers pauses the indexer for one second (the next report is a new baseline) and halves its rate. A
 *   good report increases the rate step by step. Thus a main window that is slow for another reason (a loaded machine,
 *   a window that covers part of it) does not stop the index. And a main window that the indexer slows gets its frames
 *   back. A main window that draws nothing (a stopped clock, another tab, covered) gives the full cap.
 * - A paused shell state (on battery, low power mode, the setting `off`) waits `pausedMs` and asks again.
 */

/** The pace of the main window in its last report window (`indexer::Pace` of the shell). */
export interface MainPace {
  readonly frames: number;
  readonly p95Ms: number | null;
  readonly fps: number | null;
}

/** What the shell answers to `indexer_state`. */
export interface ShellState {
  readonly run: boolean;
  readonly reason: string | null;
  readonly main: MainPace | null;
  /** The number of the pace reports so far: a new number is a new report. */
  readonly report: number;
}

export interface PacerOptions {
  /** The most draws per second. */
  readonly capFps: number;
  /** The fewest draws per second after a yield. */
  readonly floorFps: number;
  /** The rate goes up by this step after each good report. */
  readonly stepFps: number;
  /** A main p95 above this time misses the target (ms). */
  readonly yieldP95Ms: number;
  /** A main frame rate under this rate misses the target. */
  readonly minMainFps: number;
  /** A main report with fewer frames says that the main lab does not draw. */
  readonly minMainFrames: number;
  /** The margins over the baseline of the main window: frames per second, and the p95 in ms. */
  readonly fpsMargin: number;
  readonly p95MarginMs: number;
  /** The wait of a paused indexer before it asks again (ms). */
  readonly pausedMs: number;
}

export const PACER_DEFAULTS: PacerOptions = {
  capFps: 30,
  floorFps: 2,
  stepFps: 4,
  yieldP95Ms: 17.5,
  minMainFps: 55,
  minMainFrames: 10,
  fpsMargin: 3,
  p95MarginMs: 1.5,
  pausedMs: 5_000,
};

/** The decision of the pacer: wait this long, and why. */
export interface PaceDecision {
  readonly waitMs: number;
  readonly why: "draw" | "cap" | "yield" | "paused";
}

/** True when a report says that the main lab draws and misses the target (a p95 too long or a rate too low). */
export function mainMisses(main: MainPace | null, options: PacerOptions = PACER_DEFAULTS): boolean {
  if (main === null || main.frames < options.minMainFrames) return false;
  const slow = main.p95Ms !== null && main.p95Ms > options.yieldP95Ms;
  const few = main.fps !== null && main.fps < options.minMainFps;
  return slow || few;
}

/** True when a report is worse than the baseline of the main window (no baseline: worse). */
export function worseThan(main: MainPace, baseline: MainPace | null, options: PacerOptions = PACER_DEFAULTS): boolean {
  if (baseline === null) return true;
  const fps = main.fps !== null && baseline.fps !== null && main.fps < baseline.fps - options.fpsMargin;
  const p95 = main.p95Ms !== null && baseline.p95Ms !== null && main.p95Ms > baseline.p95Ms + options.p95MarginMs;
  return fps || p95;
}

export class Pacer {
  readonly options: PacerOptions;
  /** The draws per second now. */
  #rate: number;
  #lastDraw = Number.NEGATIVE_INFINITY;
  /** The number of the last report that the pacer used (a report counts once). */
  #seen = -1;
  /** True when the indexer drew since the last report. */
  #drewSinceReport = false;
  /** The pace of the main window in the last second without a draw of the indexer. */
  #baseline: MainPace | null = null;
  /** No draw before this time (a yield). */
  #pausedUntil = Number.NEGATIVE_INFINITY;
  #yields = 0;

  constructor(options: Partial<PacerOptions> = {}) {
    this.options = { ...PACER_DEFAULTS, ...options };
    this.#rate = this.options.capFps;
  }

  get rate(): number {
    return this.#rate;
  }

  /** The count of yields since the start. */
  get yields(): number {
    return this.#yields;
  }

  /** The pace of the main window without the indexer, or null. */
  get baseline(): MainPace | null {
    return this.#baseline;
  }

  /** Read a new report of the main window once. */
  #read(main: MainPace | null, report: number, now: number): void {
    const { capFps, floorFps, stepFps } = this.options;
    // No fresh report (the main page stopped to report: it draws nothing): the full cap.
    if (main === null) {
      this.#rate = capFps;
      return;
    }
    if (report === this.#seen) return;
    this.#seen = report;
    const quiet = !this.#drewSinceReport;
    this.#drewSinceReport = false;
    if (main.frames < this.options.minMainFrames) {
      this.#rate = capFps;
      return;
    }
    if (quiet) this.#baseline = main;
    if (!quiet && mainMisses(main, this.options) && worseThan(main, this.#baseline, this.options)) {
      this.#rate = Math.max(floorFps, this.#rate / 2);
      this.#pausedUntil = now + 1000;
      this.#yields += 1;
      return;
    }
    this.#rate = Math.min(capFps, this.#rate + stepFps);
  }

  /** The wait before the next draw with the shell state now. */
  next(state: ShellState, now: number): PaceDecision {
    if (!state.run) return { waitMs: this.options.pausedMs, why: "paused" };
    this.#read(state.main, state.report, now);
    if (now < this.#pausedUntil) return { waitMs: this.#pausedUntil - now, why: "yield" };
    const gap = this.#lastDraw + 1000 / this.#rate - now;
    return gap > 0 ? { waitMs: gap, why: "cap" } : { waitMs: 0, why: "draw" };
  }

  /** A draw starts now. */
  drew(now: number): void {
    this.#lastDraw = now;
    this.#drewSinceReport = true;
  }
}
