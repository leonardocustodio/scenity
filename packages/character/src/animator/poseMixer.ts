// SPDX-License-Identifier: Apache-2.0
/**
 * The pose mixer of the animator (`@scenity/character/poseMixer`): it puts an animator frame on the nodes of a
 * skinned model with no AnimationMixer and no clock, as the clip sampler does. Each frame starts from the
 * rest pose. An override layer mixes the weighted average of its clips into the pose by the layer weight; an additive
 * layer adds the motion of its clips away from their pose at time 0. A track that a clip does not have gives the rest
 * value. A procedural motion of a plugin changes the nodes after the clips of its layer.
 */
import {
  PropertyBinding,
  Quaternion,
  Vector3,
  type AnimationClip,
  type Interpolant,
  type KeyframeTrack,
  type Object3D,
} from "three";
import type { AnimatorFrame, LayerPose } from "./animator";
import type { ClipLengths, MotionSample } from "./motion";
import type { Parameters } from "./parameters";

/** A track with the interpolant factory of its interpolation mode (the type declarations of three.js omit it). */
type SampledTrack = KeyframeTrack & { createInterpolant(): Interpolant };

/** The sample of a procedural motion with the weight of its layer in it. */
export interface ProceduralSample {
  readonly time: number;
  readonly phase: number;
  readonly weight: number;
}

/**
 * A procedural motion of a plugin (a pose layer that is code). `apply` changes the nodes of the model by the motion
 * at the sample, by `sample.weight` from 0 (no change) to 1. It must be a pure function of its inputs.
 */
export interface ProceduralMotion {
  readonly id: string;
  apply(node: (name: string) => Object3D | undefined, sample: ProceduralSample, params: Parameters): void;
}

type Property = "position" | "quaternion" | "scale";

interface Channel {
  readonly node: Object3D;
  readonly property: Property;
  readonly rest: readonly number[];
  /** The weighted sum of the clips of a layer, and the weight in it. */
  readonly sum: number[];
  weight: number;
}

interface BoundTrack {
  readonly channel: number;
  readonly interpolant: Interpolant;
  /** The value at time 0 (the reference of an additive layer). */
  readonly reference: readonly number[];
}

interface BoundClip {
  readonly duration: number;
  readonly tracks: readonly BoundTrack[];
}

export interface PoseMixerOptions {
  /** The root bone for the root motion "in-place" (default: the first bone of the model). */
  readonly rootBone?: string;
  readonly procedural?: ReadonlyMap<string, ProceduralMotion>;
}

const IDENTITY = new Quaternion();
const valueQ = new Quaternion();
const resultQ = new Quaternion();
const deltaQ = new Quaternion();
const valueV = new Vector3();
const resultV = new Vector3();

function read(channel: Channel): number[] {
  return channel.node[channel.property].toArray([]);
}

export class PoseMixer {
  /** The length of each clip in seconds, by clip name. */
  readonly lengths: ClipLengths;
  readonly #nodes = new Map<string, Object3D>();
  readonly #channels: Channel[] = [];
  readonly #clips = new Map<string, BoundClip>();
  readonly #masks = new Map<string, ReadonlySet<number>>();
  readonly #root: Object3D;
  readonly #rootBone: Object3D | undefined;
  readonly #procedural: ReadonlyMap<string, ProceduralMotion>;

