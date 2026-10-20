// SPDX-License-Identifier: Apache-2.0
/**
 * The forms of the keys of each track kind. A new key of a kind with no value of the frame (an event, an action, a
 * clip, a camera cut, an attach) gets a first value here, and the key form edits the fields of the selected key. The
 * camera cuts name the camera entities of the scene; the actions name the actions of the input maps and of the action
 * keys of the sequence. Pure functions, no DOM.
 */
import type { EntityDocument } from "@scenity/scene";
import type { SequenceDocument, Track } from "@scenity/scene/sequence";

/** The kinds of track, in the order of the add form. */
export const TRACK_KIND_ORDER = [
  "transform",
  "property",
  "visibility",
  "animation",
  "attach",
  "audio",
  "camera",
  "event",
  "action",
] as const;
export type TrackKindName = (typeof TRACK_KIND_ORDER)[number];

/** True for a kind of track with no entity (a track of the sequence). */
export function sequenceKind(kind: string): boolean {
  return kind === "camera" || kind === "event" || kind === "action";
}

/** The camera references of the scene (`entity:<id>`), in ID order. */
export function cameraRefs(scene: EntityDocument): string[] {
  return Object.entries(scene.entities)
    .filter(([, entity]) => entity.components.camera !== undefined)
    .map(([id]) => `entity:${id}`)
    .sort();
}

/** The action names of the sequence (its action keys) and of more names (the input maps), sorted. */
export function actionNames(sequence: SequenceDocument, more: readonly string[] = []): string[] {
  const keys = sequence.tracks.flatMap((track) => (track.kind === "action" ? track.keys.map((key) => key.action) : []));
  return [...new Set([...keys, ...more])].sort();
}

/**
 * The first value of a new key of a track (JSON fields), or undefined when the command takes the value of the frame
 * (a transform, a property, a visibility or an audio key).
 */
export function firstKeyFields(
  track: Track,
  scene: EntityDocument,
  actions: readonly string[],
): Record<string, unknown> | undefined {
  switch (track.kind) {
    case "event":
      return { name: "event" };
    case "action":
      return { action: actions[0] ?? "plugin.action" };
    case "animation":
      return { clip: null };
    case "camera": {
      const first = cameraRefs(scene)[0];
      return first === undefined ? undefined : { camera: first };
    }
    case "attach":
      return { to: null };
    default:
      return undefined;
  }
}

/** The fields of a key with no time and no ease (the value of `sequence.key.value`). */
export function keyFields(key: Readonly<Record<string, unknown>>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(key).filter(([name]) => name !== "t" && name !== "ease"));
}
