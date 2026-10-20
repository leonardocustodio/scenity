// SPDX-License-Identifier: Apache-2.0
/**
 * The worker client of a scene (protocol 2). The canvas moves to the render worker, and the page sends messages: the
 * plugin input ("state"), the documents ("load"), the ops ("patch"), the clock anchors (10 per second), the size, the
 * flags and the pointer. client.ts chooses this client or the main-thread core.
 *
 * The messages with an answer ("stats", "pick", "camera", and "load" and "patch" with an `id`) share one count of
 * IDs. A disposed client answers each open request with the value of a stopped worker.
 */
import { ANCHOR_INTERVAL_MS, AnchorSampler, type ClockAnchor } from "./clock";
import type { SceneClient, SceneClientOptions } from "./client";
import {
  PROTOCOL_VERSION,
  type ExtensionMessage,
  type FromWorker,
  type LoadResult,
  type PatchResult,
  type PickHit,
  type SceneStats,
  type Tier,
  type ToWorker,
} from "./protocol";
import { absoluteAssets, absoluteLoad } from "./workerUrl";

/** An open request: its answer, and the answer of a stopped worker. */
interface Request {
  resolve(value: unknown): void;
  gone(): unknown;
}

/** The state of a worker client that its message listener changes. */
interface WorkerState {
  readonly pending: Map<number, Request>;
  readonly listeners: ((message: ExtensionMessage) => void)[];
  failed: boolean;
}

/** The answer of a request message, by its ID. */
function answer(state: WorkerState, id: number, value: unknown): void {
  state.pending.get(id)?.resolve(value);
  state.pending.delete(id);
}

/** Give the messages of the worker to the options of the host, and the extension messages to the listeners. */
function listenWorker<Core>(
  worker: Worker,
  options: SceneClientOptions<Core>,
  state: WorkerState,
  backendFailed: (reason: string) => void,
): void {
  const fail = (reason: string): void => {
    if (state.failed) return;
    state.failed = true;
    options.onFailure?.(reason);
  };
  worker.addEventListener("message", (event: MessageEvent<FromWorker>) => {
    const message = event.data;
    switch (message.type) {
      case "ready":
        options.onReady?.(message.firstFrameMs);
        break;
      case "anchors":
        options.onAnchors?.(message.frame);
        break;
      case "hit":
        options.onHit?.(message.id, message.kind);
        break;
      case "context":
        options.onContext?.(message.lost);
        break;
      case "assetState":
        options.onAssets?.(message.report);
        break;
      case "audio":
        options.onAudio?.(message.frame);
        break;
      case "backendFailed":
        if (state.failed) break;
        state.failed = true;
        backendFailed(message.reason);
        break;
      case "stats":
        answer(state, message.id, message.stats);
        break;
      case "loaded":
      case "patched":
        answer(state, message.id, message.result);
        break;
      case "picked":
        answer(state, message.id, message.hit);
        break;
      case "camera":
        answer(state, message.id, message.ok);
        break;
      case "error":
        fail(message.message);
        break;
      case "extension":
        for (const listener of state.listeners) listener(message.message);
        break;
    }
  });
  worker.addEventListener("error", (event) => {
    event.preventDefault();
    fail(event.message === "" ? "The 3D scene worker did not start." : event.message);
  });
}

/** The statistics of a stopped worker: no frames. */
function noStats(tier: Tier): SceneStats {
  return {
    mode: "worker",
    tier,
    frames: 0,
    intervalP50: 0,
    intervalP95: 0,
    workP50: 0,
    workP95: 0,
    drawCalls: 0,
    triangles: 0,
    assets: "none",
    loads: {},
  };
}

const GONE = "the 3D scene worker is gone";

