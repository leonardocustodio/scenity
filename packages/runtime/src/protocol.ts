// SPDX-License-Identifier: Apache-2.0
/**
 * Protocol 2 of a scene: the messages between the host of a scene (main thread) and its render worker. The
 * main-thread core gets the same values through the same methods (`SceneCoreLike`). Thus both paths draw the same
 * frames for the same messages.
 *
 * To the worker: "init", "load" (the scene documents, the asset manifest and the built assets), "patch" (the scene ops
 * of `@scenity/scene`), "state" (the plugin input as an opaque value), "clock", "surface", "flags", "tier", "scale",
 * "pointer", "pick", "points" (the references of the projected points), "camera" (a document camera), "stats",
 * "dispose" and "extension". From the worker: "ready", "anchors", "hit", "stats", "context", "assetState", "loaded",
 * "patched", "picked", "camera", "backendFailed", "error", "audio" (the sounds of a frame) and "extension". The
 * messages of an extension (the labs worker) go in the envelope of an "extension" message. Thus their types never
 * mix with the types of the protocol.
 *
 * Protocol 1 to protocol 2: "scene" is "state", "assets" is "load" with `assets`, "gpuTimer" is "flags" with
 * `gpuTimer`, and an unknown type is an "extension" envelope. The "init" message carries `protocol`. A worker of
 * another version refuses the page with an "error" message.
 *
 * The clock anchors are those of the runtime clock (clock.ts). `Report` is the asset report of a plugin. The
 * module also has the contract of a scene core for the client (client.ts) and the worker handler (worker/handler.ts):
 * its options, its events and its methods. The module has types and one constant (`PROTOCOL_VERSION`).
 */
import type { RenderBackendFactory } from "@scenity/render/types";
import type { ClockAnchor, Surface } from "./clock";
import type { CameraView } from "./framing";
import type { BackendReason, SceneBackend } from "./host/backendRules";
import type { FrameScheduler } from "./scheduler";
import type { AudioFrame } from "./protocolAudio";
import type { LoadResult, PatchOps, PatchResult, PickHit, PickOptions, SceneLoad } from "./protocolScene";

export type * from "./protocolAudio";
export type * from "./protocolScene";

/** The version of the protocol. The client sends it in "init"; the worker refuses another version. */
export const PROTOCOL_VERSION = 2;

/**
 * The quality tier. The ultra tier is the high tier without a frame cap. Only an explicit choice gives it (the lab,
 * `?tier=ultra`): the GPU probe does not.
 */
export type Tier = "ultra" | "high" | "medium" | "low";

export interface SceneFlags {
  /** The reduced-motion setting of the system or of the app: still poses, a render on change. */
  readonly reducedMotion: boolean;
  /** The session pauses: still poses, a render on change. */
  readonly paused: boolean;
  /** The scene is on screen and the tab is visible. False stops the render loop. */
  readonly visible: boolean;
}

/**
 * A projected point of the scene: an anchor of the core (`SceneCore.anchorPoints`) on the canvas. `at` is the
 * x and y in CSS pixels of the canvas and the depth in normalized device coordinates (above 1: behind the camera).
 * `visible` is false when the object of the anchor does not show. `onCanvas` (core/anchors.ts) tells if the point is
 * on the canvas.
 */
export interface ProjectedPoint {
  readonly id: string;
  readonly at: readonly [number, number, number];
  readonly visible: boolean;
}

/**
 * The projected points of the anchors of a scene and the size of the canvas. The core sends a new frame
 * only when a point moves: with a walk, a new camera or a new size.
 */
export interface ProjectedFrame {
  readonly seq: number;
  readonly width: number;
  readonly height: number;
  readonly points: readonly ProjectedPoint[];
}

/**
 * The frame statistics of a scene core: the frames, the work, the draw calls, the GPU memory and the
 * asset state. The fields have no meaning of a plugin: a plugin reads its own values from `loads`.
 */
