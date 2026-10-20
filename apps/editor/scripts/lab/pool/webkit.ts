// SPDX-License-Identifier: Apache-2.0
/**
 * The WebKit engine of the render pool. The pages of this engine are the hidden indexer windows of Scenity (WKWebView, the real engine of
 * the app), not pages of a browser that the pool starts. An indexer page that knows the pool (`SurfaceState.indexerWorker` of the host) asks the pool for commands
 * (`POST /__pool/webkit/poll`, a long poll) and sends each answer (`POST /__pool/webkit/answer`). Refer to webkitApi.ts and
 * apps/workbench `src/indexer/poolWorker.ts`.
 *
 * A lease of this engine lends the lab frame of one indexer window to one tool run: the indexer stops its index jobs,
 * loads the lab of the page spec and draws the shots of the tool through the workbench bridge of the lab (seek, camera,
 * `frame`, `measure`, `capture` as PNG). The release returns the frame to the indexer. The lease holds the GPU lock
 * as a lease of the Chromium pages does. A lease of a spec that the frame has already (the same lab, the same build)
 * is warm: no page load.
 *
 * The WebKit pages draw shots only: a script in the page (`evaluate`), a sheet and a WebP frame need a Chromium page.
 */
import type { CameraView } from "@scenity/runtime/framing";
import type { MetricValue } from "../../../src/plugins";
import type { LabFrame } from "../../../src/core/useLabApi";
import { labQuery, type LabShooter, type ShooterOptions, type Shot } from "../shooter";
import type { BuildInfo } from "./builtLab";
import type { Lease, PageSpec } from "./pages";
import { specKey } from "./pages";
import { packPicture, unpackPicture } from "@scenity/labs-platform/poolWire";

/** The engines of the pool. */
export const POOL_ENGINES = ["chromium", "webkit"] as const;
export type PoolEngine = (typeof POOL_ENGINES)[number];

/** The code of the refusal when no indexer window lends its frame (the HTTP status 503). */
export const NO_WEBKIT_WORKER = "no-webkit-worker";
/** The code of the refusal of a call that the WebKit pages do not have. */
export const NOT_ON_WEBKIT = "not-on-webkit";

/** A refusal of the pool with a code: the API sends the code, so a tool can choose another path. */
export class PoolRefusal extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 409,
  ) {
    super(message);
  }
}

/** The longest wait of a poll without a command (ms). The page then asks again. */
export const POLL_WAIT_MS = 20_000;
/** A worker without a poll for this time is gone (ms). */
const WORKER_GONE_MS = 30_000;
/** The wait for a first worker when no worker polls (ms). An indexer page polls again immediately after each answer. */
const WORKER_WAIT_MS = 3_000;
/** The time limits of the answers (ms): a page load of the lab, a shot, the return of the frame. */
const OPEN_TIMEOUT_MS = 120_000;
const SHOT_TIMEOUT_MS = 60_000;
const CLOSE_TIMEOUT_MS = 10_000;

/** What an indexer page says of itself in a poll. */
export interface WorkerInfo {
  /** The user agent of the page (the WebKit version). */
  readonly agent: string;
  /** The place of the page (`indexer`). */
  readonly place: string;
}

/** A command to a worker. `open` loads the lab of a spec; `shot` draws one frame; `close` returns the frame. */
export type WorkerCommand =
  | {
      readonly id: number;
      readonly kind: "open";
      readonly lease: string;
      /** The query of the lab (`labQuery` of the spec at the first time and camera). */
      readonly query: string;
      /** The key of the lab in the frame: the same key and the same build is a warm frame. */
      readonly key: string;
      readonly build: number;
    }
  | {
      readonly id: number;
      readonly kind: "shot";
      readonly lease: string;
      readonly at: number;
      readonly camera: string | CameraView;
      readonly width: number;
      readonly height: number;
    }
  | { readonly id: number; readonly kind: "close"; readonly lease: string };

/** The head of the answer of a shot. */
export interface ShotHead {
  readonly ok: true;
  readonly simMs: number | null;
  readonly frame: LabFrame;
  readonly metrics: readonly MetricValue[];
}

