// SPDX-License-Identifier: Apache-2.0
/**
 * The WebGPU backend of the core: the WebGPU renderer of three.js
 * (`three/webgpu`) with the settings of the WebGL backend (ACES Filmic tone mapping at exposure 1.05, sRGB output, PCF
 * shadow maps). The standard materials of the scene go through the node library of the renderer as they are.
 *
 * - The renderer is `WebGPURenderer` without its WebGL 2 fallback: the same `Renderer` and `WebGPUBackend`, with the
 *   node library of the room (`roomLibrary`). A failure must not draw with that fallback, because it is slower. The
 *   page starts the scene again with the classic WebGL entries, so the WebGPU chunks include no second WebGL renderer.
 * - `init()` gets the device before the first frame (`ready`). The first frame runs in GPU error scopes: an error or a
 *   lost device gives `failed`, and the page uses WebGL (the "first test render"). A device lost later gives `failed`
 *   too.
 * - The GPU timer reads the timestamp queries of the render passes. The queries run only while a timer runs.
 * - The KTX2 transcode target comes from the features of the device.
 * - Each interleaved attribute gets an id, so meshes with other morph targets do not share a shader (morphKey.ts).
 * - The material of a shadow pass keeps its version while the alpha test of the objects goes on and off
 *   (shadowAlpha.ts): the renderer does not calculate the cache keys of each object again in each frame.
 * - A new geometry of an object with another vertex layout gets new render pipelines (geometrySwap.ts).
 * - A pane of the split screen (the scissor test) uses the direct output too (`drawPane`).
 */
import {
  ACESFilmicToneMapping,
  BasicNodeLibrary,
  Color,
  DirectRenderPipeline,
  LinearSRGBColorSpace,
  LineBasicNodeMaterial,
  MeshBasicNodeMaterial,
  MeshStandardNodeMaterial,
  PCFShadowMap,
  PointsNodeMaterial,
  Renderer,
  SRGBColorSpace,
  WebGPUBackend,
} from "three/webgpu";
import type { Camera, Object3D, Scene } from "three";
import { GeometrySwaps } from "./geometrySwap";
import { keyInterleavedAttributes } from "./morphKey";
import { isShadowPass, steadyShadowAlpha } from "./shadowAlpha";
import { plainClear } from "./toneClear";
import type { BackendParams, FrameTimer, GpuFeatures, RenderBackend } from "./types";

/** The parts of the WebGPU backend of three.js that this module uses. */
interface GpuBackendLike {
  trackTimestamp: boolean;
  readonly device?: {
    readonly features: GpuFeatures;
    pushErrorScope(filter: "validation" | "out-of-memory" | "internal"): void;
    popErrorScope(): Promise<{ readonly message: string } | null>;
    destroy(): void;
  };
}

/** The parameters of the WebGPU backend of three.js. */
type GpuParameters = NonNullable<ConstructorParameters<typeof WebGPUBackend>[0]>;

/** The GPU error filters of the first frame. */
const SCOPES = ["validation", "out-of-memory", "internal"] as const;

/**
 * The node library of the room (the three.js diet of the WebGPU entries): the lights and the tone mapping of
 * `BasicNodeLibrary`, and the node materials of the materials that the room makes. The build gives `BasicNodeLibrary`
 * only the lights and the tone mapping of the room (packages/assets/src/build/threeDiet.ts). `StandardNodeLibrary` of
 * WebGPURenderer adds the physical, toon, matcap, normal, dashed line, sprite and shadow materials, which the room
 * never makes. The trimmed GLTFLoader gives standard and basic (unlit) materials. The debug layers of the lab give
 * line and points materials. A material outside the library (for example the Phong or Lambert material of an FBX or
 * OBJ loader) does not draw on WebGPU. Give the prop a standard material, or add its node material here.
 */
function roomLibrary(): BasicNodeLibrary {
  const library = new BasicNodeLibrary();
  library.addMaterial(MeshStandardNodeMaterial, "MeshStandardMaterial");
  library.addMaterial(MeshBasicNodeMaterial, "MeshBasicMaterial");
  library.addMaterial(LineBasicNodeMaterial, "LineBasicMaterial");
  library.addMaterial(PointsNodeMaterial, "PointsMaterial");
  return library;
}

/** The WebGPU renderer of three.js with its WebGPU backend only (see the module comment). */
class GpuRenderer extends Renderer {
  /** The KTX2 loader and the node builders read this flag. */
  readonly isWebGPURenderer = true;

  constructor(parameters: GpuParameters & { readonly antialias: boolean; readonly canvas: unknown }) {
    super(new WebGPUBackend(parameters), parameters);
    this.library = roomLibrary();
  }

