// SPDX-License-Identifier: Apache-2.0
/**
 * The generic part of a scene core. The same class runs in the render worker on an OffscreenCanvas, and on the main
 * thread as the fallback. It keeps the renderer, the scene, the
 * camera, the frame loop, the quality tiers, the statistics, the asset report and the anchor frames. A plugin core
 * extends it: it makes the objects of its scene and updates them for the input and the simulation time (`updateScene`).
 *
 * Backends: the core has no renderer code. `options.backend` makes the
 * renderer (`@scenity/render/webgl` or `@scenity/render/webgpu`). The core draws no frame before the backend is ready.
 *
 * Render loop: while something can move, the frames come at the cap of the tier. With reduced motion, a pause or no
 * server time, one frame comes for each change. No frame comes while the scene is hidden.
 *
 * The constructor calls no hook: the fields of a subclass do not exist during `super()`. The subclass makes the objects
 * of its scene, then calls `initView()` as the last line of its constructor. The hooks and their defaults are in
 * sceneHooks.ts. Keep the creation order of the three.js objects and of `scene.add`: the object IDs give the order of
 * the draw sort (`painterSortStable`).
 */
import { Color, PerspectiveCamera, Raycaster, Scene, Vector2, Vector3 } from "three";
import type { FrameTimer, RenderBackend, SceneRenderer } from "@scenity/render/types";
import type { Surface } from "../clock";
import { project } from "../framing";
import { percentile } from "../hostMath";
import type {
  AssetReport,
  GpuTime,
  ManifestRef,
  PointerKind,
  ProjectedFrame,
  ProjectedPoint,
  SceneCoreOptions,
  SceneFlags,
  SceneStats,
  Tier,
} from "../protocol";
import { nextProjectedFrame } from "./anchors";
import { SceneHooks } from "./sceneHooks";
import { TIERS } from "./tiers";

export { TIERS, type Tiering } from "./tiers";
export { ANCHOR_EPSILON, nextProjectedFrame, onCanvas } from "./anchors";
export { SceneHooks, type AnchorPoint } from "./sceneHooks";

/** The most asset failures that the statistics keep. */
const MAX_FAILURES = 20;
/** The most samples of each statistic (the frame intervals, the work, the GPU times). */
const STATS_WINDOW = 600;

/**
 * The scene core of a plugin. `Input` is the scene input of the plugin, `Memory` the frame memory that goes forward
 * over a seek (saveMemory, restoreMemory), and `Report` the asset report of the plugin (the statistics carry it).
 */
export abstract class SceneCore<Input, Memory, Report extends AssetReport> extends SceneHooks<Input, Memory> {
  /** The renderer backend and its renderer. */
  protected readonly backend: RenderBackend;
  protected readonly renderer: SceneRenderer;
  protected readonly scene = new Scene();
  protected readonly camera = new PerspectiveCamera(45, 1, 0.05, 30);
  private readonly raycaster = new Raycaster();
  private readonly pointer = new Vector2();
  private readonly scratch = new Vector3();
  /** The scene input of the last setInput. */
  protected input: Input;
  protected surface: Surface;
  protected tier: Tier;
  protected flags: SceneFlags;
  /** The render scale of the adaptive quality: a share of the pixel ratio of the tier. */
  private renderScale = 1;
  private handle: number | null = null;
  private dirty = true;
  private lastRender = Number.NEGATIVE_INFINITY;
  /** The simulation time of the last frame (the labs core writes it after a sweep). */
  protected lastSim: number | null | undefined = undefined;
  /** The seek count of the clock at the last frame (options.epoch). */
  private epochSeen: number | null = null;
  private firstFrame = true;
  private readonly started: number;
  private lost = false;
  protected disposed = false;
  /** The ID of the hit target under the pointer, or null. */
  protected hovered: string | null = null;
  private lastAnchors: ProjectedFrame | null = null;
  private seq = 0;
  private readonly intervals: number[] = [];
  private readonly work: number[] = [];
  private framesSinceReset = 0;
  /** The GPU timer when the host asks for it and the browser gives it, and its samples in ms. */
  private gpuOn = false;
  private gpu: FrameTimer | null = null;
  private readonly gpuTimes: number[] = [];
  /** The asset failures of the scene, the first MAX_FAILURES (the statistics); the console shows only the first. */
  protected readonly failures: string[] = [];
  private warned = false;
  /** The key of the last asset report to the host (reportAssets). */
  private reportedAssets = "";

