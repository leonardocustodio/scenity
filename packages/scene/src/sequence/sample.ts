// SPDX-License-Identifier: Apache-2.0
/**
 * The track samples: the value of each track at a time `t` in ms. The sequencer UI, the lanes and the
 * evaluator read them. The ease of a key gives the curve from the key before it to the key. A curve (a property or a
 * transform part) holds its first value before its first key and its last value after its last key. A step track
 * (visibility, camera, attach, animation, audio) gives no value before its first key.
 */
import type { JsonValue } from "../json";
import { qslerp, vlerp } from "../math";
import type { Quat, Vec3 } from "../schema/common";
import type {
  AnimationTrack,
  AudioTrack,
  Ease,
  PropertyTrack,
  Track,
  TrackKind,
  TransformKey,
  TransformTrack,
} from "../schema/sequence";
import { applyEase } from "./ease";

/** A clip that plays at a time: the local clip time in ms is `(t - start) × speed`, with no wrap for a loop. */
export interface ActiveClip {
  readonly clip: string;
  /** The name of the clip in the asset, or undefined for the first clip of the asset. */
  readonly name?: string;
  /** The time of the key that starts the clip. */
  readonly start: number;
  readonly time: number;
  readonly speed: number;
  readonly loop: boolean;
  /** The weight in 0..1. In a crossfade, the weights of the two clips add to 1. */
  readonly weight: number;
}

/** The sound of an audio track at a time: the play key before the time, with no stop key after it. */
export interface AudioCue {
  /** The asset of the key, or undefined for the asset of the `audioSource` component of the entity. */
  readonly sound: string | undefined;
  /** The index of the play key in the track. */
  readonly key: number;
  /** The time on the time line where the position in the sound is 0: the key time minus the offset. */
  readonly start: number;
}

export type TrackSample =
  | { readonly kind: "property"; readonly entity: string; readonly path: string; readonly value: JsonValue | undefined }
  | {
      readonly kind: "transform";
      readonly entity: string;
      readonly position: Vec3 | undefined;
      readonly rotation: Quat | undefined;
      readonly scale: Vec3 | undefined;
    }
  | { readonly kind: "visibility"; readonly entity: string; readonly visible: boolean | undefined }
  /** `last` is the index of the last key at or before `t`, or -1. */
  | { readonly kind: "event" | "action"; readonly entity: string | undefined; readonly last: number }
  | { readonly kind: "animation"; readonly entity: string; readonly clips: readonly ActiveClip[] }
  | { readonly kind: "camera"; readonly camera: string | undefined }
  | { readonly kind: "attach"; readonly entity: string; readonly to: string | null | undefined }
  | { readonly kind: "audio"; readonly entity: string; readonly cue: AudioCue | undefined };

/** The sample of each kind of track. */
export type TrackSampleOf<K extends TrackKind> = Extract<TrackSample, { kind: K }>;

/** The index of the last key at or before `t`, or -1 when the first key is after `t`. The keys are in time order. */
export function lastKeyAt(keys: readonly { readonly t: number }[], t: number): number {
  let low = 0;
  let high = keys.length;
  while (low < high) {
    const middle = (low + high) >>> 1;
    if ((keys[middle]?.t ?? 0) <= t) low = middle + 1;
    else high = middle;
  }
  return low - 1;
}

/** The value of a curve at `t`, or undefined for a curve with no keys. */
export function sampleCurve<K extends { readonly t: number; readonly ease?: Ease | undefined }, V>(
  keys: readonly K[],
  t: number,
  value: (key: K) => V,
  mix: (a: V, b: V, fraction: number) => V,
): V | undefined {
  const first = keys[0];
  if (first === undefined) return undefined;
  const index = lastKeyAt(keys, t);
  const key = keys[index];
  if (key === undefined) return value(first);
  const next = keys[index + 1];
  if (next === undefined) return value(key);
  const fraction = applyEase(next.ease, (t - key.t) / (next.t - key.t));
  return fraction === 0 ? value(key) : mix(value(key), value(next), fraction);
}

function isNumberList(value: unknown): value is number[] {
  return Array.isArray(value) && value.every((item) => typeof item === "number");
}

/** The mix of two values of a property: numbers and number lists of one length interpolate. Other values step. */
export function mixValues(a: JsonValue, b: JsonValue, fraction: number): JsonValue {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * fraction;
  if (isNumberList(a) && isNumberList(b) && a.length === b.length) {
    return a.map((item, index) => item + ((b[index] ?? item) - item) * fraction);
  }
  return fraction >= 1 ? b : a;
}