  /** The pipeline that applies the tone mapping and the sRGB output in each material. */
  private direct: DirectRenderPipeline | null = null;
  /** True while the direct pipeline draws: its call of `render` goes to the renderer. */
  private inDirect = false;
  /** While a pane draws (`drawPane`): the colour clear of the caller, for the shadow maps of the pane. Else null. */
  private paneClearColor: boolean | null = null;
  /** The calls of `render` that run at this time: the direct pipeline and the shadow maps call it in a call. */
  private calling = 0;
  /** The vertex layout of the geometry of each object at its last draw (geometrySwap.ts). */
  private readonly swaps = new GeometrySwaps();
  /** The draw calls and the triangles of the last frame (see `render`). */
  readonly frameCounts = { calls: 0, triangles: 0 };

  /**
   * Draw one object. A new geometry with another vertex layout first removes the render objects of the object
   * (geometrySwap.ts). In a shadow pass, the version of the shadow material stays the same (shadowAlpha.ts).
   */
  override renderObject(...args: Parameters<Renderer["renderObject"]>): void {
    const [object, scene, , geometry, material] = args;
    if (this.swaps.changed(object, geometry)) object.dispatchEvent({ type: "dispose" } as never);
    steadyShadowAlpha(scene.overrideMaterial, object, material);
    super.renderObject(...args);
  }

  /**
   * One frame: the frame loop, a pane or a picture of the labs core.
   *
   * The statistics: the renderer sets `info.render` to zero at each animation frame of the browser (its own loop,
   * `info.autoReset`), not at each call of `render`. A read after that reset and before the next frame of the core
   * gives 0 draw calls and 0 triangles. The timestamp queries use the frame counters of `info`, so these counters stay
   * as they are. `frameCounts` keeps the difference of the counters over the call, as WebGLRenderer gives the counts
   * of its last call of `render`.
   */
  override render(scene: Object3D, camera: Camera): void {
    if (this.calling > 0) {
      this.drawNested(scene as Partial<Scene> & Object3D, camera);
      return;
    }
    const counts = this.info.render;
    const calls = counts.drawCalls;
    const triangles = counts.triangles;
    this.calling += 1;
    try {
      this.drawFrame(scene, camera);
    } finally {
      this.calling -= 1;
      // The renderer does not set the counters to zero in a call of `render`.
      this.frameCounts.calls = counts.drawCalls - calls;
      this.frameCounts.triangles = counts.triangles - triangles;
    }
  }

  /**
   * A call of `render` in a frame: the scene pass of the direct pipeline, or a shadow map. The frame updates the world
   * matrices of the scene before its objects draw, and the renderer draws the shadow maps while it draws the objects.
   * Nothing moves between the two. Thus a shadow map does not update the matrices again. Without this, the renderer
   * updates them for the shadow map of each light. WebGLRenderer draws its shadow maps without that update too.
   */
  private drawNested(scene: Partial<Scene> & Object3D, camera: Camera): void {
    const shadow = isShadowPass(scene.overrideMaterial ?? null);
    // A pane does not clear the colour of the canvas (`drawPane`). Its shadow maps clear their colour.
    const paneClear = shadow ? this.paneClearColor : null;
    if (paneClear !== null) this.autoClearColor = paneClear;
    const update = shadow && scene.matrixWorldAutoUpdate;
    if (update) scene.matrixWorldAutoUpdate = false;
    try {
      this.drawFrame(scene, camera);
    } finally {
      if (update) scene.matrixWorldAutoUpdate = true;
      if (paneClear !== null) this.autoClearColor = false;
    }
  }

  /**
   * A frame of the screen goes through a `DirectRenderPipeline`, as WebGLRenderer draws. Without it, the WebGPU
   * renderer draws into a linear half-float target, blends the transparent materials there, and then applies the tone
   * mapping and the sRGB output to all of the target. WebGL applies them in each material and blends the output
   * colours. Without the direct pipeline, the clear part of a prop shows whiter and less clear on WebGPU. The direct
   * pipeline also removes the full-screen output pass.
   *
   * The background colour: WebGL clears with the sRGB value of the colour, without the tone mapping. In a direct frame
   * the clear colour is that value too (`clearPlain`). A frame with the scissor test (a pane of the labs core) goes
   * through the direct pipeline too (`drawPane`).
   */
  private drawFrame(scene: Object3D, camera: Camera): void {
    if (this.inDirect || !this.isOutputTarget) {
      super.render(scene, camera);
      return;
    }
    const host = scene as Partial<Scene>;
    const background = host.background as (Color & { readonly isColor?: boolean }) | null | undefined;
    const plain = background?.isColor === true ? background : null;
    if (this.getScissorTest()) {
      if (plain !== null && this.autoClear) this.drawPane(scene, camera, plain);
      else this.drawTargetPane(scene, camera, plain);
      return;
    }
    this.direct ??= directPipeline(this);
    const restore = plain === null ? null : this.clearPlain(host, plain);
    this.inDirect = true;
    try {
      this.direct.render(scene, camera);
    } finally {
      this.inDirect = false;
      restore?.();
    }
  }

