// SPDX-License-Identifier: Apache-2.0
/**
 * The frame pace of the main window for the indexer window. While the indexer works, the shell sends the event
 * `labs-indexer` `{ active: true }` to the main window. The page then reads the frame statistics of its visible lab
 * frame once per second and gives them to the shell (`frame_pace`). The statistics (`stats(true)`) are the frames and
 * the 95th percentile of the frame interval since the last read. The indexer yields when the main window drops frames.
 * When the indexer is idle, the page reads nothing. A browser has no shell and no indexer window: nothing runs.
 */
import { invokeShell, listenShell, type ShellWindow } from "./shell";

/** The event of the shell (`indexer::ACTIVE_EVENT`). */
export const INDEXER_EVENT = "labs-indexer";
/** The report window (ms). */
export const PACE_PERIOD_MS = 1_000;

/** The pace of one report window. */
export interface FramePace {
  readonly frames: number;
  readonly p95Ms: number | null;
  readonly fps: number | null;
}

/** The pace of the statistics of one window of `elapsedMs` (null statistics: the lab drew nothing). */
export function paceOf(stats: unknown, elapsedMs: number): FramePace {
  const item = (typeof stats === "object" && stats !== null ? stats : {}) as {
    frames?: unknown;
    intervalP95?: unknown;
  };
  const frames = typeof item.frames === "number" && Number.isFinite(item.frames) ? Math.max(0, item.frames) : 0;
  if (frames === 0 || elapsedMs <= 0) return { frames: 0, p95Ms: null, fps: null };
  const p95 = typeof item.intervalP95 === "number" && Number.isFinite(item.intervalP95) ? item.intervalP95 : null;
  return { frames, p95Ms: p95, fps: (frames * 1000) / elapsedMs };
}

/** What the reporter reads: the statistics of the visible lab frame since the last read (`stats(true)`). */
export type ReadStats = () => Promise<unknown>;

export interface PaceOptions {
  readonly win?: ShellWindow;
  readonly now?: () => number;
  readonly periodMs?: number;
}

/** The reporter of the main window: it runs while the indexer is active. Give the stop function. */
export function startFramePace(readStats: ReadStats, options: PaceOptions = {}): () => void {
  const now = options.now ?? (() => performance.now());
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopListen: (() => void) | null = null;
  let stopped = false;
  let since = now();

  async function report(): Promise<void> {
    const stats = await readStats().catch(() => null);
    const at = now();
    const pace = paceOf(stats, at - since);
    since = at;
    await invokeShell("frame_pace", { pace }, options.win).catch(() => null);
  }

  function setActive(active: boolean): void {
    if (active && timer === null && !stopped) {
      // The first read starts a new window of the statistics.
      void readStats().catch(() => null);
      since = now();
      timer = setInterval(() => void report(), options.periodMs ?? PACE_PERIOD_MS);
    } else if (!active && timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  void listenShell(
    INDEXER_EVENT,
    (payload) => {
      setActive(typeof payload === "object" && payload !== null && (payload as { active?: unknown }).active === true);
    },
    options.win,
  ).then((stop) => {
    if (stopped) stop?.();
    else stopListen = stop;
  });

  return () => {
    stopped = true;
    setActive(false);
    stopListen?.();
  };
}
