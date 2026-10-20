// SPDX-License-Identifier: Apache-2.0
/**
 * The idle runner of the frame index: the browser path of the indexer. The shadow frame of the workbench and the lab
 * page alone do index jobs only at idle time:
 *
 * - one job per idle slot (`requestIdleCallback`), and only when the slot has at least 4 ms left. The page work of a
 *   job (the input, the message to the renderer, the bytes to the store or the host) stays in the slot. The render
 *   runs in the render worker.
 * - no job while the visible page draws below 55 fps (the frame rate source of the caller, else the animation frames
 *   of this page), or while the window is hidden. The runner examines the page again after a pause.
 *
 * Browser code without a framework. A test gives a fake host.
 */

/** The page work of one idle slot: at most this time (ms). */
export const SLOT_BUDGET_MS = 4;
/** The lowest frame rate of the visible page while the indexer works. */
export const MIN_FPS = 55;
/** The wait before the next check after a pause (ms). */
export const PAUSE_MS = 1000;

/** The answer of a step: a job ran ("more"), no job at this time ("idle": try again later), or stop ("done"). */
export type StepResult = "more" | "idle" | "done";

/** The parts of the page that the runner uses (a test gives a fake). */
export interface IdleHost {
  requestIdleCallback?(
    callback: (deadline: { timeRemaining(): number }) => void,
    options?: { timeout: number },
  ): number;
  cancelIdleCallback?(handle: number): void;
  requestAnimationFrame(callback: (time: number) => void): number;
  cancelAnimationFrame(handle: number): void;
  setTimeout(callback: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  readonly document?: { readonly visibilityState?: string };
  readonly performance: { now(): number };
}

/** Why the runner waits at this time. */
export type IdleState = "running" | "hidden" | "slow" | "idle" | "stopped";

export interface IdleOptions {
  /** One job; the runner waits for the promise before the next slot. */
  readonly step: () => Promise<StepResult>;
  readonly host?: IdleHost;
  /** The frame rate of the visible page, or null when unknown. Default: the animation frames of this page. */
  readonly fps?: () => number | null;
  readonly minFps?: number;
  readonly slotMs?: number;
  readonly pauseMs?: number;
  /** The wait after an "idle" step (ms; default 2 s). */
  readonly idleMs?: number;
  /** Called at each change of the state. */
  readonly onState?: (state: IdleState) => void;
}

export interface IdleRunner {
  readonly state: () => IdleState;
  /** The page time of each step before its first wait (ms; the work in the slot). */
  readonly slotTimes: () => readonly number[];
  /** The count of jobs that ran ("more"). */
  readonly jobs: () => number;
  /** Check again at once (a new job came). */
  wake(): void;
  stop(): void;
}

/** The frame rate of the animation frames of a page over the last second. */
export class FpsMeter {
  readonly #host: IdleHost;
  readonly #times: number[] = [];
  #handle = 0;
  #running = false;

  constructor(host: IdleHost) {
    this.#host = host;
  }