  /**
   * A pane of the split screen (the scissor test on): the direct pipeline, as in a frame of the full canvas. The pane
   * then gets the same output and the same blend as the main view and as WebGL. With the target and the output pass of
   * the renderer, the clear part of a prop shows whiter and less clear in each pane.
   *
   * A clear of the canvas does not obey the scissor: it clears all of the canvas and removes the panes that drew before.
   * Thus the pass of a pane does not clear the colour. The direct pipeline draws the background colour as a mesh in the
   * pane, with the output of the materials. That background is the colour that ACES Filmic changes back to the plain
   * colour (toneClear.ts). The output of a material clamps a negative value to zero, so a colour that ACES Filmic
   * cannot give (a saturated primary colour) shows as a near colour. The colours of the room are in the range. The
   * pass clears the depth and the stencil of all of the canvas. The panes that drew before do not use them again. A
   * shadow map in the pass clears its colour (`drawNested`).
   */
  private drawPane(scene: Object3D, camera: Camera, plain: Color): void {
    this.direct ??= directPipeline(this);
    const restore = this.toneMapping === ACESFilmicToneMapping ? plainClear(plain, this.toneMappingExposure) : null;
    const autoClearColor = this.autoClearColor;
    this.autoClearColor = false;
    this.paneClearColor = autoClearColor;
    this.inDirect = true;
    try {
      this.direct.render(scene, camera);
    } finally {
      this.inDirect = false;
      this.paneClearColor = null;
      this.autoClearColor = autoClearColor;
      restore?.();
    }
  }

  /**
   * A pane without a background colour or without the automatic clear: the target and the output pass of the
   * renderer. The target keeps the clear of the caller in the scissor (a clear of the canvas does not obey it). The
   * background colour is the colour that ACES Filmic changes back to the plain colour (toneClear.ts).
   */
  private drawTargetPane(scene: Object3D, camera: Camera, plain: Color | null): void {
    const restore =
      plain !== null && this.toneMapping === ACESFilmicToneMapping ? plainClear(plain, this.toneMappingExposure) : null;
    try {
      super.render(scene, camera);
    } finally {
      restore?.();
    }
  }

  /**
   * Clear a direct frame with the sRGB value of the background colour, as WebGL does (it clears for a colour
   * background also without `autoClear`). The renderer writes a clear colour to the canvas as it is, and the direct
   * pipeline would draw a colour background with the tone mapping. Gives the function that sets the scene and the
   * renderer to their initial values again.
   */
  private clearPlain(host: Partial<Scene>, plain: Color): () => void {
    const clearColor = this.getClearColor(CLEAR.saved);
    const clearAlpha = this.getClearAlpha();
    const autoClear = this.autoClear;
    const srgb = plain.getRGB(CLEAR.rgb, SRGBColorSpace);
    this.setClearColor(CLEAR.encoded.setRGB(srgb.r, srgb.g, srgb.b, LinearSRGBColorSpace), 1);
    this.autoClear = true;
    host.background = null;
    return () => {
      host.background = plain;
      this.autoClear = autoClear;
      this.setClearColor(clearColor, clearAlpha);
    };
  }
}

/** Scratch colours of `clearPlain`. */
const CLEAR = { saved: new Color(), encoded: new Color(), rgb: { r: 0, g: 0, b: 0 } };

/**
 * The direct pipeline of the room: the output of each material with ACES Filmic and sRGB, and its alpha as it is. The
 * default output of the pipeline (`renderOutput`) expects a premultiplied colour: it divides the colour by the alpha
 * before the tone mapping and multiplies it after. The materials of the room give a colour without the alpha in it
 * (`premultipliedAlpha` false). Thus the default output makes an opaque part with an alpha under 1 in its texture
 * (for example the soft part of a prop) darker. Also, the blend multiplies the colour of a transparent part by its
 * alpha two times. With this pipeline, the colour of each fragment is the colour of the material shader of WebGL.
 */