  /** Bind the tracks of `clips` to the nodes of `root` with the same names. The nodes must be at their rest pose. */
  constructor(root: Object3D, clips: readonly AnimationClip[], options: PoseMixerOptions = {}) {
    this.#root = root;
    this.#procedural = options.procedural ?? new Map();
    let firstBone: Object3D | undefined;
    root.traverse((node) => {
      if (!this.#nodes.has(node.name)) this.#nodes.set(node.name, node);
      if (firstBone === undefined && (node as Partial<{ isBone: boolean }>).isBone === true) firstBone = node;
    });
    this.#rootBone = options.rootBone === undefined ? firstBone : this.#nodes.get(options.rootBone);
    const byKey = new Map<string, number>();
    const lengths: Record<string, number> = {};
    for (const clip of clips) {
      const tracks: BoundTrack[] = [];
      for (const track of clip.tracks) {
        const { nodeName, propertyName } = PropertyBinding.parseTrackName(track.name);
        const node = this.#nodes.get(nodeName);
        if (node === undefined || !["position", "quaternion", "scale"].includes(propertyName)) continue;
        const property = propertyName as Property;
        const key = `${node.uuid}.${property}`;
        let channel = byKey.get(key);
        if (channel === undefined) {
          channel = this.#channels.length;
          byKey.set(key, channel);
          const rest = node[property].toArray([]);
          this.#channels.push({ node, property, rest, sum: rest.map(() => 0), weight: 0 });
        }
        const interpolant = (track as SampledTrack).createInterpolant();
        tracks.push({ channel, interpolant, reference: Array.from(interpolant.evaluate(0)) });
      }
      this.#clips.set(clip.name, { duration: clip.duration, tracks });
      lengths[clip.name] = clip.duration;
    }
    this.lengths = lengths;
  }

  /** The node of the model with a name (the first in tree order), or undefined. */
  node(name: string): Object3D | undefined {
    return this.#nodes.get(name);
  }

  /** The root of the model. */
  get root(): Object3D {
    return this.#root;
  }

  /** Put every bound node back to its rest pose. */
  reset(): void {
    for (const channel of this.#channels) channel.node[channel.property].fromArray(channel.rest);
  }

  /** Put the pose of one clip at `time` seconds on the model, over the rest pose (the foot lock measures with it). */
  sampleClip(name: string, time: number): boolean {
    const clip = this.#clips.get(name);
    if (clip === undefined) return false;
    this.reset();
    for (const track of clip.tracks) {
      const channel = this.#channels[track.channel];
      channel?.node[channel.property].fromArray(track.interpolant.evaluate(time));
    }
    return true;
  }

  /** Put a frame on the model: the rest pose, then each layer, then the root motion choice. */
  apply(frame: AnimatorFrame, params: Parameters = {}): void {
    this.reset();
    for (const layer of frame.layers) {
      if (layer.weight <= 0) continue;
      if (layer.blend === "additive") this.#additive(layer);
      else this.#override(layer);
      for (const sample of layer.samples) this.#procedure(sample, layer.weight, params);
    }
    if (frame.rootMotion === "in-place") this.#inPlace();
  }

  /** The channels that a layer mask lets through: the nodes of the mask and their children. */
  #mask(names: readonly string[] | null): ReadonlySet<number> | null {
    if (names === null) return null;
    const key = names.join("\n");
    let set = this.#masks.get(key);
    if (set === undefined) {
      const roots = new Set(names);
      const allowed = new Set<number>();
      this.#channels.forEach((channel, index) => {
        for (let node: Object3D | null = channel.node; node !== null; node = node.parent) {
          if (roots.has(node.name)) {
            allowed.add(index);
            break;
          }
          if (node === this.#root) break;
        }
      });
      set = allowed;
      this.#masks.set(key, set);
    }
    return set;
  }

