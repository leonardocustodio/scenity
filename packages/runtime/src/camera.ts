// SPDX-License-Identifier: Apache-2.0
/**
 * The camera math without three.js: the field of view that fits the safe frame (the framing of framing.ts uses it),
 * and the orbit of a fixed lab camera about its target (a drag or a swipe turns the camera of the lab).
 */
import { cross, dot, normalized, sub, type Vec3 } from "@scenity/character/math";

/** The camera of a scene: a place, a target and the range of the vertical field of view. */
export interface CameraSpec {
  readonly position: Vec3;
  readonly target: Vec3;
  /** The vertical field of view range in degrees. The framing chooses the smallest that shows the safe frame. */
  readonly minFov: number;
  readonly maxFov: number;
}

/** A box of the scene (metres) that the camera always shows. */
export interface SafeBox {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** A camera at a place with a target and a vertical field of view in degrees. */
export interface OrbitView {
  readonly position: Vec3;
  readonly target: Vec3;
  readonly fov: number;
}

/** The lowest and the highest angle of an orbit camera above the level of its target (radians). */
const ELEVATION = { min: (5 * Math.PI) / 180, max: (85 * Math.PI) / 180 } as const;
/**
 * The nearest and the farthest distance of an orbit camera from its target (metres). The far limit is large while the
 * room of the lab is two times its size (a temporary value, at the request of the owner).
 */
const DISTANCE = { min: 0.6, max: 16 } as const;

/**
 * The smallest vertical field of view (degrees, in the range of the spec) of a camera at the place of `spec` that
 * looks at its target and shows every corner of each box of the safe frame on a canvas of `aspect` (width / height).
 */
export function framedFov(spec: CameraSpec, safe: readonly SafeBox[], aspect: number): number {
  // The axes of a camera that looks at the target with the world up (as Object3D.lookAt).
  const forward = normalized(sub(spec.target, spec.position));
  const right = normalized(cross(forward, [0, 1, 0]));
  const up = cross(right, forward);
  let needed = 0;
  for (const box of safe) {
    for (const x of [box.min[0], box.max[0]]) {
      for (const y of [box.min[1], box.max[1]]) {
        for (const z of [box.min[2], box.max[2]]) {
          const ray = sub([x, y, z], spec.position);
          const depth = dot(ray, forward);
          if (depth <= 0.05) continue;
          needed = Math.max(needed, Math.abs(dot(ray, up)) / depth, Math.abs(dot(ray, right)) / depth / aspect);
        }
      }
    }
  }
  const fov = (2 * Math.atan(needed * 1.02) * 180) / Math.PI;
  return Math.min(spec.maxFov, Math.max(spec.minFov, fov));
}

/** A box of the room that a camera stays in (metres). */
export interface CameraBounds {
  readonly min: Vec3;
  readonly max: Vec3;
}

/**
 * Turn a view about its target: `yaw` about the vertical (radians; a positive yaw turns the camera counter-clockwise
 * seen from above), `pitch` up or down (the camera stays between 5° and 85° above the level of the target) and `scale`
 * times the distance (from 0.6 m to 8 m). The target and the field of view do not change. With `bounds` (the target
 * in them) the camera comes nearer to the target where it would go out of them (through a wall).
 */
export function orbitView(
  view: OrbitView,
  yaw: number,
  pitch: number,
  scale = 1,
  bounds: CameraBounds | null = null,
): OrbitView {
  const [tx, ty, tz] = view.target;
  const [dx, dy, dz] = sub(view.position, view.target);
  const azimuth = Math.atan2(dx, dz) + yaw;
  const elevation = Math.min(ELEVATION.max, Math.max(ELEVATION.min, Math.atan2(dy, Math.hypot(dx, dz)) + pitch));
  const way: Vec3 = [
    Math.cos(elevation) * Math.sin(azimuth),
    Math.sin(elevation),
    Math.cos(elevation) * Math.cos(azimuth),
  ];
  let distance = Math.min(DISTANCE.max, Math.max(DISTANCE.min, Math.hypot(dx, dy, dz) * scale));
  if (bounds !== null) {
    for (let axis = 0; axis < 3; axis += 1) {
      const step = way[axis] ?? 0;
      const limit = (step > 0 ? bounds.max[axis] : bounds.min[axis]) ?? 0;
      if (step !== 0) distance = Math.min(distance, (limit - (view.target[axis] ?? 0)) / step);
    }
    distance = Math.max(DISTANCE.min, distance);
  }
  return {
    position: [tx + distance * way[0], ty + distance * way[1], tz + distance * way[2]],
    target: view.target,
    fov: view.fov,
  };
}
