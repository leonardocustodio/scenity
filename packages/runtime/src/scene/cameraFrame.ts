// SPDX-License-Identifier: Apache-2.0
/**
 * The frame of a document camera: the field of view of the safe frame and the clip planes from the bounds of
 * the scene. The host calls `frameDocumentCamera` before it draws, with the aspect of the canvas.
 *
 * - The safe frame: the world box of each entity of `safeFrame.entities`, or the box `min`/`max`, with the margin.
 *   The camera keeps `fov` when the boxes fit. Else it widens up to `safeFrame.maxFov` (`framedFov` of camera.ts).
 * - The clip planes: a plane that the document does not give comes from the world box of the scene. Far reaches the
 *   farthest corner of the box. Near is a part of far, or nearer the box when the camera is outside it.
 */
import { Box3, Vector3, type PerspectiveCamera } from "three";
import type { CameraValue } from "@scenity/scene/components";
import { parseRef } from "@scenity/scene/refs";
import type { Vec3 } from "@scenity/character/math";
import { framedFov, type SafeBox } from "../camera";

/** The widest field of view of a safe frame without `maxFov` (degrees). */
export const SAFE_FRAME_MAX_FOV = 90;
/** The ratio of far to near when the camera is in the box of the scene (the fixed planes 0.1 and 100 give 1000). */
const DEPTH_RATIO = 1000;
/** The margin of far over the farthest corner, and the share of the nearest corner that near keeps. */
const FAR_SHARE = 1.02;
const NEAR_SHARE = 0.9;

const corner = new Vector3();
const forward = new Vector3();
const box = new Box3();

/** The world box of an entity and its children: the source of the safe frame. */
export type EntityBounds = (id: string) => Box3 | undefined;

function vec3(point: Vector3): Vec3 {
  return [point.x, point.y, point.z];
}

/** The boxes of a safe frame: the bounds of its entities, or its box, each with the margin. */
export function safeBoxes(frame: NonNullable<CameraValue["safeFrame"]>, bounds: EntityBounds): SafeBox[] {
  const margin = frame.margin ?? 0;
  const boxes: Box3[] = [];
  for (const ref of frame.entities ?? []) {
    const parsed = parseRef(ref);
    const found = parsed?.kind === "entity" ? bounds(parsed.id) : undefined;
    if (found !== undefined && !found.isEmpty()) boxes.push(found.clone());
  }
  if (frame.min !== undefined && frame.max !== undefined) {
    boxes.push(new Box3(new Vector3(...frame.min), new Vector3(...frame.max)));
  }
  return boxes.map((each) => {
    each.expandByScalar(margin);
    return { min: vec3(each.min), max: vec3(each.max) };
  });
}

/**
 * The field of view (degrees) of a camera with a safe frame on a canvas of `aspect`. The world matrix must be current.
 */
export function safeFrameFov(
  camera: PerspectiveCamera,
  value: CameraValue,
  boxes: readonly SafeBox[],
  aspect: number,
): number {
  const fov = value.fov ?? camera.fov;
  if (boxes.length === 0) return fov;
  const position = corner.setFromMatrixPosition(camera.matrixWorld);
  const target = camera.getWorldDirection(forward).add(position);
  const maxFov = Math.max(fov, value.safeFrame?.maxFov ?? SAFE_FRAME_MAX_FOV);
  return framedFov({ position: vec3(position), target: vec3(target), minFov: fov, maxFov }, boxes, aspect);
}

/** The near and far planes from the box of the scene, for the planes that the document does not give. */
export function clipPlanes(camera: PerspectiveCamera, value: CameraValue, scene: Box3): { near: number; far: number } {
  if (scene.isEmpty() || (value.near !== undefined && value.far !== undefined)) {
    return { near: value.near ?? camera.near, far: value.far ?? camera.far };
  }
  box.copy(scene).applyMatrix4(camera.matrixWorldInverse);
  // The camera looks along its -Z: the depth of a point is -z.
  const deepest = Math.max(1e-3, -box.min.z);
  const nearest = -box.max.z;
  const far = value.far ?? deepest * FAR_SHARE;
  const near = value.near ?? Math.min(far / 2, Math.max(far / DEPTH_RATIO, nearest * NEAR_SHARE));
  return { near, far };
}

/** Set the field of view and the clip planes of a document camera for a canvas of `aspect`. */
export function frameDocumentCamera(
  camera: PerspectiveCamera,
  value: CameraValue,
  scene: Box3,
  bounds: EntityBounds,
  aspect: number,
): void {
  camera.updateMatrixWorld();
  camera.aspect = aspect;
  const boxes = value.safeFrame === undefined ? [] : safeBoxes(value.safeFrame, bounds);
  camera.fov = safeFrameFov(camera, value, boxes, aspect);
  const { near, far } = clipPlanes(camera, value, scene);
  camera.near = near;
  camera.far = far;
  camera.updateProjectionMatrix();
}
