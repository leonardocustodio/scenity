// SPDX-License-Identifier: Apache-2.0
/**
 * The renderer of the player with its fallbacks. The module starts the document client on the canvas with the first
 * plan (fallback.ts). A failure of the renderer starts the next plan on a new canvas, because the old canvas belongs
 * to the worker or has a context of the failed backend:
 *
 * - WebGPU fails (no adapter, no device, a GPU error in the first frame, a lost device): WebGL.
 * - The worker fails (the Worker constructor throws, the worker sends an error, the browser has no OffscreenCanvas):
 *   the main thread.
 * - No first frame in FIRST_FRAME_MS: the next plan too.
 * - The last plan fails: no backend works. The player goes to the error state and keeps its poster.
 *
 * A failure after the first frame starts the next plan with the same content at the clock time. The clock and the
 * play continue. Each step is a `fallback` event and an entry of `player.fallbacks`. A content error (a document that
 * the core refuses, a camera that the scene does not have) is not a renderer failure: it fails the player at once.
 */
import type { DocumentClient, DocumentClientOptions } from "@scenity/runtime/documentClient";
import { firstPlan, nextPlan, NO_FIRST_FRAME, pathOf, WORKER_START, type RendererPlan } from "./fallback";
import type { PlayerDeps } from "./deps";
import type { PlayerFallback, PlayerOptions, PlayerPath } from "./types";

/** No first frame of the core after this time (ms): the renderer failed (the watchdog of SceneView). */
export const FIRST_FRAME_MS = 15_000;

/** The options of the client that do not depend on the plan. */
export type BaseClientOptions = Omit<
  DocumentClientOptions,
  "workerUrl" | "backend" | "surface" | "onFailure" | "onBackendFailure" | "onReady"
>;

/** What the renderer needs from the player. */
export interface RendererHost {
  base(): BaseClientOptions;
  /** Send the content to a new client and wait for its first frame. It throws on a content error. */
  load(client: DocumentClient): Promise<string[]>;
  /** The client that draws at this time, or null while a client starts. */
  use(client: DocumentClient | null): void;
  /** A new canvas after a failure. */
  canvas(canvas: HTMLCanvasElement): void;
  fallback(step: PlayerFallback): void;
  /** A failure after the first frame when no backend is left. */
  fail(reason: string): void;
  /** A user gesture on the page (the audio context can start). */
  gesture(): void;
  /** A press on the canvas at a point in CSS pixels (the `pick` event). */
  press(x: number, y: number): void;
  /** The player is disposed. */
  stopped(): boolean;
}

/** The failures of one client: before its first frame they settle `failed`; after it they go to `late`. */
interface FailureGate {
  readonly failed: Promise<string>;
  fail(reason: string): void;
  /** The first frame is on the canvas: stop the watchdog. */
  alive(): void;
  /** The client drew its content: later failures go to `late`. */
  settle(late: (reason: string) => void): void;
  close(): void;
}

function failureGate(timer: PlayerDeps["timer"]): FailureGate {
  let resolve: (reason: string) => void = () => undefined;
  const failed = new Promise<string>((done) => (resolve = done));
  let late: ((reason: string) => void) | null = null;
  let open = true;
  const stopWatchdog = timer(() => {
    gate.fail(NO_FIRST_FRAME);
  }, FIRST_FRAME_MS);
  const gate: FailureGate = {
    failed,
    fail: (reason) => {
      if (!open) return;
      open = false;
      stopWatchdog();
      if (late === null) resolve(reason);
      else late(reason);
    },
    alive: stopWatchdog,
    settle: (next) => {
      stopWatchdog();
      late = next;
    },
    close: () => {
      open = false;
      stopWatchdog();
    },
  };
  return gate;
}

type Attempt =
  | { readonly kind: "ready"; readonly warnings: string[] }
  | { readonly kind: "failed"; readonly reason: string; readonly ran: PlayerPath }
  | { readonly kind: "stopped" };

