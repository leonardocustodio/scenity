// SPDX-License-Identifier: Apache-2.0
/**
 * The post-process contract of the backends. The WebGL backend draws the effects with the EffectComposer passes of
 * three.js (postWebgl.ts). The WebGPU backend draws them with the node passes of `three/tsl` (postWebgpu.ts). Both
 * modules are lazy chunks: a core loads one only when the scene enables an effect. The 3D room entries do not import
 * them, so the room workers do not get larger.
 *
 * The passes of a frame, in order: the scene into a half-float target (with 4 samples for `msaa`), the ambient
 * occlusion (the colour times the occlusion), the bloom (added), the outline of the selection (added), SMAA (in the
 * linear space), the tone mapping and the sRGB output of the renderer, then FXAA (in the sRGB space).
 *
 * This module has only types.
 */
import type { Object3D, PerspectiveCamera, Scene } from "three";
import type { SceneRenderer } from "./types";

/** A colour in the linear working space of three.js, each part 0..1. */
export type LinearRgb = readonly [number, number, number];

/** The effects of a pipeline. Null is an effect that the pipeline does not draw. */
export interface PostSettings {
  readonly ao: { readonly radius: number; readonly intensity: number } | null;
  readonly bloom: { readonly threshold: number; readonly strength: number; readonly radius: number } | null;
  readonly antialias: "none" | "fxaa" | "smaa" | "msaa";
  readonly outline: { readonly colour: LinearRgb; readonly thickness: number; readonly strength: number } | null;
}

/** The share of the outline colour on the hidden part of an edge (the part behind another object). */
export const HIDDEN_EDGE_SHARE = 0.3;

/** The effect passes of one scene and one camera. */
export interface PostPipeline {
  /** Draw one frame to the canvas. `selected` are the objects of the outline. */
  render(selected: readonly Object3D[]): void;
  dispose(): void;
}

/** Make the pipeline of a renderer, a scene, a camera and the effects. It resolves when the pipeline can draw. */
export type PostFactory = (
  renderer: SceneRenderer,
  scene: Scene,
  camera: PerspectiveCamera,
  settings: PostSettings,
) => Promise<PostPipeline>;
