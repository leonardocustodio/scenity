// SPDX-License-Identifier: Apache-2.0
/**
 * The host side of a scene (protocol 2). With a worker URL, OffscreenCanvas and module workers, the canvas moves to the
 * render worker (workerClient.ts) and the page only sends changes: the plugin input, the documents, the ops, clock
 * anchors (10 per second), the size, the flags and the pointer. Without them, the same core draws on the main thread;
 * that path loads the core (and three.js) as a separate chunk through the `loadCore` of the plugin.
 *
 * Backends: the backend that runs selects the worker URL (`workerUrl` or `gpuWorkerUrl`) and the core chunk of the
 * plugin, so the page loads only the code of its backend.
 *
 * The CSP of the app has `worker-src 'self'` and `require-trusted-types-for 'script'`: the worker URL must be a
 * same-origin file (never a Blob URL), and the Worker constructor gets it through the Trusted Types policy
 * "scenity-worker", which accepts same-origin URLs only.
 */
import type { Surface } from "./clock";
import { rememberDeviceLoss, runningBackend, type BackendChoice, type RunningBackend } from "./host/backend";
import type { SceneBackend } from "./host/backendRules";
import type {
  AssetReport,
  AudioFrame,
  EditorView,
  ExtensionMessage,
  LoadResult,
  ManifestRef,
  PatchOps,
  PatchResult,
  PickHit,
  PickOptions,
  PointerKind,
  ProjectedFrame,
  SceneCoreLike,
  SceneCoreOptions,
  SceneFlags,
  SceneLoad,
  SceneStats,
  Tier,
} from "./protocol";
import { createWorkerClient } from "./workerClient";
import { absoluteAssets, absoluteLoad, canUseSceneWorker, trustedWorkerUrl } from "./workerUrl";

export { absoluteAssets, absoluteLoad, canUseSceneWorker, trustedWorkerUrl, workerGpuProbe } from "./workerUrl";

/**
 * The channel of a client for an extension (the labs renderer): the messages of the worker, or the core of the main
 * thread.
 */
export type SceneLink<Core> =
  | {
      readonly mode: "worker";
      send(message: ExtensionMessage): void;
      listen(listener: (message: ExtensionMessage) => void): void;
      /** Send a clock sample of the current time. */
      tick(): void;
      /**
       * Stop (true) or start again (false) the clock samples of the timer: a stopped clock needs none, and `tick` still
       * sends one.
       */
      hold(on: boolean): void;
    }
  | { readonly mode: "main"; readonly core: Core };

export interface SceneClientOptions<Core> {
  /**
   * The URL of the worker module (the worker entry of the plugin, built by the bundler). Null or absent: main thread.
   */
  readonly workerUrl?: string | null;
  /**
   * The URL of the worker module of the WebGPU backend. The client starts it in place of `workerUrl` when the backend
   * is WebGPU. Absent: a WebGPU choice runs the WebGL worker with the reason `entry_not_built`.
   */
  readonly gpuWorkerUrl?: string | null;
  /** The simulation time of the page clock. */
  readonly getSimMs: () => number | null;
  /** The seek count of the page clock (the lab): a new value lets the worker clock move back a little. */
  readonly getClockEpoch?: () => number;
  readonly surface: Surface;
  readonly tier: Tier;
  readonly flags: SceneFlags;
  /**
   * The built assets: the manifest that the renderer loads to choose the files of the tier, or null/absent for the
   * graybox only. The first frame never waits for them: the characters show as the graybox and change to their glTF
   * models when the files are ready.
   */
  readonly assets?: ManifestRef | null;
  /**
   * Measure the GPU time of each frame with timer queries (for the performance harness). The statistics then have
   * `gpu`. Off by default: the queries add a little GPU work.
   */
  readonly gpuTimer?: boolean;
  /**
   * The renderer backend of the chooser, or null/absent when the page did not choose. The statistics give the backend
   * that runs and its reason (`backend`, `backendReason`).
   */
  readonly backend?: BackendChoice | null;
  /** More fields of the "init" message of the worker (an extension). */
  readonly init?: Readonly<Record<string, unknown>>;
  /** The channel of the new client, for an extension. */
  readonly link?: (link: SceneLink<Core>) => void;
  readonly onReady?: (firstFrameMs: number) => void;
  readonly onAnchors?: (frame: ProjectedFrame) => void;
  readonly onHit?: (id: string | null, kind: PointerKind) => void;
  /** The WebGL context was lost (true) or restored (false). */
  readonly onContext?: (lost: boolean) => void;
  /** A new asset state: after the frame that shows it, or after a failure. */
  readonly onAssets?: (report: AssetReport) => void;
  /** The renderer failed. The host must show its 2D fallback. */
  readonly onFailure?: (reason: string) => void;
  /** The sounds of a frame, when a value changes: give them to an `AudioPlayer` of `@scenity/runtime/audio`. */
  readonly onAudio?: (frame: AudioFrame) => void;
  /**
   * The WebGPU backend failed (no device, a GPU error in the first frame, a lost device). The client remembers the
   * loss (7 days). The host starts the client again one time on a new canvas with a WebGL choice. Absent: the failure
   * goes to `onFailure`.
   */
  readonly onBackendFailure?: (reason: string) => void;
}