export interface SceneStats {
  readonly mode: "worker" | "main";
  readonly tier: Tier;
  readonly frames: number;
  readonly intervalP50: number;
  readonly intervalP95: number;
  readonly workP50: number;
  readonly workP95: number;
  /** The 95th percentile of the update of the scene (poses, IK, props) and of the render calls. */
  readonly updateP95?: number;
  readonly renderP95?: number;
  /** The 95th percentile of the part of the update that poses the characters (poses, IK, clips). */
  readonly poseP95?: number;
  /** The GPU memory of the renderer: the geometries, the textures and the shader programs. */
  readonly memory?: {
    readonly geometries: number;
    readonly textures: number;
    readonly programs: number;
    /** The GPU memory in bytes (WebGPU only). */
    readonly bytes?: number;
  };
  /** The used JS heap of the thread of the renderer in MB (Chromium), or null. */
  readonly heapMb?: number | null;
  readonly drawCalls: number;
  readonly triangles: number;
  /** The number of entities of the documents of the last load (a core with documents). */
  readonly entities?: number;
  /** The entities of the last frame that draw through an instance batch (a core with documents). */
  readonly instances?: number;
  /** The shown entities with a model or a shape in the view of the last frame (a core with documents). */
  readonly visibleEntities?: number;
  /**
   * The post-processing effects of the last frame after the tier caps, in the order of the passes (a core with
   * documents): "ao", "bloom", "outline", then "fxaa", "smaa" or "msaa". Empty: no effect.
   */
  readonly effects?: readonly string[];
  /**
   * The state of the asset files of the scene: "none" without assets, "loading" while a file loads (a character, a
   * prop model or a clip), "ready" when each file is in the scene, "failed" when each file is settled and one failed
   * (a character keeps its graybox, a prop keeps its graybox part).
   */
  readonly assets: AssetState;
  /** The load state of each asset of the scene, by a key of the plugin. */
  readonly loads: AssetLoads;
  /** The asset failures of the scene (the first 20), each with its message: what keeps the graybox and why. */
  readonly failures?: readonly string[];
  /**
   * The GPU time per frame, when the host asked for it (`gpuTimer`): timer queries on WebGL, the timestamp queries of
   * the render passes on WebGPU. Null when the browser gives neither EXT_disjoint_timer_query_webgl2 nor
   * `timestamp-query`. Absent when the host did not ask.
   */
  readonly gpu?: GpuTime | null;
  /**
   * The renderer backend that runs and the reason, when the page chose one. A "webgpu" choice (`backendChosen`) runs
   * WebGL with the reason `entry_not_built` when the page gave no WebGPU worker. It runs WebGL with `device_lost` after
   * a WebGPU failure of this page.
   */
  readonly backend?: SceneBackend;
  readonly backendReason?: BackendReason;
  readonly backendChosen?: SceneBackend;
}

/** The GPU time of the frames of a statistics window, in ms. */
export interface GpuTime {
  readonly p50: number;
  readonly p95: number;
  readonly samples: number;
}

export type AssetState = "none" | "loading" | "ready" | "failed";

/** The load state of one asset: its file loads, it is in the scene, or it failed. */
export type AssetLoad = "loading" | "ready" | "failed";

/** The load state of each asset, by a key that the plugin gives (for example the ID of a character). */
export type AssetLoads = Readonly<Record<string, AssetLoad>>;

export type PointerKind = "move" | "down" | "leave";

/** One problem of a parse: the path in the value and the message. */
export interface InputIssue {
  readonly path: readonly PropertyKey[];
  readonly message: string;
}

/**
 * The schema of the plugin input. A zod schema has this shape, so a plugin can give its zod schema.
 * The runtime does not import zod: a render worker can take a light object with `safeParse`.
 */
export interface InputSchema<I> {
  safeParse(
    value: unknown,
  ):
    | { readonly success: true; readonly data: I }
    | { readonly success: false; readonly error: { readonly issues: readonly InputIssue[] } };
}

/** The asset variants of the build: LOD0 and full textures, LOD1 and textures of half the size. */
export type AssetTier = "high" | "low";

/**
 * The built assets that the host gives the renderer: the URL of the built manifest, the
 * URL of each built file and the asset tier. The renderer loads the manifest and chooses the files, so the page chunks
 * do not carry the manifest.
 */
export interface ManifestRef {
  /** The same-origin URL of the built manifest (JSON). */
  readonly manifest: string;
  readonly tier: AssetTier;
  /** The URL of each built file, by its file name in the manifest. */
  readonly files: Readonly<Record<string, string>>;
  /** The same-origin URL of the Basis transcoder WASM. */
  readonly decoders: { readonly basisWasm: string };
}