/** A new canvas with the attributes of a canvas, in its place (the browser part of `replaceCanvas`). */
export function replaceCanvas(canvas: HTMLCanvasElement): HTMLCanvasElement {
  const fresh = canvas.cloneNode(false) as HTMLCanvasElement;
  canvas.replaceWith(fresh);
  return fresh;
}

/** The timer of the browser (the browser part of `timer`). */
export function browserTimer(callback: () => void, ms: number, repeat = false): () => void {
  if (repeat) {
    const handle = setInterval(callback, ms);
    return () => {
      clearInterval(handle);
    };
  }
  const handle = setTimeout(callback, ms);
  return () => {
    clearTimeout(handle);
  };
}

/** The error of a player when no backend works. */
export function noBackend(reason: string): string {
  return `no renderer backend works: ${reason}`;
}

export class PlayerRenderer {
  readonly fallbacks: PlayerFallback[] = [];
  readonly #deps: PlayerDeps;
  readonly #options: PlayerOptions;
  readonly #host: RendererHost;
  #canvas: HTMLCanvasElement;
  #gate: FailureGate | null = null;
  #client: DocumentClient | null = null;
  #workerFailed = false;
  #unlisten: (() => void) | null = null;

  constructor(canvas: HTMLCanvasElement, deps: PlayerDeps, options: PlayerOptions, host: RendererHost) {
    this.#canvas = canvas;
    this.#deps = deps;
    this.#options = options;
    this.#host = host;
  }

  get canvas(): HTMLCanvasElement {
    return this.#canvas;
  }

  /** Start with the first plan; the warnings of the load, or null when the player stopped. */
  async start(): Promise<string[] | null> {
    const { plan, noWorker } = await firstPlan({
      backend: this.#options.backend ?? "auto",
      workerAllowed: this.#workerAllowed(),
      workerUsable: this.#deps.canUseWorker(this.#canvas),
      workerUrl: this.#deps.workerUrl,
      chooseBackend: this.#deps.chooseBackend,
    });
    if (noWorker !== null) {
      this.#workerFailed = true;
      this.#step({ renderer: "worker", backend: "webgl" }, pathOf(plan), noWorker);
    }
    return this.#run(plan);
  }

  dispose(): void {
    this.#gate?.close();
    this.#unlisten?.();
    this.#unlisten = null;
    this.#client?.dispose();
    this.#client = null;
  }

