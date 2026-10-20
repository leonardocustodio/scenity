// SPDX-License-Identifier: Apache-2.0
/**
 * The vector and easing helpers of the characters: one copy of each, so the model, the core and the poses compute the
 * same numbers in the same order. The kernel of the engine does not use them: they draw the scene only.
 */

/**
 * A point or a direction (x, y, z) in metres. It is read-only, so it is not the same type as the mutable `Vec3` of
 * `@scenity/scene/math`.
 */
export type Vec3 = readonly [number, number, number];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function cross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

/**
 * A point of a frame in the frame of the room: the frame is at `at` and turned by `yaw` about the vertical axis (as
 * Object3D.rotation.y), and `local` is the point in it.
 */
export function framePoint(at: Vec3, yaw: number, local: Vec3): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [at[0] + local[0] * c + local[2] * s, at[1] + local[1], at[2] - local[0] * s + local[2] * c];
}

/** The vector with the length 1 in the same direction (a zero vector stays zero). */
export function normalized(v: Vec3): Vec3 {
  const length = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / length, v[1] / length, v[2] / length];
}

/** The smoothstep of a share: 0 at 0 and below, 1 at 1 and above, with no step in speed at the ends. */
export function ease(share: number): number {
  const clamped = Math.min(1, Math.max(0, share));
  return clamped * clamped * (3 - 2 * clamped);
}
