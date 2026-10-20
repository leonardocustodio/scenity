// SPDX-License-Identifier: Apache-2.0
/**
 * The work loop of the indexer window.
 *
 * One step of the loop:
 * 1. Ask the shell for its state (on battery? the frame pace of the main window).
 * 2. Wait as the pacer tells (pacer.ts).
 * 3. Take one job of the host queue (`index.next`, renderer `indexer`).
 * 4. Load the lab frame with the scene options of the job when they change (frameSpec.ts).
 * 5. Draw the job with `runJob` of `index/indexJobs.ts`: the bridge call `indexJob`, the binary index frame and
 *    `index.done`. The shadow frame uses the same function.
 * With no job, the loop sleeps until the host reports queued jobs (`index.progress`) or 5 s pass. After a refused job,
 * it waits a moment (a scene that loads, a new build of the lab). Thus the host does not drop the first jobs of a new
 * frame after three quick failures. This module has no framework, so a test gives the parts.
 *
 * The render pool can borrow the lab frame (`lend`, poolWorker.ts). Then the loop ends its step (a wait ends at once)
 * and draws no job until `giveBack`. After `giveBack`, it loads its frame again.
 */
import type { FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { runJob, type JobDeps } from "../index/indexJobs";
import { frameUrl, specOf } from "./frameSpec";
import { Pacer, type MainPace, type PacerOptions, type ShellState } from "./pacer";

/** The sizes of the index. */
export const INDEXER_SIZES = [160, 640] as const;
/** The sleep of an empty queue before the next look (ms). */
export const IDLE_MS = 5_000;
/** The wait for the built lab of the host (ms). */
const NO_LAB_MS = 2_000;
/** A job that the frame refused for its scene options loads the frame again, at most this often (ms). */
const RELOAD_EVERY_MS = 30_000;
/**
 * The wait after a frame whose scene is not ready (its fog fades after the assets settle). Without it the loop gives
 * the first jobs back many times in 100 ms, and the host drops a job after three failures (a hole in the index).
 */
export const NOT_READY_MS = 500;
/**
 * The wait after a frame that refused a job for its scene options. Usually the host builds the lab again after an
 * edit (a new content hash, and the built lab is ready 1–2 s later). The next job loads the frame again after the
 * wait.
 */
export const REBUILD_WAIT_MS = 2_000;

/** What the loop does now. */
export type IndexerPhase = "no-lab" | "paused" | "yield" | "loading" | "drawing" | "idle" | "stopped" | "lent";

/** The state for the page and the measurement. */
export interface IndexerStatus {
  readonly phase: IndexerPhase;
  readonly reason: string | null;
  readonly done: number;
  readonly failed: number;
  readonly rate: number;
  readonly yields: number;
  /** The time of the last job (ms), or null. */
  readonly lastJobMs: number | null;
  /** The error of the last job that failed, or null. */
  readonly lastError: string | null;
  /** The last frame pace of the main window that the shell gave (the measurement reads the main window here). */
  readonly main: MainPace | null;
}

/** The parts of the loop. */
export interface IndexerParts extends Omit<JobDeps, "renderer" | "sizes"> {
  /** The URL of the built lab of the host (`SurfaceState.indexerUrl`), or null when it is not ready. */
  baseUrl(): string | null;
  /** Load the lab frame at a URL and wait until its scene is ready to draw. */
  load(url: string): Promise<void>;
  /** The state of the shell; `working` tells it whether the indexer has jobs. */
  shellState(working: boolean): Promise<ShellState>;
  /** Wait until the host reports jobs, or the time ends. */
  waitForWork(ms: number): Promise<void>;
  sleep(ms: number): Promise<void>;
  now(): number;
  onStatus?(status: IndexerStatus): void;
}

export class IndexerLoop {
  readonly #parts: IndexerParts;
  readonly #pacer: Pacer;
  #url: string | null = null;
  #working = false;
  #stopped = false;
  #running: Promise<void> | null = null;
  #lastReload = Number.NEGATIVE_INFINITY;
  #lastError: string | null = null;
  /** True while the render pool has the frame. */
  #lent = false;
  #resume: (() => void) | null = null;
  /** The end of the wait now (a lend ends it), or null. */
  #interrupt: (() => void) | null = null;
  /** The step now, or null. */
  #step: Promise<void> | null = null;
  #status: IndexerStatus = {
    phase: "idle",
    reason: null,
    done: 0,
    failed: 0,
    rate: 0,
    yields: 0,
    lastJobMs: null,
    lastError: null,
    main: null,
  };

  constructor(parts: IndexerParts, pacer: Partial<PacerOptions> = {}) {
    this.#parts = parts;
    this.#pacer = new Pacer(pacer);
  }

  get status(): IndexerStatus {
    return this.#status;
  }

  #set(change: Partial<IndexerStatus>): void {
    this.#status = { ...this.#status, rate: this.#pacer.rate, yields: this.#pacer.yields, ...change };
    this.#parts.onStatus?.(this.#status);
  }

  /** Run steps until `stop`. */
  start(): void {
    if (this.#running !== null) return;
    this.#stopped = false;
    this.#running = (async () => {
      while (!this.#stopped) {
        if (this.#lent) {
          await new Promise<void>((resolve) => (this.#resume = resolve));
          continue;
        }
        try {
          this.#step = this.step();
          await this.#step;
        } catch (error) {
          this.#set({ phase: "idle", reason: error instanceof Error ? error.message : String(error) });
          await this.#wait(this.#parts.sleep(NO_LAB_MS));
        } finally {
          this.#step = null;
        }
      }
      this.#set({ phase: "stopped" });
    })();
  }

  async stop(): Promise<void> {
    this.#stopped = true;
    this.#interrupt?.();
    this.#resume?.();
    await this.#running;
    this.#running = null;
  }

  /** True while the render pool has the frame. */
  get lent(): boolean {
    return this.#lent;
  }

  /**
   * Give the frame to the render pool. A wait of the loop ends at once. A job that draws now ends first. The
   * loop draws no job until `giveBack`.
   */
  async lend(): Promise<void> {
    this.#lent = true;
    this.#interrupt?.();
    await this.#step?.catch(() => undefined);
    this.#set({ phase: "lent", reason: "The render pool has the frame (a WebKit shot of a tool)." });
  }

  /** Take the frame back. The next job loads the frame again, because the pool loaded another lab into it. */
  giveBack(): void {
    if (!this.#lent) return;
    this.#lent = false;
    this.#url = null;
    this.#set({ phase: "idle", reason: null });
    const resume = this.#resume;
    this.#resume = null;
    resume?.();
  }

  /** A wait that a lend ends at once. */
  #wait(until: Promise<void>): Promise<void> {
    if (this.#lent || this.#stopped) return Promise.resolve();
    return new Promise<void>((resolve) => {
      this.#interrupt = resolve;
      void until.then(resolve, resolve);
    }).finally(() => {
      this.#interrupt = null;
    });
  }

  /** The job deps of `runJob`: the frame call keeps the last error (a refusal of the scene options). */
  #jobDeps(): JobDeps {
    const parts = this.#parts;
    return {
      request: (type, params) => parts.request(type, params),
      sendIndexFrame: (job, mime, bytes) => {
        parts.sendIndexFrame(job, mime, bytes);
      },
      callFrame: async (call, args, timeoutMs) => {
        try {
          return await parts.callFrame(call, args, timeoutMs);
        } catch (error) {
          this.#lastError = error instanceof Error ? error.message : String(error);
          throw error;
        }
      },
      renderer: "indexer",
      sizes: INDEXER_SIZES,
    };
  }

  /**
   * Load the frame for the scene options of a job when they differ from the frame now. A new content hash loads the
   * frame again too: the host serves a new build of the lab at the same URL.
   */
  async #frameFor(base: string, input: FrameKeyInput): Promise<void> {
    const url = frameUrl(base, specOf(input));
    const loaded = `${url}#${input.contentHash}`;
    if (loaded === this.#url) return;
    this.#set({ phase: "loading", reason: null });
    this.#url = null;
    await this.#parts.load(url);
    this.#url = loaded;
  }

  /** After a job that failed: wait for a scene that loads, or load a new build of the lab, or reload now and then. */
  async #afterFailure(): Promise<void> {
    const parts = this.#parts;
    const error = this.#lastError ?? "";
    if (error.includes("not ready")) {
      await this.#wait(parts.sleep(NOT_READY_MS));
      return;
    }
    if (error.includes("other scene options")) {
      this.#url = null;
      await this.#wait(parts.sleep(REBUILD_WAIT_MS));
      return;
    }
    if (parts.now() - this.#lastReload > RELOAD_EVERY_MS) {
      this.#lastReload = parts.now();
      this.#url = null;
    }
  }

  /** One step of the loop. */
  async step(): Promise<void> {
    const parts = this.#parts;
    const base = parts.baseUrl();
    if (base === null) {
      this.#set({ phase: "no-lab", reason: "The built lab of the host is not ready." });
      await this.#wait(parts.waitForWork(NO_LAB_MS));
      return;
    }
    const state = await parts.shellState(this.#working);
    if (state.main !== this.#status.main) this.#set({ main: state.main });
    const decision = this.#pacer.next(state, parts.now());
    if (decision.why === "paused" || decision.why === "yield") {
      this.#set({
        phase: decision.why,
        reason: decision.why === "paused" ? state.reason : "the main window drops frames",
      });
      await this.#wait(parts.sleep(decision.waitMs));
      return;
    }
    if (decision.waitMs > 0) await this.#wait(parts.sleep(decision.waitMs));
    if (this.#lent) return;
    const { jobs } = await parts.request("index.next", { renderer: "indexer", max: 1, sizes: INDEXER_SIZES });
    const job = jobs[0];
    if (job === undefined) {
      this.#working = false;
      this.#set({ phase: "idle", reason: null });
      await this.#wait(parts.waitForWork(IDLE_MS));
      return;
    }
    this.#working = true;
    await this.#frameFor(base, job.input);
    this.#set({ phase: "drawing", reason: null });
    const start = parts.now();
    this.#pacer.drew(start);
    this.#lastError = null;
    const outcome = await runJob(this.#jobDeps(), job);
    const lastJobMs = parts.now() - start;
    if (outcome === "done") {
      this.#set({ done: this.#status.done + 1, lastJobMs });
      return;
    }
    this.#set({ failed: this.#status.failed + 1, lastJobMs, reason: this.#lastError, lastError: this.#lastError });
    await this.#afterFailure();
  }
}