function directPipeline(renderer: Renderer): DirectRenderPipeline {
  // The default output node of the pipeline is the output of the material. The node methods add the tone mapping
  // (it keeps the alpha of a vec4 colour) and the sRGB output. The module `three/tsl` is not used: it keeps every node
  // of three.js in the bundle (about 31 KB gzip).
  const pipeline = new DirectRenderPipeline(renderer);
  const color = pipeline.outputNode as unknown as OutputColor;
  pipeline.outputNode = color.toneMapping(ACESFilmicToneMapping).workingToColorSpace(SRGBColorSpace);
  pipeline.outputColorTransform = false;
  return pipeline;
}

/** The node methods of the output colour that `directPipeline` uses (the types of three.js do not give them). */
interface OutputColor {
  toneMapping(mapping: typeof ACESFilmicToneMapping): OutputColor;
  workingToColorSpace(colorSpace: typeof SRGBColorSpace): DirectRenderPipeline["outputNode"];
}

/**
 * The GPU time of the frames from the timestamp queries of the renderer. A resolve reads the queries of the frames
 * after the last resolve and gives the time of the last frame. One resolve runs at a time.
 */
class TimestampTimer implements FrameTimer {
  private pending = false;
  private readonly done: number[] = [];

  constructor(
    private readonly renderer: Renderer,
    private readonly backend: GpuBackendLike,
  ) {
    backend.trackTimestamp = true;
  }

  begin(): void {
    // The render passes write the timestamps.
  }

  end(): void {
    if (this.pending) return;
    this.pending = true;
    this.renderer.resolveTimestampsAsync("render").then(
      (ms) => {
        this.pending = false;
        if (typeof ms === "number" && ms > 0 && this.backend.trackTimestamp) this.done.push(ms);
      },
      () => {
        this.pending = false;
      },
    );
  }

  poll(sink: (ms: number) => void): void {
    for (const ms of this.done.splice(0)) sink(ms);
  }

  clear(): void {
    this.done.length = 0;
    this.backend.trackTimestamp = false;
  }
}

/** The first frame in GPU error scopes: an error fails the backend (the first test render). */
function firstRender(device: GpuBackendLike["device"], fail: (reason: string) => void, draw: () => void): void {
  if (device === undefined) {
    draw();
    return;
  }
  for (const scope of SCOPES) device.pushErrorScope(scope);
  try {
    draw();
  } catch (error) {
    fail(`first_render: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    const errors = SCOPES.map(() => device.popErrorScope().catch(() => null));
    void Promise.all(errors).then((found) => {
      const first = found.find((error): error is { readonly message: string } => error !== null);
      if (first !== undefined) fail(`first_render: ${first.message}`);
    });
  }
}

export function createWebGPUBackend(params: BackendParams): RenderBackend {
  // The morph targets of the quantized character models (morphKey.ts).
  keyInterleavedAttributes();
  const renderer = new GpuRenderer({
    canvas: params.canvas,
    antialias: params.antialias,
    alpha: false,
    trackTimestamp: true,
  });
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.type = PCFShadowMap;
  const gpu = renderer.backend as unknown as GpuBackendLike;
  let ready = false;
  let failed = false;
  let firstFrame = true;
  /** The device gives timestamp queries (the feature `timestamp-query`). */
  let stamps = false;
  const fail = (reason: string): void => {
    if (failed) return;
    failed = true;
    params.events.failed(reason);
  };
  renderer.onDeviceLost = (info) => {
    fail(`device_lost: ${info.message}`);
  };
  const started = renderer.init().then(
    () => {
      stamps = gpu.trackTimestamp;
      gpu.trackTimestamp = false;
      ready = !failed;
    },
    (error: unknown) => {
      fail(`init: ${error instanceof Error ? error.message : String(error)}`);
    },
  );
  return {
    kind: "webgpu",
    renderer,
    isReady: () => ready && !failed,
    ready: started,
    render: (scene, camera) => {
      if (!firstFrame) {
        renderer.render(scene, camera);
        return;
      }
      firstFrame = false;
      firstRender(gpu.device, fail, () => {
        renderer.render(scene, camera);
      });
    },
    info: () => ({ ...renderer.frameCounts }),
    memory: () => ({
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      programs: renderer.info.memory.programs,
      // The bytes of the buffers and the textures that the renderer tracks.
      bytes: renderer.info.memory.total,
    }),
    timer: () => (stamps ? new TimestampTimer(renderer, gpu) : null),
    textureSupport: () => ({ gpuFeatures: gpu.device?.features ?? { has: () => false } }),
    dispose: () => {
      const device = gpu.device;
      void Promise.resolve(renderer.dispose()).finally(() => {
        device?.destroy();
      });
    },
  };
}