  #override(layer: LayerPose): void {
    const mask = this.#mask(layer.mask);
    let total = 0;
    const touched = new Set<number>();
    for (const sample of layer.samples) {
      const clip = sample.kind === "clip" ? this.#clips.get(sample.clip) : undefined;
      if (clip === undefined || sample.weight <= 0) continue;
      total += sample.weight;
      for (const track of clip.tracks) {
        if (mask !== null && !mask.has(track.channel)) continue;
        const channel = this.#channels[track.channel];
        if (channel === undefined) continue;
        if (!touched.has(track.channel)) {
          touched.add(track.channel);
          channel.sum.fill(0);
          channel.weight = 0;
        }
        accumulate(channel, track.interpolant.evaluate(sample.time), sample.weight);
      }
    }
    if (total <= 0) return;
    // determinism: ordered (the set keeps the order of insertion)
    for (const index of touched) {
      const channel = this.#channels[index];
      if (channel === undefined) continue;
      // A clip with no track for the channel gives the rest value.
      if (channel.weight < total) accumulate(channel, channel.rest, total - channel.weight);
      mix(channel, layer.weight);
    }
  }

  #additive(layer: LayerPose): void {
    const mask = this.#mask(layer.mask);
    for (const sample of layer.samples) {
      const clip = sample.kind === "clip" ? this.#clips.get(sample.clip) : undefined;
      const weight = sample.weight * layer.weight;
      if (clip === undefined || weight <= 0) continue;
      for (const track of clip.tracks) {
        const channel = this.#channels[track.channel];
        if (channel === undefined || (mask !== null && !mask.has(track.channel))) continue;
        addMotion(channel, track.interpolant.evaluate(sample.time), track.reference, weight);
      }
    }
  }

  #procedure(sample: MotionSample, layerWeight: number, params: Parameters): void {
    if (sample.kind !== "procedural") return;
    const motion = this.#procedural.get(sample.id);
    const weight = sample.weight * layerWeight;
    if (motion === undefined || weight <= 0) return;
    motion.apply((name) => this.#nodes.get(name), { time: sample.time, phase: sample.phase, weight }, params);
  }

  /** The root motion "in-place": the root bone keeps the floor place (x and z in the model frame) of its rest pose. */
  #inPlace(): void {
    const bone = this.#rootBone;
    const parent = bone?.parent;
    const rest =
      bone === undefined ? undefined : this.#channels.find((c) => c.node === bone && c.property === "position");
    if (bone === undefined || parent === null || parent === undefined || rest === undefined) return;
    this.#root.updateMatrixWorld(true);
    const toModel = this.#root.matrixWorld.clone().invert().multiply(parent.matrixWorld);
    const now = valueV.copy(bone.position).applyMatrix4(toModel);
    const before = resultV.fromArray(rest.rest).applyMatrix4(toModel);
    now.set(before.x, now.y, before.z).applyMatrix4(toModel.invert());
    bone.position.copy(now);
  }
}

/** Add `weight` × `value` to the sum of a channel. A rotation keeps the sign of the first rotation in the sum. */
function accumulate(channel: Channel, value: ArrayLike<number>, weight: number): void {
  const sum = channel.sum;
  let sign = 1;
  if (channel.property === "quaternion" && channel.weight > 0) {
    const dot = (sum[0] ?? 0) * (value[0] ?? 0) + (sum[1] ?? 0) * (value[1] ?? 0);
    sign = dot + (sum[2] ?? 0) * (value[2] ?? 0) + (sum[3] ?? 0) * (value[3] ?? 0) < 0 ? -1 : 1;
  }
  for (let index = 0; index < sum.length; index += 1)
    sum[index] = (sum[index] ?? 0) + sign * weight * (value[index] ?? 0);
  channel.weight += weight;
}

/** Mix the average of the sum of a channel into its node by the layer weight. */
function mix(channel: Channel, weight: number): void {
  const target = channel.node[channel.property];
  const average = channel.sum.map((item) => item / channel.weight);
  if (channel.property === "quaternion") {
    resultQ.fromArray(average).normalize();
    (target as Quaternion).slerp(resultQ, Math.min(1, weight));
    return;
  }
  const now = read(channel);
  target.fromArray(now.map((item, index) => item + ((average[index] ?? item) - item) * Math.min(1, weight)));
}

/** Add the motion of a clip track away from its value at time 0, by `weight`, to the node. Scale is not added. */
function addMotion(channel: Channel, value: ArrayLike<number>, reference: readonly number[], weight: number): void {
  if (channel.property === "scale") return;
  if (channel.property === "quaternion") {
    deltaQ.fromArray(reference).invert().multiply(valueQ.fromArray(value));
    channel.node.quaternion.multiply(weight < 1 ? resultQ.slerpQuaternions(IDENTITY, deltaQ, weight) : deltaQ);
    return;
  }
  const position = channel.node.position;
  position.x += ((value[0] ?? 0) - (reference[0] ?? 0)) * weight;
  position.y += ((value[1] ?? 0) - (reference[1] ?? 0)) * weight;
  position.z += ((value[2] ?? 0) - (reference[2] ?? 0)) * weight;
}