  #workerAllowed(): boolean {
    return this.#options.worker !== false && this.#deps.workerUrl !== null;
  }

  /** The worker of a next plan, or null. */
  #workerFor(canvas: HTMLCanvasElement): string | null {
    const usable = !this.#workerFailed && this.#workerAllowed() && this.#deps.canUseWorker(canvas);
    return usable ? this.#deps.workerUrl : null;
  }

  #step(from: PlayerPath, to: PlayerPath | null, reason: string): void {
    const step: PlayerFallback = { from, to, reason };
    this.fallbacks.push(step);
    this.#host.fallback(step);
  }

  /** Start with a plan and with the next plans after failures. It throws when no backend works. */
  async #run(first: RendererPlan): Promise<string[] | null> {
    let plan = first;
    for (;;) {
      const attempt = await this.#attempt(plan);
      if (attempt.kind !== "failed") return attempt.kind === "ready" ? attempt.warnings : null;
      const next = this.#next(plan, attempt.ran, attempt.reason);
      if (next === null) throw new Error(noBackend(attempt.reason));
      plan = next;
    }
  }

  /** The next plan after a failure of `ran`, on a new canvas; null when no backend is left. */
  #next(plan: RendererPlan, ran: PlayerPath, reason: string): RendererPlan | null {
    this.#drop();
    if (ran.renderer === "worker") this.#workerFailed = true;
    // The worker check reads the browser features, so the old canvas gives the answer of a new one.
    const next = nextPlan(plan, ran, this.#workerFor(this.#canvas));
    this.#step(ran, next === null ? null : pathOf(next), reason);
    if (next === null) return null;
    const fresh = this.#deps.replaceCanvas(this.#canvas);
    this.#canvas = fresh;
    this.#host.canvas(fresh);
    return next;
  }

  /** Stop the client of a failed plan. */
  #drop(): void {
    this.#gate?.close();
    this.#unlisten?.();
    this.#unlisten = null;
    this.#client?.dispose();
    this.#client = null;
    this.#host.use(null);
  }

  /** One start of the client: the first frame with the content, a failure of the renderer, or a stop. */
  async #attempt(plan: RendererPlan): Promise<Attempt> {
    const gate = failureGate(this.#deps.timer);
    this.#gate = gate;
    let client: DocumentClient;
    try {
      client = await this.#create(plan, gate);
    } catch (error) {
      gate.close();
      return { kind: "failed", reason: error instanceof Error ? error.message : String(error), ran: pathOf(plan) };
    }
    if (this.#host.stopped()) {
      gate.close();
      client.dispose();
      return { kind: "stopped" };
    }
    this.#client = client;
    this.#host.use(client);
    this.#listen(client);
    if (plan.workerUrl !== null && client.mode === "main") {
      // The Worker constructor failed: the client drew on the main thread at once (client.ts).
      this.#workerFailed = true;
      this.#step({ renderer: "worker", backend: "webgl" }, pathOf(plan, "main"), WORKER_START);
    }
    const ran = pathOf(plan, client.mode);
    const loaded = this.#host.load(client).then((warnings) => ({ kind: "ready" as const, warnings }));
    // A failure of the renderer wins over the load: then the load result of the stopped client does not matter.
    loaded.catch(() => undefined);
    const failed = gate.failed.then((reason) => ({ kind: "failed" as const, reason, ran }));
    let result: Attempt;
    try {
      result = await Promise.race([loaded, failed]);
    } catch (error) {
      // A content error: the player fails with it, and the watchdog stops.
      gate.close();
      throw error;
    }
    if (result.kind === "ready") {
      gate.settle((reason) => {
        this.#late(plan, ran, reason);
      });
    }
    return this.#host.stopped() ? { kind: "stopped" } : result;
  }

  /** Create the client of a plan on the canvas. */
  #create(plan: RendererPlan, gate: FailureGate): Promise<DocumentClient> {
    const canvas = this.#canvas;
    return this.#deps.createClient(canvas, {
      ...this.#host.base(),
      workerUrl: plan.workerUrl,
      ...(plan.backend === null ? {} : { backend: plan.backend }),
      surface: { width: canvas.clientWidth, height: canvas.clientHeight, dpr: this.#deps.devicePixelRatio() },
      onReady: () => {
        gate.alive();
      },
      onFailure: (reason) => {
        gate.fail(reason);
      },
      onBackendFailure: (reason) => {
        gate.fail(reason);
      },
    });
  }

  /** A failure after the first frame: the next plan with the same content. The clock continues. */
  #late(plan: RendererPlan, ran: PlayerPath, reason: string): void {
    if (this.#host.stopped()) return;
    const next = this.#next(plan, ran, reason);
    if (next === null) {
      this.#host.fail(noBackend(reason));
      return;
    }
    this.#run(next).catch((error: unknown) => {
      this.#host.fail(error instanceof Error ? error.message : String(error));
    });
  }

  /** The size of the canvas, the user gestures that start the audio context, and the presses of the `pick` event. */
  #listen(client: DocumentClient): void {
    const canvas = this.#canvas;
    const resize = (): void => {
      client.setSurface({ width: canvas.clientWidth, height: canvas.clientHeight, dpr: this.#deps.devicePixelRatio() });
    };
    const observer = typeof ResizeObserver === "function" ? new ResizeObserver(resize) : null;
    observer?.observe(canvas);
    const gesture = (): void => {
      this.#host.gesture();
    };
    const press = (event: PointerEvent): void => {
      this.#host.gesture();
      if (event.button === 0) this.#host.press(event.offsetX, event.offsetY);
    };
    canvas.addEventListener("pointerdown", press);
    globalThis.addEventListener("keydown", gesture);
    this.#unlisten = () => {
      observer?.disconnect();
      canvas.removeEventListener("pointerdown", press);
      globalThis.removeEventListener("keydown", gesture);
    };
  }
}
