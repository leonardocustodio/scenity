// SPDX-License-Identifier: Apache-2.0
/**
 * Camera framing and projection. The camera keeps its place and direction. Its vertical field of view changes, so
 * that the boxes of the safe frame fit the canvas for each aspect ratio in range.
 */
import { Vector3, type PerspectiveCamera } from "three";
import type { Vec3 } from "@scenity/character/math";
import { framedFov, type CameraSpec, type SafeBox } from "./camera";

const projected = new Vector3();

/** Place the camera and choose the smallest field of view that shows every corner of each box of the safe frame. */
export function frameCamera(
  camera: PerspectiveCamera,
  spec: CameraSpec,
  safe: readonly SafeBox[],
  aspect: number,
): void {
  camera.position.set(...spec.position);
  camera.lookAt(...spec.target);
  camera.aspect = aspect;
  camera.updateMatrixWorld(true);
  camera.fov = framedFov(spec, safe, aspect);
  camera.updateProjectionMatrix();
}

/** A fixed camera of the lab: a place, a target and a vertical field of view in degrees (no framing). */
export interface CameraView {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
}

/** Place the camera at a fixed view of the lab, for a close look at the props (dev only). */
export function viewCamera(camera: PerspectiveCamera, view: CameraView, aspect: number): void {
  camera.position.set(...view.position);
  camera.lookAt(...view.target);
  camera.aspect = aspect;
  camera.fov = view.fov;
  camera.updateProjectionMatrix();
}

/**
 * The CSS pixel point of a world point and its depth in normalized device coordinates (above 1: behind the camera).
 * `onCanvas` of core/anchors.ts tells if the point is on the canvas.
 */
export function project(
  camera: PerspectiveCamera,
  point: Vector3,
  width: number,
  height: number,
): { x: number; y: number; depth: number } {
  projected.copy(point).project(camera);
  return { x: ((projected.x + 1) / 2) * width, y: ((1 - projected.y) / 2) * height, depth: projected.z };
}