  constructor(
    protected readonly options: SceneCoreOptions<Report>,
    input: Input,
  ) {
    super();
    this.input = input;
    this.surface = options.surface;
    this.tier = options.tier;
    this.flags = options.flags;
    this.gpuOn = options.gpuTimer === true;
    this.started = options.now();
    this.backend = options.backend({
      canvas: options.canvas,
      antialias: options.tier !== "low",
      events: { context: (lost) => this.onContext(lost), failed: (reason) => this.onBackendFailed(reason) },
    });
    this.renderer = this.backend.renderer;
    this.startGpuTimer();
    // The WebGPU backend is ready after its device. The first frame comes then.
    if (!this.backend.isReady()) {
      void this.backend.ready.then(() => {
        if (this.disposed || !this.backend.isReady()) return;
        this.startGpuTimer();
        this.invalidate();
      });
    }
    this.scene.background = new Color(0x1a2433);
  }

  /** Apply the tier and the surface: the last line of the constructor of the subclass, after its scene objects. */
  protected initView(): void {
    this.applyTier();
    this.applySurface();
  }

  /** The context of the backend was lost (true) or came back (false). */
  private onContext(lost: boolean): void {
    this.lost = lost;
    // The queries of a lost context are gone; a restored context gets a new timer.
    if (lost) this.gpu = null;
    else this.startGpuTimer();
    this.options.events.context(lost);
    if (!lost) this.invalidate();
  }

  /** The backend cannot draw: no more frames come, and the page starts the scene again with the WebGL entries. */
  private onBackendFailed(reason: string): void {
    if (this.disposed) return;
    this.lost = true;
    this.gpu = null;
    this.options.events.failed?.(reason);
  }

  /** Start the GPU timer when the host asks for it and the backend is ready. */
  private startGpuTimer(): void {
    if (!this.gpuOn || !this.backend.isReady()) return;
    this.gpu = this.backend.timer();
  }

  /**
   * Start or stop the GPU timer after the start (the frame statistics of the lab). The queries add a little GPU work,
   * so the host starts the timer only while it shows the GPU time.
   */
  setGpuTimer(on: boolean): void {
    if (on === this.gpuOn) return;
    this.gpuOn = on;
    this.gpuTimes.length = 0;
    if (on) {
      if (!this.lost) this.startGpuTimer();
      return;
    }
    if (!this.lost) this.gpu?.clear();
    this.gpu = null;
  }

  start(): void {
    this.invalidate();
  }

  setInput(input: Input): void {
    this.input = input;
    this.inputChanged(input);
    this.invalidate();
  }

  /** Set the asset files of the host. The same files change nothing. */
  abstract setAssets(assets: ManifestRef | null): void;

  /** The asset report of the scene: the asset state and the fields of the plugin. */
  protected abstract assetReport(): Report;

  setSurface(surface: Surface): void {
    this.surface = surface;
    this.applySurface();
    this.invalidate();
  }

  setFlags(flags: SceneFlags): void {
    const wasVisible = this.flags.visible;
    this.flags = flags;
    if (!flags.visible && this.handle !== null) {
      this.options.scheduler.cancel(this.handle);
      this.handle = null;
    }
    if (flags.visible || !wasVisible) this.invalidate();
  }

  setTier(tier: Tier): void {
    if (tier === this.tier) return;
    this.tier = tier;
    this.applyTier();
    this.applySurface();
    this.invalidate();
  }

  /** Set the render scale of the adaptive quality, from 0.5 to 1. */
  setRenderScale(scale: number): void {
    const next = Math.min(1, Math.max(0.5, scale));
    if (next === this.renderScale) return;
    this.renderScale = next;
    this.applySurface();
    this.invalidate();
  }

