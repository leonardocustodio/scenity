// SPDX-License-Identifier: Apache-2.0
/**
 * The math of the editor camera: an orbit camera that the editor viewport turns, pans, moves nearer or farther, flies
 * and frames. The editor camera is not a document camera: the documents never keep it. The page sends its view to the
 * runtime with the "camera" message of the protocol.
 *
 * The camera looks at its target from `distance` metres. `yaw` turns the view about the vertical (0 looks along -Z,
 * a positive yaw turns the view to +X), and `pitch` tilts it (a positive pitch looks up). The right and up axes of
 * the view are the axes of `lookAt` with the world up (0, 1, 0), as the entity drag and the gizmos of the page use.
 * Pure functions, no DOM.
 */
import { vadd, vcross, vlength, vnormalize, vscale, vsub, type Vec3 } from "@scenity/scene/math";
import type { WorldBox } from "../transform/surfaceSnap";

/** The editor camera: its target, its turn, its tilt, its distance (metres) and its vertical field of view (degrees). */
export interface OrbitCamera {
  readonly target: Vec3;
  readonly yaw: number;
  readonly pitch: number;
  readonly distance: number;
  readonly fov: number;
}

/** A view: a place, a target and a vertical field of view (degrees). */
export interface ViewPose {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
}

/** The largest tilt up or down (radians, 89°). The view never goes upside down. */
export const MAX_PITCH = (89 * Math.PI) / 180;
/** The nearest and the farthest distance from the target (metres). */
export const MIN_DISTANCE = 0.05;
export const MAX_DISTANCE = 10_000;
/** The free space round a framed box: the sphere of the box fills this share of the view. */
export const FRAME_MARGIN = 1.15;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

/** The direction of the view of a turn and a tilt. */
export function forwardOf(yaw: number, pitch: number): Vec3 {
  const flat = Math.cos(pitch);
  return [Math.sin(yaw) * flat, Math.sin(pitch), -Math.cos(yaw) * flat];
}

/** The right and up axes of a view direction (the axes of `lookAt` with the world up). */
export function viewAxes(forward: Vec3): { readonly right: Vec3; readonly up: Vec3 } {
  const right = vnormalize(vcross(forward, [0, 1, 0]));
  return { right, up: vcross(right, forward) };
}

/** The editor camera of a view: the same place, target and field of view. */
export function orbitFromView(view: ViewPose): OrbitCamera {
  const offset = vsub(view.target, view.position);
  const distance = clamp(vlength(offset), MIN_DISTANCE, MAX_DISTANCE);
  const forward = vlength(offset) > 1e-9 ? vnormalize(offset) : ([0, 0, -1] as Vec3);
  const pitch = clamp(Math.asin(clamp(forward[1], -1, 1)), -MAX_PITCH, MAX_PITCH);
  const yaw = Math.atan2(forward[0], -forward[2]);
  return { target: view.target, yaw, pitch, distance, fov: view.fov };
}

/** The view of the editor camera. */
export function viewOf(camera: OrbitCamera): ViewPose {
  const forward = forwardOf(camera.yaw, camera.pitch);
  return { position: vsub(camera.target, vscale(forward, camera.distance)), target: camera.target, fov: camera.fov };
}

/** Turn the camera about its target (radians). The target stays. */
export function orbit(camera: OrbitCamera, yaw: number, pitch: number): OrbitCamera {
  return { ...camera, yaw: camera.yaw + yaw, pitch: clamp(camera.pitch + pitch, -MAX_PITCH, MAX_PITCH) };
}

/** Turn the view in place (radians): the place of the camera stays, and the target turns about it. */
export function look(camera: OrbitCamera, yaw: number, pitch: number): OrbitCamera {
  const position = viewOf(camera).position;
  const turned = orbit(camera, yaw, pitch);
  const forward = forwardOf(turned.yaw, turned.pitch);
  return { ...turned, target: vadd(position, vscale(forward, camera.distance)) };
}

/** The world size of one CSS pixel at the target, on a canvas `height` pixels high. */
export function pixelSize(camera: OrbitCamera, height: number): number {
  return (2 * camera.distance * Math.tan((camera.fov * Math.PI) / 360)) / Math.max(1, height);
}

/**
 * Pan the camera for a pointer move of (dx, dy) CSS pixels on a canvas `height` pixels high: the point under the
 * pointer at the target distance stays under the pointer.
 */
export function pan(camera: OrbitCamera, dx: number, dy: number, height: number): OrbitCamera {
  const { right, up } = viewAxes(forwardOf(camera.yaw, camera.pitch));
  const size = pixelSize(camera, height);
  const move = vadd(vscale(right, -dx * size), vscale(up, dy * size));
  return { ...camera, target: vadd(camera.target, move) };
}

/** Move the camera nearer to its target (a factor under 1) or farther from it (a factor over 1). */
export function dolly(camera: OrbitCamera, factor: number): OrbitCamera {
  return { ...camera, distance: clamp(camera.distance * factor, MIN_DISTANCE, MAX_DISTANCE) };
}

/**
 * Fly the camera and its target together: `across` along the right axis, `along` along the view, `up` along the world
 * up, each in metres.
 */
export function fly(camera: OrbitCamera, across: number, along: number, up: number): OrbitCamera {
  const forward = forwardOf(camera.yaw, camera.pitch);
  const { right } = viewAxes(forward);
  const move = vadd(vadd(vscale(right, across), vscale(forward, along)), [0, up, 0]);
  return { ...camera, target: vadd(camera.target, move) };
}

/** The box round some boxes, or null for none. */
export function unionBox(boxes: readonly WorldBox[]): WorldBox | null {
  if (boxes.length === 0) return null;
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (const box of boxes) {
    for (let axis = 0; axis < 3; axis += 1) {
      min[axis] = Math.min(min[axis] ?? Infinity, box.min[axis] ?? Infinity);
      max[axis] = Math.max(max[axis] ?? -Infinity, box.max[axis] ?? -Infinity);
    }
  }
  return { min: [min[0] ?? 0, min[1] ?? 0, min[2] ?? 0], max: [max[0] ?? 0, max[1] ?? 0, max[2] ?? 0] };
}

/**
 * Frame a box on a canvas of `aspect` (width / height): the target goes to the centre of the box, the view keeps its
 * direction, and the distance shows the sphere round the box in the narrower field of view with the margin.
 */
export function frameBox(camera: OrbitCamera, box: WorldBox, aspect: number, margin = FRAME_MARGIN): OrbitCamera {
  const [min, max]: [Vec3, Vec3] = [[...box.min], [...box.max]];
  const centre = vscale(vadd(min, max), 0.5);
  const radius = Math.max(MIN_DISTANCE, vlength(vsub(max, min)) / 2);
  const half = (camera.fov * Math.PI) / 360;
  const across = Math.atan(Math.tan(half) * Math.max(1e-3, aspect));
  const distance = (radius * margin) / Math.sin(Math.min(half, across));
  return { ...camera, target: centre, distance: clamp(distance, MIN_DISTANCE, MAX_DISTANCE) };
}
