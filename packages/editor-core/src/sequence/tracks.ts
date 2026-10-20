// SPDX-License-Identifier: Apache-2.0
/**
 * The tracks of a sequence as the sequencer reads them: the track of an entity and a value, the label of a track, the
 * rows of the track list (one group per entity, then the tracks with no entity), and the value of a curve at a time
 * over the base scene. The functions are pure. No Vue import.
 */
import { escapeToken, getAt, type EntityDocument, type JsonValue, type Quat, type Vec3 } from "@scenity/scene";
import {
  propertyTokens,
  sampleTrack,
  type SequenceDocument,
  type Track,
  type TrackKind,
} from "@scenity/scene/sequence";

/** What a track animates: its kind, its entity and the path of a property track. */
export interface TrackTarget {
  readonly kind: TrackKind;
  readonly entity?: string | undefined;
  readonly path?: string | undefined;
}

/** The entity of a track, or undefined (a camera track, an event track with no entity). */
export function trackEntity(track: Track): string | undefined {
  return "entity" in track ? track.entity : undefined;
}

/** The index of the first track of a target, or -1. */
export function findTrack(doc: SequenceDocument, target: TrackTarget): number {
  return doc.tracks.findIndex(
    (track) =>
      track.kind === target.kind &&
      trackEntity(track) === target.entity &&
      (track.kind !== "property" || track.path === target.path),
  );
}

/** The label of a track in the track list: its name, else its kind and the path of a property track. */
export function trackLabel(track: Track): string {
  if (track.name !== undefined) return track.name;
  return track.kind === "property" ? track.path : track.kind;
}

/** One group of the track list: an entity (null: the tracks with no entity) and the indices of its tracks. */
export interface TrackGroup {
  readonly entity: string | null;
  readonly label: string;
  readonly tracks: readonly number[];
}

/** The groups of the track list: one per entity in the order of the first track, then the tracks with no entity. */
export function trackGroups(doc: SequenceDocument, scene?: EntityDocument): TrackGroup[] {
  const groups = new Map<string | null, number[]>();
  doc.tracks.forEach((track, index) => {
    const entity = trackEntity(track) ?? null;
    groups.set(entity, [...(groups.get(entity) ?? []), index]);
  });
  const ordered = [...groups.entries()].sort(([a], [b]) => (a === null ? 1 : 0) - (b === null ? 1 : 0));
  return ordered.map(([entity, tracks]) => ({
    entity,
    label: entity === null ? "Sequence" : (scene?.entities[entity]?.name ?? entity),
    tracks,
  }));
}

/** The default parts of a transform (the transform component schema). */
export const TRANSFORM_DEFAULTS = {
  position: [0, 0, 0] as Vec3,
  rotation: [0, 0, 0, 1] as Quat,
  scale: [1, 1, 1] as Vec3,
} as const;

export type TransformPart = keyof typeof TRANSFORM_DEFAULTS;

export const TRANSFORM_PARTS: readonly TransformPart[] = ["position", "rotation", "scale"];

/** The value of a component path (`camera/fov`) of an entity in the base scene, or undefined. */
export function baseValue(scene: EntityDocument, entity: string, path: string): JsonValue | undefined {
  const components = scene.entities[entity]?.components;
  return getAt(components, propertyTokens(path)) as JsonValue | undefined;
}

/** A property path from a component ID and its field tokens (each token escaped). */
export function propertyPath(component: string, tokens: readonly string[]): string {
  return [component, ...tokens].map(escapeToken).join("/");
}

/** The transform of an entity at `t`: the transform track of the sequence over the base values. */
export function transformAt(
  scene: EntityDocument,
  doc: SequenceDocument,
  entity: string,
  t: number,
): Record<TransformPart, Vec3 | Quat> {
  const index = findTrack(doc, { kind: "transform", entity });
  const track = doc.tracks[index];
  const sample = track === undefined ? undefined : sampleTrack(track, t);
  const parts = {} as Record<TransformPart, Vec3 | Quat>;
  for (const part of TRANSFORM_PARTS) {
    const sampled = sample?.kind === "transform" ? sample[part] : undefined;
    const base = baseValue(scene, entity, `transform/${part}`) as Vec3 | Quat | undefined;
    parts[part] = sampled ?? base ?? TRANSFORM_DEFAULTS[part];
  }
  return parts;
}

/** The value of a property at `t`: the property track of the sequence over the base value. */
export function propertyAt(
  scene: EntityDocument,
  doc: SequenceDocument,
  entity: string,
  path: string,
  t: number,
): JsonValue | undefined {
  const track = doc.tracks[findTrack(doc, { kind: "property", entity, path })];
  const sample = track === undefined ? undefined : sampleTrack(track, t);
  const sampled = sample?.kind === "property" ? sample.value : undefined;
  return sampled ?? baseValue(scene, entity, path);
}

/** True for a value that a curve interpolates: a number, or a list of numbers. */
export function isCurveValue(value: unknown): value is number | number[] {
  return typeof value === "number" || (Array.isArray(value) && value.every((item) => typeof item === "number"));
}
