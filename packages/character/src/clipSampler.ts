// SPDX-License-Identifier: Apache-2.0
/**
 * The pose of a glTF clip at a time, on the nodes of a model. The renderer
 * decides the time of the clip (for example from the repeats of a motion of the pose model), so it samples the tracks
 * itself and does not use an AnimationMixer with a clock.
 */
import {
  PropertyBinding,
  Quaternion as Turn,
  type AnimationClip,
  type Interpolant,
  type KeyframeTrack,
  type Object3D,
  type Quaternion,
  type Vector3,
} from "three";
import { CLIP_CYCLE_SECONDS } from "./cycle";

/**
 * A track with the interpolant factory of its interpolation mode. KeyframeTrack.setInterpolation sets it (and the
 * glTF loader sets the one of a cubic spline); the type declarations of three.js do not name it.
 */
type SampledTrack = KeyframeTrack & { createInterpolant(): Interpolant };

interface BoundTrack {
  readonly interpolant: Interpolant;
  readonly target: Vector3 | Quaternion;
}

export class ClipSampler {
  private readonly tracks: BoundTrack[] = [];

  /** Bind the position, rotation and scale tracks of `clip` to the nodes of `root` with the same names. */
  constructor(clip: AnimationClip, root: Object3D) {
    const nodes = new Map<string, Object3D>();
    root.traverse((node) => {
      if (!nodes.has(node.name)) nodes.set(node.name, node);
    });
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
      const node = nodes.get(nodeName);
      if (node === undefined) continue;
      const target =
        propertyName === "quaternion"
          ? node.quaternion
          : propertyName === "position"
            ? node.position
            : propertyName === "scale"
              ? node.scale
              : null;
      if (target !== null) this.tracks.push({ interpolant: (track as SampledTrack).createInterpolant(), target });
    }
  }

  /** The number of bound tracks (0: the clip does not fit the model). */
  get size(): number {
    return this.tracks.length;
  }

  /** Put the nodes in the pose of the clip at `time` seconds. */
  sample(time: number): void {
    for (const { interpolant, target } of this.tracks) target.fromArray(interpolant.evaluate(time));
  }
}

/**
 * The time in a cycle clip (the rest pose at 0, then `cycles` slots of CLIP_CYCLE_SECONDS) of `cycle` work cycles
 * (BodyPose.cycle), round the cycles of the clip; the rest pose for null.
 */
export function clipTime(cycle: number | null, cycles: number): number {
  if (cycle === null || cycles < 1) return 0;
  const whole = Math.floor(cycle);
  const slot = ((whole % cycles) + cycles) % cycles;
  return (1 + slot + (cycle - whole)) * CLIP_CYCLE_SECONDS;
}

/** The length of the fade at the end of a one-shot clip, in seconds: the small rest of its motion goes to zero. */
export const ONE_SHOT_FADE_SECONDS = 0.25;

/**
 * The weight of a one-shot clip at `time` seconds of a clip of `duration` seconds: 1, then down to 0 over the last
 * ONE_SHOT_FADE_SECONDS; 0 before the clip and after it. The motion at time 0 is no motion (an additive layer), so the
 * start needs no fade.
 */
export function oneShotWeight(time: number, duration: number): number {
  if (!(time >= 0 && time < duration)) return 0;
  return Math.min(1, (duration - time) / ONE_SHOT_FADE_SECONDS);
}

interface AdditiveTrack {
  readonly interpolant: Interpolant;
  readonly target: Vector3 | Quaternion;
  /** The value of the track at time 0 (four numbers for a rotation, three for a position). */
  readonly reference: readonly number[];
}

const IDENTITY = new Turn();
const fromClip = new Turn();
const delta = new Turn();
const scaled = new Turn();

/**
 * A clip as an additive layer: the motion of each node away from its pose at time 0 of
 * the clip, added to the pose that the nodes have now (the rest pose or a compression clip). A rotation turns after
 * the rotation of now (the local frame of the bone); a position moves by the change of the clip. Scale tracks are not
 * used. For a motion of a capture with another start pose than the model (a jolt of a lying character).
 */
export class AdditiveSampler {
  readonly duration: number;
  private readonly tracks: AdditiveTrack[] = [];

  /** Bind the position and rotation tracks of `clip` to the nodes of `root` with the same names. */
  constructor(clip: AnimationClip, root: Object3D) {
    this.duration = clip.duration;
    const nodes = new Map<string, Object3D>();
    root.traverse((node) => {
      if (!nodes.has(node.name)) nodes.set(node.name, node);
    });
    for (const track of clip.tracks) {
      const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
      const node = nodes.get(nodeName);
      if (node === undefined) continue;
      const target =
        propertyName === "quaternion" ? node.quaternion : propertyName === "position" ? node.position : null;
      if (target === null) continue;
      const interpolant = (track as SampledTrack).createInterpolant();
      this.tracks.push({ interpolant, target, reference: Array.from(interpolant.evaluate(0)) });
    }
  }

  /** The number of bound tracks (0: the clip does not fit the model). */
  get size(): number {
    return this.tracks.length;
  }

  /** Add the motion of the clip at `time` seconds, by `weight` from 0 (none) to 1 (all), to the pose of the nodes. */
  apply(time: number, weight: number): void {
    if (weight <= 0) return;
    for (const { interpolant, target, reference } of this.tracks) {
      const value = interpolant.evaluate(time);
      if ("w" in target) {
        // The turn from the clip pose at time 0 to the clip pose now, after the rotation of now.
        fromClip.set(reference[0] ?? 0, reference[1] ?? 0, reference[2] ?? 0, reference[3] ?? 1).invert();
        delta.set(value[0] ?? 0, value[1] ?? 0, value[2] ?? 0, value[3] ?? 1).premultiply(fromClip);
        target.multiply(weight < 1 ? scaled.slerpQuaternions(IDENTITY, delta, weight) : delta);
      } else {
        target.x += ((value[0] ?? 0) - (reference[0] ?? 0)) * weight;
        target.y += ((value[1] ?? 0) - (reference[1] ?? 0)) * weight;
        target.z += ((value[2] ?? 0) - (reference[2] ?? 0)) * weight;
      }
    }
  }
}