/** The commands of a worker without their ID and lease. */
type CommandBody =
  | Omit<Extract<WorkerCommand, { kind: "open" }>, "id" | "lease">
  | Omit<Extract<WorkerCommand, { kind: "shot" }>, "id" | "lease">
  | Omit<Extract<WorkerCommand, { kind: "close" }>, "id" | "lease">;

interface Worker {
  readonly id: string;
  info: WorkerInfo;
  seen: number;
  readonly queue: WorkerCommand[];
  /** The poll that waits for a command, or null. */
  poll: ((command: WorkerCommand | null) => void) | null;
  /** The lease of the frame, or null when the indexer has it. */
  lease: string | null;
}

interface Waiting {
  readonly worker: string;
  readonly resolve: (answer: { head: Record<string, unknown>; bytes: Buffer }) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

export interface WebKitPagesOptions {
  readonly build: () => Promise<BuildInfo>;
  /** Take the GPU lock; give the release function (`sharedLock`, so the two engines hold one lock). */
  readonly lock: () => Promise<() => void>;
  readonly log?: (line: string) => void;
  readonly now?: () => number;
  /** The wait for a first worker (ms; the tests give less). */
  readonly workerWaitMs?: number;
}

/**
 * One GPU lock for the leases of both engines: the first holder takes the lock of the machine, and the last holder
 * releases it. A failure to take it holds nothing.
 */
export function sharedLock(take: () => Promise<() => void>): () => Promise<() => void> {
  let holders = 0;
  let held: Promise<() => void> | null = null;
  return async () => {
    holders += 1;
    const taking = (held ??= take());
    try {
      await taking;
    } catch (error) {
      holders -= 1;
      if (held === taking) held = null;
      throw error;
    }
    let done = false;
    return () => {
      if (done) return;
      done = true;
      holders -= 1;
      if (holders > 0 || held === null) return;
      const release = held;
      held = null;
      void release.then(
        (give) => give(),
        () => undefined,
      );
    };
  };
}

let leaseNumber = 0;

export class WebKitPages {
  readonly #options: WebKitPagesOptions;
  readonly #workers = new Map<string, Worker>();
  readonly #answers = new Map<number, Waiting>();
  readonly #leases = new Map<string, { lease: Lease; worker: Worker; unlock: () => void }>();
  readonly #free: (() => void)[] = [];
  #next = 1;
  #stopped = false;

  constructor(options: WebKitPagesOptions) {
    this.#options = options;
  }

  #now(): number {
    return (this.#options.now ?? (() => performance.now()))();
  }

  #alive(worker: Worker): boolean {
    return worker.poll !== null || this.#now() - worker.seen < WORKER_GONE_MS;
  }

