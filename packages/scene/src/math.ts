// SPDX-License-Identifier: Apache-2.0
/**
 * The pure math of the documents: vectors, quaternions, Euler angles for the editor, the TRS matrix (column-major 4x4,
 * as the `elements` of a three.js Matrix4) and the world transform of an entity through the tree.
 * Units are metres and radians. Y is up. The axes are right-handed.
 */
import type { Quat, Vec3 } from "./schema/common";

export type { Quat, Vec3 } from "./schema/common";
/** A 4x4 matrix in column-major order (16 numbers). */
export type Mat4 = number[];

const DEG = Math.PI / 180;

export function vadd(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function vsub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function vscale(a: Vec3, factor: number): Vec3 {
  return [a[0] * factor, a[1] * factor, a[2] * factor];
}

/** The product of each part (a scale of a scale). */
export function vmul(a: Vec3, b: Vec3): Vec3 {
  return [a[0] * b[0], a[1] * b[1], a[2] * b[2]];
}

export function vdot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function vcross(a: Vec3, b: Vec3): Vec3 {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}

export function vlength(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

/** The vector with the length 1 in the same direction. A zero vector stays zero. */
export function vnormalize(a: Vec3): Vec3 {
  const length = vlength(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
}

export function vlerp(a: Vec3, b: Vec3, t: number): Vec3 {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
}

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1];

/** The product a × b: the rotation b, then the rotation a (as Quaternion.multiplyQuaternions of three.js). */
export function qmul(a: Quat, b: Quat): Quat {
  const [ax, ay, az, aw] = a;
  const [bx, by, bz, bw] = b;
  return [
    ax * bw + aw * bx + ay * bz - az * by,
    ay * bw + aw * by + az * bx - ax * bz,
    az * bw + aw * bz + ax * by - ay * bx,
    aw * bw - ax * bx - ay * by - az * bz,
  ];
}

/** The inverse of a unit quaternion. */
export function qconjugate(q: Quat): Quat {
  return [-q[0], -q[1], -q[2], q[3]];
}

export function qnormalize(q: Quat): Quat {
  const length = Math.hypot(q[0], q[1], q[2], q[3]);
  if (length === 0) return [...QUAT_IDENTITY];
  return [q[0] / length, q[1] / length, q[2] / length, q[3] / length];
}

/**
 * The spherical interpolation from `a` to `b`. The function takes the shorter arc, so `-q` and `q` give the
 * same path. The result has the length 1.
 */
export function qslerp(a: Quat, b: Quat, t: number): Quat {
  let cos = a[0] * b[0] + a[1] * b[1] + a[2] * b[2] + a[3] * b[3];
  const sign = cos < 0 ? -1 : 1;
  cos *= sign;
  let wa = 1 - t;
  let wb = t * sign;
  // Near the same rotation, a linear mix is exact enough and has no division by a small sine.
  if (cos < 0.9995) {
    const angle = Math.acos(cos);
    const sin = Math.sin(angle);
    wa = Math.sin((1 - t) * angle) / sin;
    wb = (Math.sin(t * angle) / sin) * sign;
  }
  return qnormalize([a[0] * wa + b[0] * wb, a[1] * wa + b[1] * wb, a[2] * wa + b[2] * wb, a[3] * wa + b[3] * wb]);
}

/** The rotation by `angle` radians about the axis. */
export function qfromAxisAngle(axis: Vec3, angle: number): Quat {
  const [x, y, z] = vnormalize(axis);
  const s = Math.sin(angle / 2);
  return [x * s, y * s, z * s, Math.cos(angle / 2)];
}

/** The vector turned by the quaternion. */
export function qrotate(q: Quat, v: Vec3): Vec3 {
  const [qx, qy, qz, qw] = q;
  const [vx, vy, vz] = v;
  const tx = 2 * (qy * vz - qz * vy);
  const ty = 2 * (qz * vx - qx * vz);
  const tz = 2 * (qx * vy - qy * vx);
  return [vx + qw * tx + qy * tz - qz * ty, vy + qw * ty + qz * tx - qx * tz, vz + qw * tz + qx * ty - qy * tx];
}

/** The quaternion of Euler angles in radians, order XYZ (as Quaternion.setFromEuler of three.js). */
export function quatFromEulerRadians(euler: Vec3): Quat {
  const [c1, c2, c3] = euler.map((angle) => Math.cos(angle / 2)) as Vec3;
  const [s1, s2, s3] = euler.map((angle) => Math.sin(angle / 2)) as Vec3;
  return [
    s1 * c2 * c3 + c1 * s2 * s3,
    c1 * s2 * c3 - s1 * c2 * s3,
    c1 * c2 * s3 + s1 * s2 * c3,
    c1 * c2 * c3 - s1 * s2 * s3,
  ];
}

/** The Euler angles in radians, order XYZ, of a unit quaternion (as Euler.setFromQuaternion of three.js). */
export function eulerRadiansFromQuat(q: Quat): Vec3 {
  const [x, y, z, w] = q;
  const m11 = 1 - 2 * (y * y + z * z);
  const m12 = 2 * (x * y - w * z);
  const m13 = 2 * (x * z + w * y);
  const m22 = 1 - 2 * (x * x + z * z);
  const m23 = 2 * (y * z - w * x);
  const m32 = 2 * (y * z + w * x);
  const m33 = 1 - 2 * (x * x + y * y);
  const ey = Math.asin(Math.min(1, Math.max(-1, m13)));
  if (Math.abs(m13) < 0.9999999) return [Math.atan2(-m23, m33), ey, Math.atan2(-m12, m11)];
  return [Math.atan2(m32, m22), ey, 0];
}

/** The quaternion of Euler angles in degrees, order XYZ: the editor widget of a rotation. */
export function quatFromEuler(degrees: Vec3): Quat {
  return quatFromEulerRadians(vscale(degrees, DEG));
}

/** The Euler angles in degrees, order XYZ, of a quaternion: the editor widget of a rotation. */
export function eulerFromQuat(q: Quat): Vec3 {
  return vscale(eulerRadiansFromQuat(q), 1 / DEG);
}

/** The TRS matrix (as Matrix4.compose of three.js): scale, then rotation, then translation. */
export function composeMatrix(position: Vec3, rotation: Quat, scale: Vec3): Mat4 {
  const [x, y, z, w] = rotation;
  const [sx, sy, sz] = scale;
  const [x2, y2, z2] = [x + x, y + y, z + z];
  const [xx, xy, xz] = [x * x2, x * y2, x * z2];
  const [yy, yz, zz] = [y * y2, y * z2, z * z2];
  const [wx, wy, wz] = [w * x2, w * y2, w * z2];
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    position[0],
    position[1],
    position[2],
    1,
  ];
}

export function identityMatrix(): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
}

/** The product a × b of two column-major matrices: b applies first. */
export function multiplyMatrices(a: Mat4, b: Mat4): Mat4 {
  const out = new Array<number>(16).fill(0);
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let sum = 0;
      for (let k = 0; k < 4; k += 1) sum += (a[k * 4 + row] ?? 0) * (b[column * 4 + k] ?? 0);
      out[column * 4 + row] = sum;
    }
  }
  return out;
}

/** The point transformed by a matrix (w = 1). */
export function transformPoint(m: Mat4, p: Vec3): Vec3 {
  const at = (index: number) => m[index] ?? 0;
  return [
    at(0) * p[0] + at(4) * p[1] + at(8) * p[2] + at(12),
    at(1) * p[0] + at(5) * p[1] + at(9) * p[2] + at(13),
    at(2) * p[0] + at(6) * p[1] + at(10) * p[2] + at(14),
  ];
}