/** The worker client. The canvas moves to the worker, and the caller must not draw on it again. */
export function createWorkerClient<Input, Core>(
  canvas: HTMLCanvasElement,
  worker: Worker,
  options: SceneClientOptions<Core>,
  backendFailed: (reason: string) => void,
): SceneClient<Input> {
  const offscreen = canvas.transferControlToOffscreen();
  const send = (message: ToWorker, transfer: Transferable[] = []): void => {
    worker.postMessage(message, transfer);
  };
  const state: WorkerState = { pending: new Map(), listeners: [], failed: false };
  listenWorker(worker, options, state, backendFailed);
  send(
    {
      type: "init",
      protocol: PROTOCOL_VERSION,
      canvas: offscreen,
      surface: options.surface,
      tier: options.tier,
      flags: options.flags,
      assets: absoluteAssets(options.assets),
      gpuTimer: options.gpuTimer === true,
      ...options.init,
    },
    [offscreen],
  );
  const sampler = new AnchorSampler();
  /** The seek count of the last clock sample. */
  let sampledEpoch = 0;
  const anchor = (): ClockAnchor => {
    sampledEpoch = options.getClockEpoch?.() ?? 0;
    return sampler.sample(options.getSimMs(), sampledEpoch);
  };
  const tick = (): void => {
    send({ type: "clock", anchor: anchor() });
  };
  tick();
  let held = false;
  const timer = setInterval(() => {
    if (!held) tick();
  }, ANCHOR_INTERVAL_MS);
  options.link?.({
    mode: "worker",
    send: (message) => {
      send({ type: "extension", message });
    },
    listen: (listener) => {
      state.listeners.push(listener);
    },
    tick,
    hold: (on) => {
      held = on;
    },
  });
  // A seek (a new seek count): the clock sample of the new time goes in the message of the input of that time.
  // Two messages let the worker draw a frame between them: the new input at the old time.
  const seekAnchor = (): ClockAnchor | null => ((options.getClockEpoch?.() ?? 0) !== sampledEpoch ? anchor() : null);
  const stop = (): void => {
    clearInterval(timer);
    worker.terminate();
  };
  return workerMethods(send, state, options.tier, seekAnchor, stop);
}

/** The methods of the worker client: each call is a message to the worker. */
function workerMethods<Input>(
  send: (message: ToWorker) => void,
  state: WorkerState,
  tier: Tier,
  seekAnchor: () => ClockAnchor | null,
  stop: () => void,
): SceneClient<Input> {
  let nextId = 1;
  /** Send a request message with a new ID and wait for its answer. */
  const request = <T>(make: (id: number) => ToWorker, gone: () => T): Promise<T> =>
    new Promise<T>((resolve) => {
      const id = nextId;
      nextId += 1;
      state.pending.set(id, { resolve: resolve, gone });
      send(make(id));
    });
  return {
    mode: "worker",
    setInput: (input) => {
      const at = seekAnchor();
      send(at !== null ? { type: "state", input, anchor: at } : { type: "state", input });
    },
    load: (load) =>
      request<LoadResult>(
        (id) => ({ type: "load", id, ...absoluteLoad(load) }),
        () => ({ ok: false, reason: GONE }),
      ),
    patch: (ops) =>
      request<PatchResult>(
        (id) => ({ type: "patch", id, ops }),
        () => ({ ok: false, index: 0, reason: GONE }),
      ),
    pickEntity: (x, y, options) =>
      request<PickHit | null>(
        (id) => (options === undefined ? { type: "pick", id, x, y } : { type: "pick", id, x, y, options }),
        () => null,
      ),
    setPoints: (refs) => {
      send({ type: "points", refs: [...refs] });
    },
    useCamera: (name, view) =>
      request<boolean>(
        (id) => (view === undefined ? { type: "camera", id, name } : { type: "camera", id, name, view }),
        () => false,
      ),
    setSurface: (surface) => {
      send({ type: "surface", surface });
    },
    setFlags: (flags) => {
      send({ type: "flags", flags });
    },
    setTier: (value) => {
      send({ type: "tier", tier: value });
    },
    setGpuTimer: (on) => {
      send({ type: "flags", gpuTimer: on });
    },
    setScale: (scale) => {
      send({ type: "scale", scale });
    },
    setAssets: (assets) => {
      send({ type: "load", assets: absoluteAssets(assets) });
    },
    pointer: (x, y, kind) => {
      send({ type: "pointer", x, y, kind });
    },
    stats: (reset = false) =>
      request<SceneStats>(
        (id) => ({ type: "stats", id, reset }),
        () => noStats(tier),
      ),
    dispose: () => {
      send({ type: "dispose" });
      stop();
      for (const open of state.pending.values()) open.resolve(open.gone());
      state.pending.clear();
    },
  };
}