interface TransformChannels {
  readonly position: readonly TransformKey[];
  readonly rotation: readonly TransformKey[];
  readonly scale: readonly TransformKey[];
}

/** The keys of each part of a transform track, for each track object. It is a cache: its loss changes no sample. */
const channelCache = new WeakMap<TransformTrack, TransformChannels>();

function channelsOf(track: TransformTrack): TransformChannels {
  let channels = channelCache.get(track);
  if (channels === undefined) {
    channels = {
      position: track.keys.filter((key) => key.position !== undefined),
      rotation: track.keys.filter((key) => key.rotation !== undefined),
      scale: track.keys.filter((key) => key.scale !== undefined),
    };
    channelCache.set(track, channels);
  }
  return channels;
}

function sampleTransform(track: TransformTrack, t: number): TrackSampleOf<"transform"> {
  const channels = channelsOf(track);
  const vec = (part: "position" | "scale") => (key: TransformKey) => key[part] as Vec3;
  return {
    kind: "transform",
    entity: track.entity,
    position: sampleCurve(channels.position, t, vec("position"), vlerp),
    rotation: sampleCurve(channels.rotation, t, (key) => key.rotation as Quat, qslerp),
    scale: sampleCurve(channels.scale, t, vec("scale"), vlerp),
  };
}

function sampleProperty(track: PropertyTrack, t: number): TrackSampleOf<"property"> {
  const value = sampleCurve(track.keys, t, (key) => key.value, mixValues);
  return { kind: "property", entity: track.entity, path: track.path, value };
}

function clipOf(key: AnimationTrack["keys"][number], t: number, weight: number): ActiveClip[] {
  if (key.clip === null || weight <= 0) return [];
  const speed = key.speed ?? 1;
  const name = key.name === undefined ? {} : { name: key.name };
  return [{ clip: key.clip, ...name, start: key.t, time: (t - key.t) * speed, speed, loop: key.loop ?? false, weight }];
}

/** The clips of an animation track at `t`: the clip of the last key, and in its blend time the clip before it. */
function sampleAnimation(track: AnimationTrack, t: number): TrackSampleOf<"animation"> {
  const index = lastKeyAt(track.keys, t);
  const key = track.keys[index];
  if (key === undefined) return { kind: "animation", entity: track.entity, clips: [] };
  const blend = key.blend ?? 0;
  const previous = track.keys[index - 1];
  if (blend <= 0 || previous === undefined || t - key.t >= blend) {
    return { kind: "animation", entity: track.entity, clips: clipOf(key, t, 1) };
  }
  const weight = (t - key.t) / blend;
  const clips = [...clipOf(previous, t, 1 - weight), ...clipOf(key, t, weight)];
  return { kind: "animation", entity: track.entity, clips };
}

/** The sound of an audio track at `t`: the last key at or before `t`, when it is a play key. */
function sampleAudio(track: AudioTrack, t: number): TrackSampleOf<"audio"> {
  const index = lastKeyAt(track.keys, t);
  const key = track.keys[index];
  if (key?.play !== true) return { kind: "audio", entity: track.entity, cue: undefined };
  return {
    kind: "audio",
    entity: track.entity,
    cue: { sound: key.sound, key: index, start: key.t - (key.offset ?? 0) },
  };
}

/** The value of the last key at or before `t` of a step track, or undefined before the first key. */
function stepValue<K extends { readonly t: number }, V>(keys: readonly K[], t: number, value: (key: K) => V) {
  const key = keys[lastKeyAt(keys, t)];
  return key === undefined ? undefined : value(key);
}

/** The sample of a track at `t` (ms). The function is pure. */
export function sampleTrack(track: Track, t: number): TrackSample {
  switch (track.kind) {
    case "property":
      return sampleProperty(track, t);
    case "transform":
      return sampleTransform(track, t);
    case "visibility":
      return { kind: "visibility", entity: track.entity, visible: stepValue(track.keys, t, (key) => key.visible) };
    case "event":
    case "action":
      return { kind: track.kind, entity: track.entity, last: lastKeyAt(track.keys, t) };
    case "animation":
      return sampleAnimation(track, t);
    case "camera":
      return { kind: "camera", camera: stepValue(track.keys, t, (key) => key.camera) };
    case "attach":
      return { kind: "attach", entity: track.entity, to: stepValue(track.keys, t, (key) => key.to) };
    case "audio":
      return sampleAudio(track, t);
  }
}