export interface SceneClient<Input> {
  readonly mode: "worker" | "main";
  /** The plugin input ("state"). */
  setInput(input: Input): void;
  /** Load documents and an asset manifest; the result comes after the frame that shows them. */
  load(load: SceneLoad): Promise<LoadResult>;
  /** Apply scene ops as one transaction; the result comes after the frame that shows the change. */
  patch(ops: PatchOps): Promise<PatchResult>;
  /** The entity under a point of the canvas (CSS pixels), or null; `options` gives layers and sub-targets. */
  pickEntity(x: number, y: number, options?: PickOptions): Promise<PickHit | null>;
  /**
   * The references of the projected points: `entity:<id>` or `entity:<id>#<sub>`. `onAnchors` then gets their
   * points, with the reference as the ID. A core with no documents ignores the call.
   */
  setPoints(refs: readonly string[]): void;
  /**
   * Draw with a document camera by entity ID or name; null for the first one. False when there is none. With `view`,
   * the core draws with the editor camera at that view (the editor camera is not in the documents).
   */
  useCamera(name: string | null, view?: EditorView): Promise<boolean>;
  setSurface(surface: Surface): void;
  setFlags(flags: SceneFlags): void;
  setTier(tier: Tier): void;
  /** Start or stop the GPU timer of the statistics (`gpu` in the statistics). */
  setGpuTimer(on: boolean): void;
  /** The render scale of the adaptive quality. */
  setScale(scale: number): void;
  /** New asset files: the characters show as the graybox until their new models load. */
  setAssets(assets: ManifestRef | null): void;
  pointer(x: number, y: number, kind: PointerKind): void;
  stats(reset?: boolean): Promise<SceneStats>;
  dispose(): void;
}

/** The options of a main-thread core without the backend: the core loader of the plugin adds it. */
export type MainCoreOptions = Omit<SceneCoreOptions, "backend">;

/**
 * The main-thread core of a backend: the plugin loads one chunk per backend (literal dynamic imports, so the
 * bundler makes a chunk of each) and gives the factory of its core with the backend of that chunk.
 */
export type CoreLoader<Core> = (backend: SceneBackend) => Promise<(options: MainCoreOptions) => Promise<Core>>;

/** The main-thread client: the same core with requestAnimationFrame of the page. */
async function createMainThreadClient<Input, Core extends SceneCoreLike<Input>>(
  canvas: HTMLCanvasElement,
  options: SceneClientOptions<Core>,
  backend: SceneBackend,
  loadCore: CoreLoader<Core>,
): Promise<SceneClient<Input>> {
  const make = await loadCore(backend);
  const core = await make({
    canvas,
    surface: options.surface,
    tier: options.tier,
    flags: options.flags,
    clock: options.getSimMs,
    epoch: () => options.getClockEpoch?.() ?? 0,
    now: () => performance.now(),
    scheduler: {
      request: (callback) => requestAnimationFrame(() => callback()),
      cancel: (handle) => {
        cancelAnimationFrame(handle);
      },
    },
    mode: "main",
    gpuTimer: options.gpuTimer === true,
    events: {
      ready: (ms) => options.onReady?.(ms),
      anchors: (frame) => options.onAnchors?.(frame),
      hit: (id, kind) => options.onHit?.(id, kind),
      context: (lost) => options.onContext?.(lost),
      assets: (report) => options.onAssets?.(report),
      audio: (frame) => options.onAudio?.(frame),
      failed: (reason) => {
        backendFailed(options, reason);
      },
    },
  });
  core.setAssets(absoluteAssets(options.assets));
  core.start();
  options.link?.({ mode: "main", core });
  return mainMethods(core);
}