  /** Do a hit test at a pointer position (CSS pixels of the canvas). The hover highlights the target (setHover). */
  pointerAt(x: number, y: number, kind: PointerKind): void {
    let id: string | null = null;
    if (kind !== "leave" && this.surface.width > 0 && this.surface.height > 0) {
      this.pointer.set((x / this.surface.width) * 2 - 1, -(y / this.surface.height) * 2 + 1);
      this.raycaster.setFromCamera(this.pointer, this.camera);
      const found = this.raycaster.intersectObjects(this.hitTargets(), false)[0];
      id = found === undefined ? null : this.hitIdOf(found.object);
    }
    if (id !== this.hovered) {
      if (this.hovered !== null) this.setHover(this.hovered, false);
      if (id !== null) this.setHover(id, true);
      this.hovered = id;
      this.invalidate();
    }
    this.options.events.hit(id, kind);
  }

  stats(reset: boolean): SceneStats & Report {
    const out = {
      mode: this.options.mode,
      tier: this.tier,
      frames: this.framesSinceReset,
      intervalP50: percentile(this.intervals, 0.5),
      intervalP95: percentile(this.intervals, 0.95),
      workP50: percentile(this.work, 0.5),
      workP95: percentile(this.work, 0.95),
      drawCalls: this.backend.info().calls,
      triangles: this.backend.info().triangles,
      ...this.assetReport(),
      failures: [...this.failures],
      ...(this.gpuOn ? { gpu: this.gpuTime() } : {}),
    };
    if (reset) {
      this.intervals.length = 0;
      this.work.length = 0;
      this.gpuTimes.length = 0;
      this.framesSinceReset = 0;
    }
    return out;
  }

  /** The GPU time of the statistics window, or null without a GPU timer. */
  private gpuTime(): GpuTime | null {
    if (this.gpu === null) return null;
    return { p50: percentile(this.gpuTimes, 0.5), p95: percentile(this.gpuTimes, 0.95), samples: this.gpuTimes.length };
  }

  dispose(): void {
    this.disposed = true;
    if (this.handle !== null) this.options.scheduler.cancel(this.handle);
    this.handle = null;
    this.disposeScene();
    if (!this.lost) this.gpu?.clear();
    this.gpu = null;
    this.backend.dispose();
  }

  // ---------------------------------------------------------------------------------------------

  /** The shadow map of the tier, then the hook of the subclass (its lights, its soft shadows). */
  protected applyTier(): void {
    const tiering = TIERS[this.tier];
    this.renderer.shadowMap.enabled = tiering.shadows;
    this.tierChanged(tiering);
  }

  protected applySurface(): void {
    const { width, height, dpr } = this.surface;
    if (width <= 0 || height <= 0) return;
    this.renderer.setPixelRatio(Math.min(dpr, TIERS[this.tier].dprCap) * this.renderScale);
    this.renderer.setSize(width, height, false);
    this.aimCamera(width / height);
    this.lastAnchors = null;
  }

  /** True with reduced motion or a pause: still poses, a render on change. */
  protected still(): boolean {
    return this.flags.reducedMotion || this.flags.paused;
  }

  /** True while the scene can change without a new input: the loop then runs at the frame cap. */
  private moving(sim: number | null): boolean {
    if (sim === null || this.flags.paused || this.clockStopped()) return false;
    // With reduced motion, the poses are still. A walk continues to its end time.
    if (this.flags.reducedMotion) return this.walking();
    return true;
  }

  protected invalidate(): void {
    this.dirty = true;
    this.schedule();
  }

  private schedule(): void {
    if (this.handle !== null || this.disposed || !this.flags.visible) return;
    this.handle = this.options.scheduler.request(() => {
      this.handle = null;
      this.frame();
    });
  }

