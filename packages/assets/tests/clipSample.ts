// SPDX-License-Identifier: Apache-2.0
/**
 * A clip sampler for the tests of the asset build: it reads the glTF animation data with glTF Transform and gives the
 * value of each channel at a time. It does STEP, LINEAR (with a normalized lerp for rotations) and CUBICSPLINE, the
 * same interpolations as the glTF loader. A test compares a source and a built file with `clipDifference`.
 */
import type { AnimationSampler, Document } from "@gltf-transform/core";

/** The value of each channel of a clip at one time, by `<node>.<path>`. */
export type ClipPose = Map<string, number[]>;

function element(values: ArrayLike<number>, index: number, size: number): number[] {
  return Array.from({ length: size }, (_, i) => values[index * size + i] ?? 0);
}

function normalize(value: number[]): number[] {
  const length = Math.hypot(...value);
  return length === 0 ? value : value.map((v) => v / length);
}

/** The value of a sampler at a time in seconds. Times out of the range give the first or the last key. */
export function sampleAt(sampler: AnimationSampler, time: number, rotation: boolean): number[] {
  const input = sampler.getInput();
  const output = sampler.getOutput();
  if (input === null || output === null) return [];
  const times = input.getArray() ?? new Float32Array();
  const size = output.getElementSize();
  // getElement gives the float values of a normalized integer output (the meshopt filters of a built file).
  const values: number[] = [];
  for (let i = 0; i < output.getCount(); i++) values.push(...output.getElement(i, []));
  const cubic = sampler.getInterpolation() === "CUBICSPLINE";
  // A cubic key holds an in tangent, a value and an out tangent.
  const value = (key: number): number[] => (cubic ? element(values, key * 3 + 1, size) : element(values, key, size));
  const last = times.length - 1;
  if (time <= (times[0] ?? 0)) return value(0);
  if (time >= (times[last] ?? 0)) return value(last);
  let key = 0;
  while (key < last - 1 && (times[key + 1] ?? 0) <= time) key += 1;
  const t0 = times[key] ?? 0;
  const t1 = times[key + 1] ?? t0;
  const span = t1 - t0;
  const s = span > 0 ? (time - t0) / span : 0;
  if (sampler.getInterpolation() === "STEP") return value(key);
  if (cubic) {
    const p0 = value(key);
    const p1 = value(key + 1);
    const m0 = element(values, key * 3 + 2, size).map((v) => v * span);
    const m1 = element(values, (key + 1) * 3, size).map((v) => v * span);
    const s2 = s * s;
    const s3 = s2 * s;
    const result = p0.map(
      (_, i) =>
        (2 * s3 - 3 * s2 + 1) * (p0[i] ?? 0) +
        (s3 - 2 * s2 + s) * (m0[i] ?? 0) +
        (-2 * s3 + 3 * s2) * (p1[i] ?? 0) +
        (s3 - s2) * (m1[i] ?? 0),
    );
    return rotation ? normalize(result) : result;
  }
  const a = value(key);
  let b = value(key + 1);
  // A rotation takes the short path: q and -q are the same rotation.
  if (rotation && a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0) < 0) b = b.map((v) => -v);
  const result = a.map((v, i) => v + ((b[i] ?? 0) - v) * s);
  return rotation ? normalize(result) : result;
}

/** The pose of the animation with a name at a time in seconds. */
export function clipPose(document: Document, animation: string, time: number): ClipPose {
  const pose: ClipPose = new Map();
  const clip = document
    .getRoot()
    .listAnimations()
    .find((item) => item.getName() === animation);
  if (clip === undefined) return pose;
  for (const channel of clip.listChannels()) {
    const sampler = channel.getSampler();
    const path = channel.getTargetPath();
    const node = channel.getTargetNode();
    if (sampler === null || path === null || node === null) continue;
    pose.set(`${node.getName()}.${path}`, sampleAt(sampler, time, path === "rotation"));
  }
  return pose;
}

/** The largest differences of two poses: the angle of the rotations in radians and the distance of the other values. */
export interface PoseDifference {
  readonly rotation: number;
  readonly translation: number;
  readonly scale: number;
  /** The channels of the first pose that the second pose does not have. */
  readonly missing: readonly string[];
}

/** The difference of a pose of the built file against the pose of the source. */
export function poseDifference(source: ClipPose, built: ClipPose): PoseDifference {
  let rotation = 0;
  let translation = 0;
  let scale = 0;
  const missing: string[] = [];
  for (const [key, value] of source) {
    const other = built.get(key);
    if (other === undefined) {
      missing.push(key);
      continue;
    }
    if (key.endsWith(".rotation")) {
      // The chord of two unit quaternions gives the angle with no loss of precision at small angles (acos has one).
      const a = normalize(value);
      let b = normalize(other);
      if (a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0) < 0) b = b.map((v) => -v);
      const chord = Math.hypot(...a.map((v, i) => v - (b[i] ?? 0)));
      rotation = Math.max(rotation, 4 * Math.asin(Math.min(1, chord / 2)));
      continue;
    }
    const distance = Math.hypot(...value.map((v, i) => v - (other[i] ?? 0)));
    if (key.endsWith(".translation")) translation = Math.max(translation, distance);
    else if (key.endsWith(".scale")) scale = Math.max(scale, distance);
  }
  return { rotation, translation, scale, missing };
}

/** The largest difference of a clip between two files at each of the times in seconds. */
export function clipDifference(
  source: Document,
  built: Document,
  animation: string,
  times: readonly number[],
): PoseDifference {
  const all = times.map((time) => poseDifference(clipPose(source, animation, time), clipPose(built, animation, time)));
  return {
    rotation: Math.max(0, ...all.map((item) => item.rotation)),
    translation: Math.max(0, ...all.map((item) => item.translation)),
    scale: Math.max(0, ...all.map((item) => item.scale)),
    missing: [...new Set(all.flatMap((item) => item.missing))],
  };
}
