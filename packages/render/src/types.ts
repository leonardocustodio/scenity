// SPDX-License-Identifier: Apache-2.0
/**
 * The renderer backend of the core. The core has no renderer code: an entry gives it a backend factory. The WebGL
 * entries give `render/webgl.ts` (the classic WebGLRenderer). The WebGPU entries give `render/webgpu.ts` (the WebGPU
 * renderer of three.js). Thus the chunks of one backend have no code of the other backend, and a WebGL device
 * downloads no WebGPU code.
 *
 * This module has only types: each entry imports it without bytes.
 */
import type { Camera, Object3D, ShadowMapType, Vector2, WebGLRenderer } from "three";

/** The renderer backends: three.js WebGPURenderer, or the classic WebGLRenderer. */
export type BackendKind = "webgpu" | "webgl";

/** The parts of a three.js renderer that the core and the labs core use. Both renderers have them. */
export interface SceneRenderer {
  readonly domElement: HTMLCanvasElement | OffscreenCanvas;
  readonly shadowMap: { enabled: boolean; type: ShadowMapType };
  setPixelRatio(value: number): void;
  setSize(width: number, height: number, updateStyle?: boolean): void;
  /** The size of the canvas in CSS pixels. */
  getSize(target: Vector2): Vector2;
  render(scene: Object3D, camera: Camera): void;
  /**
   * The panes of the split screen of the labs: a viewport and a scissor per pane, in CSS pixels. The classic WebGL
   * renderer measures y from the bottom edge, the WebGPU renderer from the top edge.
   */
  getPixelRatio(): number;
  setViewport(x: number, y: number, width: number, height: number): void;
  setScissor(x: number, y: number, width: number, height: number): void;
  setScissorTest(enable: boolean): void;
}

/** The GPU timer of the frames: timer queries on WebGL, timestamp queries on WebGPU. */
export interface FrameTimer {
  /** Start the measurement of a frame. */
  begin(): void;
  /** End the measurement of the frame that `begin` started. */
  end(): void;
  /** Give the GPU time in ms of each finished frame to `sink`, in the order of the frames. */
  poll(sink: (ms: number) => void): void;
  /** Delete the open measurements. */
  clear(): void;
}

/** The draw calls and the triangles of the last frame. */
export interface RenderInfo {
  readonly calls: number;
  readonly triangles: number;
}

/** The GPU memory of the renderer: the geometries, the textures and the shader programs or pipelines. */
export interface RenderMemory {
  readonly geometries: number;
  readonly textures: number;
  readonly programs: number;
  /** The GPU memory in bytes that the renderer reports (WebGPU), or absent (WebGL reports counts only). */
  readonly bytes?: number;
}

/** The features of a WebGPU device (`GPUDevice.features`). */
export interface GpuFeatures {
  has(name: string): boolean;
}

/**
 * How the KTX2 loader finds the compressed formats of the GPU: the WebGL renderer (its extensions, as
 * `KTX2Loader.detectSupport`), or the features of the WebGPU device.
 */
export type TextureSupport = { readonly renderer: WebGLRenderer } | { readonly gpuFeatures: GpuFeatures };

/** What the backend tells the core. */
export interface BackendEvents {
  /** The context was lost (true) or came back (false). */
  context(lost: boolean): void;
  /**
   * The backend cannot draw: no device, an error in the first frame, or a lost device. The core stops, and the page
   * starts the scene again with the WebGL entries.
   */
  failed(reason: string): void;
}

export interface BackendParams {
  readonly canvas: HTMLCanvasElement | OffscreenCanvas;
  readonly antialias: boolean;
  readonly events: BackendEvents;
}

export interface RenderBackend {
  readonly kind: BackendKind;
  readonly renderer: SceneRenderer;
  /** True when the renderer can draw (WebGPU: after `init()`; WebGL: at once). */
  isReady(): boolean;
  /** Resolves when the renderer can draw. A failure goes to `events.failed`, never to this promise. */
  readonly ready: Promise<void>;
  /** Draw one frame of the scene. */
  render(scene: Object3D, camera: Camera): void;
  info(): RenderInfo;
  memory(): RenderMemory;
  /** A new GPU timer, or null when the browser gives no timer. Call it when the backend is ready. */
  timer(): FrameTimer | null;
  /** The compressed formats of the GPU for the KTX2 transcode. Call it when the backend is ready. */
  textureSupport(): TextureSupport;
  dispose(): void;
}

/** The factory of a backend: an entry of the core or of the worker gives it. */
export type RenderBackendFactory = (params: BackendParams) => RenderBackend;