export type ToWorker =
  | {
      readonly type: "init";
      /** The version of the protocol of the page (`PROTOCOL_VERSION`). */
      readonly protocol: number;
      readonly canvas: OffscreenCanvas;
      readonly surface: Surface;
      readonly tier: Tier;
      readonly flags: SceneFlags;
      /**
       * The built manifest that the worker loads to choose the files of the tier, with absolute same-origin
       * URLs, or null for the graybox only. It is the first "load" with `assets`.
       */
      readonly assets: ManifestRef | null;
      /** Measure the GPU time of each frame (the performance harness). */
      readonly gpuTimer?: boolean;
    }
  | LoadMessage
  /**
   * Apply the scene ops of `@scenity/scene` to the documents of the last load, as one transaction. With an `id` the
   * worker answers "patched" after the frame that shows the change.
   */
  | { readonly type: "patch"; readonly id?: number; readonly ops: PatchOps }
  /**
   * The plugin input as an opaque value, which the input schema of the plugin checks (protocol 1: "scene").
   * After a seek of the page clock (a new seek count, the lab) it has the clock anchor of the new time too: the worker
   * gets the input and the time in one task, so no frame shows the new input at the old time.
   */
  | { readonly type: "state"; readonly input: unknown; readonly anchor?: ClockAnchor }
  | { readonly type: "clock"; readonly anchor: ClockAnchor }
  | { readonly type: "surface"; readonly surface: Surface }
  /**
   * The flags of the scene, and the GPU timer of the statistics (the frame statistics of the lab). An absent field
   * keeps its value.
   */
  | { readonly type: "flags"; readonly flags?: SceneFlags; readonly gpuTimer?: boolean }
  | { readonly type: "tier"; readonly tier: Tier }
  /** The render scale of the adaptive quality: a share of the device pixel ratio of the tier. */
  | { readonly type: "scale"; readonly scale: number }
  | { readonly type: "pointer"; readonly x: number; readonly y: number; readonly kind: PointerKind }
  /**
   * Find the entity under a point of the canvas (CSS pixels), with the layers and the sub-targets of `options`.
   * The worker answers "picked" with the same `id`.
   */
  | {
      readonly type: "pick";
      readonly id: number;
      readonly x: number;
      readonly y: number;
      readonly options?: PickOptions;
    }
  /**
   * The references of the projected points: `entity:<id>` or `entity:<id>#<sub>`. The "anchors" messages then
   * carry their points, with the reference as the ID, when a point moves.
   */
  | { readonly type: "points"; readonly refs: readonly string[] }
  /**
   * Draw with a document camera, by entity ID or name, or null for the first one. The worker answers "camera" with the
   * same `id`. With `view`, the core draws with the editor camera at that view. The editor camera is
   * not a document camera: it is never in the documents.
   */
  | { readonly type: "camera"; readonly id: number; readonly name: string | null; readonly view?: EditorView }
  | { readonly type: "stats"; readonly id: number; readonly reset: boolean }
  | { readonly type: "dispose" }
  | ExtensionEnvelope;

/**
 * Load the scene documents, the asset manifest or the built assets. An absent field keeps the value before it. With
 * `documents` or `manifest` and an `id`, the worker answers "loaded" after the frame that shows the documents with
 * their assets. `assets` are new built files of a plugin core (protocol 1: "assets"): the characters return to the
 * graybox until their new models load.
 */
export interface LoadMessage extends SceneLoad {
  readonly type: "load";
  readonly id?: number;
  readonly assets?: ManifestRef | null;
}

/**
 * The view of the editor camera: a place, a target and a vertical field of view in degrees. `userCamera` is true while
 * the user moves the camera: the levels of detail then use their hysteresis. When the camera stops,
 * the editor sends the view again without it, so the frame of a still camera is a function of the view.
 */
export interface EditorView extends CameraView {
  readonly userCamera?: boolean;
}

/** The envelope of a message of an extension of the worker (the labs worker). */
export interface ExtensionEnvelope {
  readonly type: "extension";
  readonly message: ExtensionMessage;
}

/**
 * The asset fields of the statistics: the asset state, the load state of each asset and the fields of a plugin
 * (`Extra`). The core sends them after the frame that shows a change, and after a failure.
 */
export type AssetReport<Extra extends object = object> = Pick<SceneStats, "assets" | "loads"> & Extra;

export type FromWorker<Report = AssetReport> =
  | { readonly type: "ready"; readonly firstFrameMs: number }
  | { readonly type: "anchors"; readonly frame: ProjectedFrame }
  | { readonly type: "hit"; readonly id: string | null; readonly kind: PointerKind }
  | { readonly type: "stats"; readonly id: number; readonly stats: SceneStats }
  | { readonly type: "context"; readonly lost: boolean }
  /** The asset state changed: the view needs no poll of the statistics. */
  | { readonly type: "assetState"; readonly report: Report }
  /** The answer to a "load" with an `id`. */
  | { readonly type: "loaded"; readonly id: number; readonly result: LoadResult }
  /** The answer to a "patch" with an `id`. */
  | { readonly type: "patched"; readonly id: number; readonly result: PatchResult }
  /** The answer to a "pick": the hit nearest to the camera, or null. */
  | { readonly type: "picked"; readonly id: number; readonly hit: PickHit | null }
  /** The answer to a "camera": false when the documents have no such camera, or the core has no documents. */
  | { readonly type: "camera"; readonly id: number; readonly ok: boolean }
  /**
   * The renderer backend cannot draw: the WebGPU device did not start, the first frame had a GPU error, or the device
   * was lost. The page starts the scene again with the WebGL entries.
   */
  | { readonly type: "backendFailed"; readonly reason: string }
  | { readonly type: "error"; readonly message: string }
  /** The sounds of a frame: the page plays them. The core sends a frame only when a value changes. */
  | { readonly type: "audio"; readonly frame: AudioFrame }
  | ExtensionEnvelope;