const NO_DOCUMENTS = "this core takes no documents";

/** The methods of the main-thread client: each call goes to the core. */
function mainMethods<Input>(core: SceneCoreLike<Input>): SceneClient<Input> {
  return {
    mode: "main",
    setInput: (input) => {
      core.setInput(input);
    },
    load: (load) => core.load?.(absoluteLoad(load)) ?? Promise.resolve({ ok: false, reason: NO_DOCUMENTS }),
    patch: (ops) => core.patch?.(ops) ?? Promise.resolve({ ok: false, index: 0, reason: NO_DOCUMENTS }),
    pickEntity: (x, y, options) => Promise.resolve(core.pickEntity?.(x, y, options) ?? null),
    setPoints: (refs) => {
      core.setPoints?.(refs);
    },
    useCamera: (name, view) => Promise.resolve(core.useCamera?.(name, view) ?? false),
    setSurface: (surface) => {
      core.setSurface(surface);
    },
    setFlags: (flags) => {
      core.setFlags(flags);
    },
    setTier: (tier) => {
      core.setTier(tier);
    },
    setGpuTimer: (on) => {
      core.setGpuTimer(on);
    },
    setScale: (scale) => {
      core.setRenderScale(scale);
    },
    setAssets: (assets) => {
      core.setAssets(absoluteAssets(assets));
    },
    pointer: (x, y, kind) => {
      core.pointerAt(x, y, kind);
    },
    stats: (reset = false) => Promise.resolve(core.stats(reset)),
    dispose: () => {
      core.dispose();
    },
  };
}

function startWorker(workerUrl: string): Worker | null {
  try {
    return new Worker(trustedWorkerUrl(workerUrl), { type: "module", name: "scenity-room3d" });
  } catch {
    return null;
  }
}

/**
 * Create the client of a scene on a canvas: the worker client when the browser can run it, else the main-thread core
 * of `loadCore`. A failure of the worker comes through `onFailure`; the host then mounts a new canvas and may call this
 * function again without a worker URL.
 */
export async function createSceneClient<Input, Core extends SceneCoreLike<Input>>(
  canvas: HTMLCanvasElement,
  options: SceneClientOptions<Core>,
  loadCore: CoreLoader<Core>,
): Promise<SceneClient<Input>> {
  const url = options.workerUrl ?? null;
  const inWorker = url !== null && canUseSceneWorker(canvas);
  const running = runningOn(options, inWorker);
  const backend = running?.backend ?? "webgl";
  if (inWorker) {
    const worker = startWorker(backend === "webgpu" ? (options.gpuWorkerUrl ?? url) : url);
    if (worker !== null) {
      const failed = (reason: string): void => {
        backendFailed(options, reason);
      };
      return withBackend(createWorkerClient<Input, Core>(canvas, worker, options, failed), running);
    }
  }
  return withBackend(await createMainThreadClient(canvas, options, backend, loadCore), running);
}

/** The backend that runs: a WebGPU choice without a WebGPU worker runs the WebGL worker. */
function runningOn<Core>(options: SceneClientOptions<Core>, inWorker: boolean): RunningBackend | null {
  const running = runningBackend(options.backend ?? null);
  if (running?.backend === "webgpu" && inWorker && (options.gpuWorkerUrl ?? null) === null) {
    return { backend: "webgl", reason: "entry_not_built", chosen: "webgpu" };
  }
  return running;
}

/** The WebGPU backend failed: remember the loss for 7 days, then tell the host. */
function backendFailed<Core>(options: SceneClientOptions<Core>, reason: string): void {
  rememberDeviceLoss();
  if (options.onBackendFailure === undefined) options.onFailure?.(reason);
  else options.onBackendFailure(reason);
}

/** The statistics with the backend that runs and its reason. */
function withBackend<Input>(client: SceneClient<Input>, running: RunningBackend | null): SceneClient<Input> {
  if (running === null) return client;
  return {
    ...client,
    stats: (reset) =>
      client.stats(reset).then((value) => ({
        ...value,
        backend: running.backend,
        backendReason: running.reason,
        backendChosen: running.chosen,
      })),
  };
}