  start(): void {
    if (this.#running) return;
    this.#running = true;
    const tick = (time: number): void => {
      if (!this.#running) return;
      this.#times.push(time);
      while (this.#times.length > 0 && time - (this.#times[0] ?? time) > 1000) this.#times.shift();
      this.#handle = this.#host.requestAnimationFrame(tick);
    };
    this.#handle = this.#host.requestAnimationFrame(tick);
  }

  stop(): void {
    this.#running = false;
    this.#host.cancelAnimationFrame(this.#handle);
    this.#times.length = 0;
  }

  /** Frames per second over the last second, or null with fewer than 10 frames. */
  fps(): number | null {
    const times = this.#times;
    if (times.length < 10) return null;
    const span = (times.at(-1) ?? 0) - (times[0] ?? 0);
    return span > 0 ? ((times.length - 1) * 1000) / span : null;
  }
}

/** The host of a page: the globals of the browser. */
export function pageHost(): IdleHost {
  return globalThis;
}

type Deadline = { timeRemaining(): number };

/** The loop of a runner: the idle slots, the pauses and the steps. */
class IdleLoop implements IdleRunner {
  readonly #options: IdleOptions;
  readonly #host: IdleHost;
  readonly #meter: FpsMeter | null;
  readonly #slots: number[] = [];
  #state: IdleState = "running";
  #jobs = 0;
  #timer: unknown = null;
  #idle: number | null = null;
  #busy = false;

  constructor(options: IdleOptions) {
    this.#options = options;
    this.#host = options.host ?? pageHost();
    this.#meter = options.fps === undefined ? new FpsMeter(this.#host) : null;
    this.#meter?.start();
  }

  state = (): IdleState => this.#state;
  slotTimes = (): readonly number[] => [...this.#slots];
  jobs = (): number => this.#jobs;

  #fps(): number | null {
    return this.#options.fps === undefined ? (this.#meter?.fps() ?? null) : this.#options.fps();
  }

  #set(next: IdleState): void {
    if (this.#state === next) return;
    this.#state = next;
    this.#options.onState?.(next);
  }

  #later(ms: number): void {
    if (this.#state === "stopped") return;
    this.#timer = this.#host.setTimeout(() => {
      this.#timer = null;
      this.schedule();
    }, ms);
  }

  schedule(): void {
    if (this.#state === "stopped" || this.#busy || this.#timer !== null || this.#idle !== null) return;
    const run = (deadline: Deadline): void => {
      this.#idle = null;
      void this.#slot(deadline);
    };
    const host = this.#host;
    if (host.requestIdleCallback === undefined) {
      // WebKit before 26 has no idle callbacks. Use a short timer after the next animation frame.
      host.requestAnimationFrame(() => {
        this.#timer = host.setTimeout(() => {
          this.#timer = null;
          run({ timeRemaining: () => (this.#options.slotMs ?? SLOT_BUDGET_MS) + 1 });
        }, 1);
      });
      return;
    }
    this.#idle = host.requestIdleCallback(run, { timeout: 1000 });
  }

  /** The reason to wait at this time, or null when a step can run. */
  #pause(deadline: Deadline): IdleState | "short" | null {
    if (this.#host.document?.visibilityState === "hidden") return "hidden";
    const rate = this.#fps();
    if (rate !== null && rate < (this.#options.minFps ?? MIN_FPS)) return "slow";
    return deadline.timeRemaining() < (this.#options.slotMs ?? SLOT_BUDGET_MS) ? "short" : null;
  }

  async #slot(deadline: Deadline): Promise<void> {
    if (this.#state === "stopped") return;
    const pause = this.#pause(deadline);
    if (pause === "short") {
      this.schedule();
      return;
    }
    if (pause !== null) {
      this.#set(pause);
      this.#later(this.#options.pauseMs ?? PAUSE_MS);
      return;
    }
    this.#set("running");
    this.#done(await this.#step());
  }

  /** Run one step; the page time before its first wait goes into the slot times. */
  async #step(): Promise<StepResult> {
    this.#busy = true;
    const start = this.#host.performance.now();
    try {
      const pending = this.#options.step();
      this.#slots.push(this.#host.performance.now() - start);
      if (this.#slots.length > 500) this.#slots.shift();
      return await pending;
    } catch {
      return "idle";
    } finally {
      this.#busy = false;
    }
  }

  #done(result: StepResult): void {
    if (result === "done") {
      this.stop();
    } else if (result === "more") {
      this.#jobs += 1;
      this.schedule();
    } else {
      this.#set("idle");
      this.#later(this.#options.idleMs ?? 2000);
    }
  }

  wake(): void {
    if (this.#state === "stopped" || this.#busy) return;
    if (this.#timer !== null) this.#host.clearTimeout(this.#timer);
    this.#timer = null;
    this.schedule();
  }

  stop(): void {
    if (this.#timer !== null) this.#host.clearTimeout(this.#timer);
    if (this.#idle !== null) this.#host.cancelIdleCallback?.(this.#idle);
    this.#timer = null;
    this.#idle = null;
    this.#meter?.stop();
    this.#set("stopped");
  }
}

/** Start a runner: it takes jobs at idle time until `stop` or a "done" step. */
export function startIdleRunner(options: IdleOptions): IdleRunner {
  const loop = new IdleLoop(options);
  loop.schedule();
  return loop;
}
