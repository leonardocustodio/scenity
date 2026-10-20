// SPDX-License-Identifier: Apache-2.0
/**
 * The lab page alone fills its own index. Without the workbench host, the page renders the frames of the open take at
 * idle time (startIdleRunner of `@scenity/labs-platform/idle`). It does one job per idle slot and keeps the frames in
 * its store (OPFS or IndexedDB). It works only after the actions of the user. It starts no job within QUIET_MS of a
 * pointer, key or wheel input. It starts no job when the page draws below 55 fps or is hidden. The order is the same
 * as the queue of the host: first the overview (1 s), then the window around the clock, then the full take at 100 ms,
 * then the 640 px frames at 1 s.
 */
import { frameKey, type FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { startIdleRunner, type IdleRunner, type IdleState, type StepResult } from "@scenity/labs-platform/idle";
import type { IndexStore, IndexMime } from "@scenity/labs-platform/indexStore";
import { INDEX_MIMES } from "@scenity/labs-platform/indexStore";
import { INDEX_SIZES, OVERVIEW_MS, STEP_MS } from "./frameInput";
import { JobRefused, type RenderedJob } from "./renderJob";

/** No job within this time after an input of the user (ms). */
export const QUIET_MS = 1500;
/** Half the window around the clock (ms), the same as in the queue of the host (rank 1). */
export const WINDOW_MS = 2000;

/** One job of the order: a time and a width. */
export interface FillJob {
  readonly timeMs: number;
  readonly size: number;
}

/** The order of the jobs of a take of `durationMs` with the clock at `clockMs`. */
export function fillOrder(durationMs: number, clockMs: number): FillJob[] {
  const end = Math.max(0, Math.round(durationMs));
  const [small, large] = INDEX_SIZES;
  const jobs: FillJob[] = [];
  const seen = new Set<string>();
  const add = (timeMs: number, size: number): void => {
    const id = `${String(timeMs)}|${String(size)}`;
    if (timeMs < 0 || timeMs > end || seen.has(id)) return;
    seen.add(id);
    jobs.push({ timeMs, size });
  };
  for (let at = 0; at <= end; at += OVERVIEW_MS) add(at, small);
  const near = Math.round(clockMs / STEP_MS) * STEP_MS;
  const window: number[] = [];
  for (let at = near - WINDOW_MS; at <= near + WINDOW_MS; at += STEP_MS) window.push(at);
  window.sort((a, b) => Math.abs(a - clockMs) - Math.abs(b - clockMs) || a - b);
  for (const at of window) add(at, small);
  for (let at = 0; at <= end; at += STEP_MS) add(at, small);
  for (let at = 0; at <= end; at += OVERVIEW_MS) add(at, large);
  return jobs;
}

/** What the fill needs of the page. */
export interface FillParts {
  readonly store: IndexStore;
  /** The input of the page at time 0 with the current view, or null when the page has no index (a live session). */
  readonly page: () => FrameKeyInput | null;
  readonly durationMs: () => number;
  readonly clockMs: () => number;
  readonly render: (input: FrameKeyInput, size: number) => Promise<RenderedJob>;
  /** True when the user did nothing for QUIET_MS. */
  readonly quiet: () => boolean;
  /** The frame rate of the visible scene, or null. */
  readonly fps: () => number | null;
  /** After each new frame of the store. */
  readonly stored?: (job: FillJob) => void;
  readonly onState?: (state: IdleState) => void;
}

function isIndexMime(mime: string): mime is IndexMime {
  return Object.hasOwn(INDEX_MIMES, mime);
}

/** The jobs of one page input and clock window, with the keys made once (a key costs a SHA-256 of the events). */
class FillCursor {
  readonly signature: string;
  readonly #jobs: FillJob[];
  readonly #page: FrameKeyInput;
  readonly #keys = new Map<number, string>();
  #at = 0;

  constructor(signature: string, page: FrameKeyInput, jobs: FillJob[]) {
    this.signature = signature;
    this.#page = page;
    this.#jobs = jobs;
  }

  input(timeMs: number): FrameKeyInput {
    return { ...this.#page, timeMs };
  }

  #key(timeMs: number): string {
    let key = this.#keys.get(timeMs);
    if (key === undefined) {
      key = frameKey(this.input(timeMs));
      this.#keys.set(timeMs, key);
    }
    return key;
  }

  /** The next job that the store does not have, or null. */
  async next(store: IndexStore): Promise<FillJob | null> {
    while (this.#at < this.#jobs.length) {
      const job = this.#jobs[this.#at];
      if (job === undefined) break;
      if (!(await store.has(this.#key(job.timeMs), job.size))) return job;
      this.#at += 1;
    }
    return null;
  }

  /** Skip a job (done or refused). */
  skip(): void {
    this.#at += 1;
  }
}

/** The step of the fill: one job of the order that the store does not have (a test runs it without the runner). */
export function createFillStep(parts: FillParts): () => Promise<StepResult> {
  let cursor: FillCursor | null = null;

  function cursorNow(page: FrameKeyInput): FillCursor {
    const duration = parts.durationMs();
    const near = Math.round(parts.clockMs() / WINDOW_MS);
    const signature = `${frameKey(page)}|${String(duration)}|${String(near)}`;
    if (cursor?.signature !== signature) {
      cursor = new FillCursor(signature, page, fillOrder(duration, parts.clockMs()));
    }
    return cursor;
  }

  async function step(): Promise<StepResult> {
    const page = parts.page();
    if (page === null || !parts.quiet()) return "idle";
    const current = cursorNow(page);
    const job = await current.next(parts.store);
    if (job === null) return "idle";
    try {
      const rendered = await parts.render(current.input(job.timeMs), job.size);
      if (!isIndexMime(rendered.mime)) throw new JobRefused(`The picture type ${rendered.mime} is not for the index.`);
      await parts.store.put({
        input: current.input(job.timeMs),
        size: job.size,
        mime: rendered.mime,
        bytes: new Uint8Array(rendered.bytes),
        metrics: rendered.metrics,
        reads: rendered.reads ?? null,
      });
      current.skip();
      parts.stored?.(job);
      return "more";
    } catch (error) {
      // A refused job stays for a later step (a scene that loads, other options). A failed render skips the job.
      if (!(error instanceof JobRefused)) current.skip();
      return "idle";
    }
  }
  return step;
}

/** Start the fill of the lab page alone. */
export function startSelfFill(parts: FillParts): IdleRunner {
  return startIdleRunner({
    step: createFillStep(parts),
    fps: parts.fps,
    idleMs: 1000,
    ...(parts.onState === undefined ? {} : { onState: parts.onState }),
  });
}
