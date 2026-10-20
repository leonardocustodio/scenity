// SPDX-License-Identifier: Apache-2.0
/**
 * The math of the glTF export of a scene: document colours as linear RGB, and the rotation that aims a
 * camera or a light at a target. The runtime gives the same results with three.js (`setColour`, `Object3D.lookAt`).
 */
import { qconjugate, qmul, vcross, vlength, vnormalize, vsub, type Colour, type Quat, type Vec3 } from "@scenity/scene";

/** One sRGB part (0..1) as a linear part, with the sRGB transfer function of three.js. */
function srgbToLinear(part: number): number {
  return part < 0.04045 ? part * 0.0773993808 : Math.pow(part * 0.9478672986 + 0.0521327014, 2.4);
}

/** A document colour (`#rrggbb` or `[r, g, b]` in 0..255, both sRGB) as linear RGB in 0..1, as glTF needs it. */
export function linearColour(colour: Colour): Vec3 {
  const parts =
    typeof colour === "string"
      ? [1, 3, 5].map((start) => Number.parseInt(colour.slice(start, start + 2), 16))
      : [colour[0], colour[1], colour[2]];
  return parts.map((part) => srgbToLinear(part / 255)) as unknown as Vec3;
}

/** The quaternion of a rotation matrix with the columns `x`, `y` and `z` (the method of three.js). */
function quatFromAxes(x: Vec3, y: Vec3, z: Vec3): Quat {
  const [m11, m21, m31] = x;
  const [m12, m22, m32] = y;
  const [m13, m23, m33] = z;
  const trace = m11 + m22 + m33;
  if (trace > 0) {
    const s = 0.5 / Math.sqrt(trace + 1);
    return [(m32 - m23) * s, (m13 - m31) * s, (m21 - m12) * s, 0.25 / s];
  }
  if (m11 > m22 && m11 > m33) {
    const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
    return [0.25 * s, (m12 + m21) / s, (m13 + m31) / s, (m32 - m23) / s];
  }
  if (m22 > m33) {
    const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
    return [(m12 + m21) / s, 0.25 * s, (m23 + m32) / s, (m13 - m31) / s];
  }
  const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
  return [(m13 + m31) / s, (m23 + m32) / s, 0.25 * s, (m21 - m12) / s];
}

/**
 * The world rotation that turns -Z from `eye` to `target`, with +Y up (`Matrix4.lookAt` of three.js). A target at the
 * eye gives the identity. A direction along the up axis moves a little, as in three.js.
 */
export function lookRotation(eye: Vec3, target: Vec3): Quat {
  const up: Vec3 = [0, 1, 0];
  let z = vsub(eye, target);
  if (vlength(z) === 0) return [0, 0, 0, 1];
  z = vnormalize(z);
  let x = vcross(up, z);
  if (vlength(x) === 0) {
    z = vnormalize([z[0], z[1], z[2] + 0.0001]);
    x = vcross(up, z);
  }
  x = vnormalize(x);
  return quatFromAxes(x, vcross(z, x), z);
}

/** The local rotation under a parent with the world rotation `parent` that gives the world rotation `world`. */
export function localRotation(parent: Quat, world: Quat): Quat {
  return qmul(qconjugate(parent), world);
}