/** The "init" message of the worker. */
export type InitMessage = Extract<ToWorker, { readonly type: "init" }>;

/**
 * A message of an extension of the worker (the labs worker). It goes in an "extension" envelope. The handler gives it
 * to the factory of the plugin. Its type can be any text, also a type of the protocol.
 */
export interface ExtensionMessage {
  readonly type: string;
  readonly [field: string]: unknown;
}

/** The canvas of a core: the canvas of the page (main thread) or its offscreen canvas (worker). */
export type RenderCanvas = HTMLCanvasElement | OffscreenCanvas;

/** What a scene core tells its host. */
export interface SceneEvents<Report = AssetReport> {
  ready(firstFrameMs: number): void;
  anchors(frame: ProjectedFrame): void;
  hit(id: string | null, kind: PointerKind): void;
  context(lost: boolean): void;
  /** A new asset state, after the frame that shows it or after a failure. */
  assets?(report: Report): void;
  /**
   * The renderer backend cannot draw: the WebGPU device did not start, the first frame had a GPU error, or the device
   * was lost. The core draws no more frames, and the page starts the scene again with the WebGL entries.
   */
  failed?(reason: string): void;
  /** The sounds of a frame, when a value changes. A worker sends them in an "audio" message. */
  audio?(frame: AudioFrame): void;
}

/** The options of a scene core that the client and the worker handler give (a plugin core adds its own fields). */
export interface SceneCoreOptions<Report = AssetReport> {
  readonly canvas: RenderCanvas;
  readonly surface: Surface;
  readonly tier: Tier;
  readonly flags: SceneFlags;
  /** The simulation time of the frame, or null before the first server time. */
  readonly clock: () => number | null;
  /**
   * The seek count of the page clock (the lab; absent: 0). A new value removes the history of the frames (walks, timed
   * changes): the next frame is the frame of a page that opens at that time.
   */
  readonly epoch?: () => number;
  /** A monotonic time in ms (performance.now() of the thread). */
  readonly now: () => number;
  readonly scheduler: FrameScheduler;
  readonly mode: "worker" | "main";
  readonly events: SceneEvents<Report>;
  /** Measure the GPU time of each frame with timer queries (the performance harness). */
  readonly gpuTimer?: boolean;
  /** The renderer backend of the entry: `@scenity/render/webgl` or `@scenity/render/webgpu`. */
  readonly backend: RenderBackendFactory;
}

/** The methods of a scene core that the client and the worker handler call. */
export interface SceneCoreLike<Input> {
  setInput(input: Input): void;
  setSurface(surface: Surface): void;
  setFlags(flags: SceneFlags): void;
  setTier(tier: Tier): void;
  setGpuTimer(on: boolean): void;
  setRenderScale(scale: number): void;
  setAssets(assets: ManifestRef | null): void;
  pointerAt(x: number, y: number, kind: PointerKind): void;
  stats(reset: boolean): SceneStats;
  start(): void;
  dispose(): void;
  /**
   * Load documents and an asset manifest. The promise resolves after the frame that shows them. A core with no
   * documents (a plugin core) does not have the method: the handler answers with a refusal.
   */
  load?(load: SceneLoad): Promise<LoadResult>;
  /** Apply scene ops. The promise resolves after the frame that shows the change. */
  patch?(ops: PatchOps): Promise<PatchResult>;
  /** The entity under a point of the canvas (CSS pixels) with the layers and the sub-targets of `options`, or null. */
  pickEntity?(x: number, y: number, options?: PickOptions): PickHit | null;
  /** Set the references of the projected points. A core with no documents does not have the method. */
  setPoints?(refs: readonly string[]): void;
  /**
   * Draw with a document camera by entity ID or name, or null for the first one. False when there is no such camera.
   * With `view`, the core draws with the editor camera at that view.
   */
  useCamera?(name: string | null, view?: EditorView): boolean;
}