  private frame(): void {
    if (this.disposed || !this.flags.visible) return;
    const now = this.options.now();
    const sim = this.options.clock();
    const moving = this.moving(sim);
    if (!this.dirty && !moving) return;
    const minInterval = 1000 / TIERS[this.tier].fps;
    // A frame of the same simulation time is the same frame. Wait for the clock without a new render (a stopped
    // clock, a fixed frame of the visual tests).
    if (!this.dirty && (now - this.lastRender < minInterval - 2 || sim === this.lastSim)) {
      this.schedule();
      return;
    }
    // No frame before the backend is ready. The ready backend asks for the frame again (see the constructor).
    if (this.lost || !this.backend.isReady()) return;
    const start = this.options.now();
    const epoch = this.options.epoch?.() ?? 0;
    if (this.epochSeen !== null && epoch !== this.epochSeen) this.forgetHistory();
    this.epochSeen = epoch;
    this.beforeUpdate();
    this.update(sim);
    this.afterUpdate();
    const updated = this.options.now();
    this.gpu?.begin();
    this.renderPasses();
    this.gpu?.end();
    const rendered = this.options.now();
    this.gpu?.poll((ms) => {
      this.pushStat(this.gpuTimes, ms);
    });
    this.emitAnchors();
    const end = this.options.now();
    if (Number.isFinite(this.lastRender)) this.pushStat(this.intervals, now - this.lastRender);
    this.pushStat(this.work, end - start);
    this.framesSinceReset += 1;
    this.lastRender = now;
    this.lastSim = sim;
    this.dirty = false;
    this.afterFrame(sim, start, updated, rendered);
    if (this.firstFrame) {
      this.firstFrame = false;
      this.options.events.ready(end - this.started);
    }
    this.reportAssets();
    if (moving) this.schedule();
  }

  protected pushStat(list: number[], value: number): void {
    list.push(value);
    if (list.length > STATS_WINDOW) list.shift();
  }

  /**
   * Update the scene for one simulation time (null: no server time). The update-only sweep of the labs core calls it
   * without a render, and the labs core overrides it.
   */
  protected update(simOrNull: number | null): void {
    this.updateScene(this.input, simOrNull);
  }

  /**
   * Send the projected point of each anchor (anchorPoints) when a point moves: with a walk, a new camera or a new
   * size. The host of a plugin reads the points (for example the corner of a card or the pan of a voice).
   */
  private emitAnchors(): void {
    const { width, height } = this.surface;
    if (width <= 0 || height <= 0) return;
    const points: ProjectedPoint[] = [];
    const camera = this.anchorCamera();
    for (const anchor of this.anchorPoints()) {
      const point = project(camera, this.scratch.set(...anchor.at), width, height);
      points.push({ id: anchor.id, at: [point.x, point.y, point.depth], visible: anchor.visible });
    }
    const frame = nextProjectedFrame(this.lastAnchors, this.seq + 1, width, height, points);
    if (frame === null) return;
    this.seq = frame.seq;
    this.lastAnchors = frame;
    this.options.events.anchors(frame);
  }

  /** The camera of the projected points: the camera of the frame (a document core draws with a document camera). */
  protected anchorCamera(): PerspectiveCamera {
    return this.camera;
  }

  /** Send a changed asset report to the host immediately. */
  protected reportAssets(): void {
    const report = this.assetReport();
    const key = JSON.stringify(report);
    if (key === this.reportedAssets) return;
    this.reportedAssets = key;
    this.options.events.assets?.(report);
  }

  /** Record an asset failure for the statistics, report it to the host and warn one time in the console. */
  protected assetFailed(message: string, error: unknown): void {
    if (this.failures.length < MAX_FAILURES) {
      this.failures.push(`${message} (${error instanceof Error ? error.message : String(error)})`);
    }
    // A failure draws no frame, so send the new state to the host immediately.
    this.reportAssets();
    if (this.warned) return;
    this.warned = true;
    console.warn(`3D scene: ${message}`, error);
  }

  /**
   * Draw the render passes of a frame after its one update (a hook of the labs core). The runtime draws one
   * pass: the scene from its camera on the full canvas. The anchors come after this hook and use `camera`.
   */
  protected renderPasses(): void {
    this.backend.render(this.scene, this.camera);
  }
}