  /** The workers and the leases (`GET /__pool/status`). */
  status() {
    return {
      workers: [...this.#workers.values()]
        .filter((worker) => this.#alive(worker))
        .map((worker) => ({ id: worker.id, agent: worker.info.agent, busy: worker.lease !== null })),
      leases: this.#leases.size,
    };
  }

  /**
   * A poll of a worker: the next command, or null after `waitMs` without one. A new poll ends an older one. An abort
   * (the connection of the poll closed) ends it too.
   */
  poll(id: string, info: WorkerInfo, waitMs = POLL_WAIT_MS, signal?: AbortSignal): Promise<WorkerCommand | null> {
    let worker = this.#workers.get(id);
    if (worker === undefined) {
      worker = { id, info, seen: this.#now(), queue: [], poll: null, lease: null };
      this.#workers.set(id, worker);
      this.#options.log?.(`a WebKit worker polls (${info.place}, ${info.agent.slice(0, 80)})`);
      this.#wake();
    }
    worker.info = info;
    worker.seen = this.#now();
    worker.poll?.(null);
    worker.poll = null;
    const next = worker.queue.shift();
    if (next !== undefined || this.#stopped) return Promise.resolve(next ?? null);
    const current = worker;
    const now = (): number => this.#now();
    return new Promise((resolve) => {
      const timer = setTimeout(() => finish(null), waitMs);
      const onAbort = (): void => finish(null);
      signal?.addEventListener("abort", onAbort, { once: true });
      function finish(command: WorkerCommand | null): void {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        if (current.poll === finish) current.poll = null;
        current.seen = now();
        resolve(command);
      }
      current.poll = finish;
    });
  }

  /** Return a command to the front of the queue of its worker (a poll whose connection closed before the answer). */
  requeue(id: string, command: WorkerCommand): void {
    const worker = this.#workers.get(id);
    if (worker === undefined) return;
    if (worker.poll !== null) worker.poll(command);
    else worker.queue.unshift(command);
  }

  /** The answer of a worker to a command (a body of `packPicture`). False for an unknown command. */
  answer(worker: string, command: number, body: Uint8Array): boolean {
    const waiting = this.#answers.get(command);
    if (waiting?.worker !== worker) return false;
    this.#answers.delete(command);
    clearTimeout(waiting.timer);
    try {
      const { head, bytes } = unpackPicture(body);
      const value = head as Record<string, unknown>;
      if (value.ok === true) waiting.resolve({ head: value, bytes });
      else waiting.reject(new Error(typeof value.error === "string" ? value.error : "The WebKit page refused."));
    } catch (error) {
      waiting.reject(error instanceof Error ? error : new Error(String(error)));
    }
    return true;
  }

  /** Send a command to a worker and wait for its answer. */
  send(
    worker: Worker,
    lease: string,
    body: CommandBody,
    timeoutMs: number,
  ): Promise<{ head: Record<string, unknown>; bytes: Buffer }> {
    const command = { ...body, id: this.#next++, lease } as WorkerCommand;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.#answers.delete(command.id);
        reject(new Error(`The WebKit page gave no answer to "${command.kind}" in ${String(timeoutMs / 1000)} s.`));
      }, timeoutMs);
      this.#answers.set(command.id, { worker: worker.id, resolve, reject, timer });
      if (worker.poll !== null) worker.poll(command);
      else worker.queue.push(command);
    });
  }

  #wake(): void {
    for (const resolve of this.#free.splice(0)) resolve();
  }

  /** A free live worker. Wait while each live worker has a lease, and refuse when no worker polls. */
  async #take(): Promise<Worker> {
    const end = this.#now() + (this.#options.workerWaitMs ?? WORKER_WAIT_MS);
    for (;;) {
      if (this.#stopped) throw new Error("The render pool stopped.");
      const live = [...this.#workers.values()].filter((worker) => this.#alive(worker));
      const free = live.find((worker) => worker.lease === null);
      if (free !== undefined) return free;
      if (live.length === 0 && this.#now() > end) {
        throw new PoolRefusal(
          NO_WEBKIT_WORKER,
          "No WebKit page: the indexer window of Scenity lends it (the app runs, SCENITY_LABS_INDEXER is not off).",
          503,
        );
      }
      // A busy worker frees at a release; a new worker comes with its first poll.
      await new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, live.length === 0 ? 100 : 1_000);
        this.#free.push(() => {
          clearTimeout(timer);
          resolve();
        });
      });
    }
  }

  /** Lease the frame of an indexer window with the lab of a spec at a first time and camera. */
  async lease(spec: PageSpec, at: number, camera: string): Promise<Lease> {
    if (this.#stopped) throw new Error("The render pool stopped.");
    const build = await this.#options.build();
    const worker = await this.#take();
    leaseNumber += 1;
    const id = `w${String(leaseNumber)}-${Math.random().toString(16).slice(2, 10)}`;
    worker.lease = id;
    const asked = this.#now();
    let unlock: (() => void) | null = null;
    try {
      unlock = await this.#options.lock();
      const locked = this.#now();
      const options: ShooterOptions = { ...spec, origin: "" };
      const query = labQuery(options, at, camera).toString();
      const opened = await this.send(
        worker,
        id,
        { kind: "open", query, key: specKey(spec), build: build.id },
        OPEN_TIMEOUT_MS,
      );
      const lease: Lease = {
        id,
        shooter: new WebKitShooter(this, worker, id, options),
        dirty: false,
        shots: new Map(),
        lastCall: this.#now(),
        warm: opened.head.warm === true,
        lockMs: Math.round(locked - asked),
        openMs: Math.round(this.#now() - locked),
      };
      this.#leases.set(id, { lease, worker, unlock });
      return lease;
    } catch (error) {
      unlock?.();
      worker.lease = null;
      // The frame returns to the indexer, also after a failed load.
      void this.send(worker, id, { kind: "close" }, CLOSE_TIMEOUT_MS).catch(() => null);
      this.#wake();
      throw error;
    }
  }

  /** The lease of an ID, or null. A call marks the time of its last use. */
  get(id: string): Lease | null {
    const entry = this.#leases.get(id);
    if (entry === undefined) return null;
    entry.lease.lastCall = this.#now();
    return entry.lease;
  }

  /** End a lease: the frame returns to the indexer, then the lease releases the lock. */
  async release(id: string): Promise<void> {
    const entry = this.#leases.get(id);
    if (entry === undefined) return;
    this.#leases.delete(id);
    try {
      await this.send(entry.worker, id, { kind: "close" }, CLOSE_TIMEOUT_MS);
    } catch (error) {
      this.#options.log?.(
        `a WebKit page did not take its frame back: ${error instanceof Error ? error.message : String(error)}`,
      );
    } finally {
      entry.worker.lease = null;
      entry.unlock();
      this.#wake();
    }
  }

  /** End the leases without a call for `idleMs`. */
  async expire(idleMs: number): Promise<string[]> {
    const now = this.#now();
    const old = [...this.#leases.values()].filter((entry) => now - entry.lease.lastCall > idleMs);
    for (const entry of old) await this.release(entry.lease.id);
    return old.map((entry) => entry.lease.id);
  }

  /** End the leases and the polls. */
  async stop(): Promise<void> {
    this.#stopped = true;
    for (const id of [...this.#leases.keys()]) await this.release(id).catch(() => null);
    for (const worker of this.#workers.values()) worker.poll?.(null);
    for (const waiting of this.#answers.values()) {
      clearTimeout(waiting.timer);
      waiting.reject(new Error("The render pool stopped."));
    }
    this.#answers.clear();
    this.#wake();
  }
}

/** The shooter of a WebKit lease: the methods of `LabShooter` that a bridge of the lab can do. */
export class WebKitShooter implements LabShooter {
  readonly page: Pick<LabShooter["page"], "evaluate">;

  constructor(
    private readonly pages: WebKitPages,
    private readonly worker: Parameters<WebKitPages["send"]>[0],
    private readonly lease: string,
    readonly options: ShooterOptions,
  ) {
    const evaluate = (): Promise<never> =>
      Promise.reject(
        new PoolRefusal(
          NOT_ON_WEBKIT,
          "The WebKit pages of the pool run no script in the page; use the Chromium pages.",
        ),
      );
    this.page = { evaluate };
  }

  async shot(simMs: number, camera: string | CameraView): Promise<Shot> {
    const { width, height } = this.options;
    const answer = await this.pages.send(
      this.worker,
      this.lease,
      { kind: "shot", at: simMs, camera, width, height },
      SHOT_TIMEOUT_MS,
    );
    const head = answer.head as unknown as ShotHead;
    return {
      png: answer.bytes,
      simMs: head.simMs,
      camera: typeof camera === "string" ? camera : "view",
      frame: head.frame,
      metrics: head.metrics,
    };
  }

  sheet(): Promise<Buffer> {
    return Promise.reject(new PoolRefusal(NOT_ON_WEBKIT, "The WebKit pages of the pool make no sheet yet."));
  }

  webp(): Promise<{ bytes: Buffer; width: number; height: number }> {
    return Promise.reject(new PoolRefusal(NOT_ON_WEBKIT, "WebKit has no WebP encoder; ask for PNG shots."));
  }

  close(): Promise<void> {
    return Promise.resolve();
  }
}

/** The body of an answer of a worker (the tests and the page use the same form). */
export function workerAnswer(head: Record<string, unknown>, bytes: Uint8Array = new Uint8Array(0)): Buffer {
  return packPicture(head, bytes);
}
