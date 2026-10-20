// SPDX-License-Identifier: Apache-2.0
/**
 * The keys of the inspector: the key mark adjacent to each field that a track of the open sequence can drive. A field
 * of a component is the property track `<component>/<field>` of the entity. The position, the rotation and the scale
 * of `transform` are the parts of its transform track. The mark is "none" (no track), "track" (a track, but no key at
 * the time of the clock) or "key" (a key at that time). A press on the mark keys the value of the field at the time
 * of the clock. If the track does not exist, the press adds it first. The record mode is the record mode of the open
 * sequence, and the inspector also shows it.
 */
import { findTrack } from "@scenity/editor-core";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { shallowRef, type ShallowRef } from "vue";
import type { ClockState } from "./clockState";
import type { PageSequence } from "./pageSequence";

export type KeyMark = "none" | "track" | "key";

/** The parts of a transform track. */
const TRANSFORM_PARTS = ["position", "rotation", "scale"] as const;

/** The track that drives a field of an entity: its kind, entity and property path (none for a transform part). */
export function fieldTrack(
  entity: string,
  component: string,
  path: readonly (string | number)[],
): { kind: "transform" | "property"; entity: string; path?: string } | null {
  if (path.length === 0) return null;
  if (component === "transform") {
    const part = path[0];
    return path.length === 1 && TRANSFORM_PARTS.includes(part as (typeof TRANSFORM_PARTS)[number])
      ? { kind: "transform", entity }
      : null;
  }
  return { kind: "property", entity, path: [component, ...path.map(String)].join("/") };
}

/** The index of the track of a field, or -1. */
function trackIndex(sequence: SequenceDocument, found: NonNullable<ReturnType<typeof fieldTrack>>): number {
  return findTrack(sequence, { kind: found.kind, entity: found.entity, path: found.path ?? "" });
}

/** The mark of a field at a time. */
export function keyMark(
  sequence: SequenceDocument,
  entity: string,
  component: string,
  path: readonly (string | number)[],
  t: number,
): KeyMark {
  const found = fieldTrack(entity, component, path);
  if (found === null) return "none";
  const index = trackIndex(sequence, found);
  const track = sequence.tracks[index];
  if (track === undefined) return "none";
  const part = component === "transform" ? String(path[0]) : null;
  const keyed = track.keys.some(
    (key) => key.t === Math.round(t) && (part === null || (key as Record<string, unknown>)[part] !== undefined),
  );
  return keyed ? "key" : "track";
}

/** The keys of the inspector over the open sequence and the clock of the page. */
export class SequenceKeys {
  readonly #sequence: PageSequence;
  readonly #clock: ClockState;
  /** The current sequence document (the marks follow each change). */
  readonly doc: ShallowRef<SequenceDocument>;
  readonly recording: ShallowRef<boolean>;

  constructor(sequence: PageSequence, clock: ClockState) {
    this.#sequence = sequence;
    this.#clock = clock;
    this.doc = shallowRef(sequence.channel.doc);
    this.recording = shallowRef(sequence.recording);
    sequence.channel.listen((doc) => (this.doc.value = doc));
    sequence.listenRecord((on) => (this.recording.value = on));
  }

  /** The mark of a field of an entity at the time of the clock. */
  mark(entity: string, component: string, path: readonly (string | number)[]): KeyMark {
    return keyMark(this.doc.value, entity, component, path, this.#clock.time.value);
  }

  /** True when a track can drive the field. */
  keyable(component: string, path: readonly (string | number)[]): boolean {
    return fieldTrack("entity", component, path) !== null;
  }

  /** Key the value of a field at the time of the clock. If the track does not exist, add it first. */
  async key(entity: string, component: string, path: readonly (string | number)[], value: unknown): Promise<void> {
    const found = fieldTrack(entity, component, path);
    if (found === null) return;
    let index = trackIndex(this.doc.value, found);
    if (index < 0) {
      await this.#sequence.run("sequence.track.add", {
        kind: found.kind,
        entity,
        ...(found.path === undefined ? {} : { path: found.path }),
      });
      index = trackIndex(this.#sequence.channel.doc, found);
    }
    const fields = found.kind === "transform" ? { [String(path[0])]: value } : value;
    await this.#sequence.run("sequence.key.add", {
      track: index,
      t: Math.round(this.#clock.time.value),
      value: JSON.stringify(fields),
    });
  }

  setRecording(on: boolean): void {
    this.#sequence.setRecording(on);
  }
}

/** The keys of the inspector of the page (null when no sequence is open). */
const current = shallowRef<SequenceKeys | null>(null);

export function pageSequenceKeys(): SequenceKeys | null {
  return current.value;
}

export function setPageSequenceKeys(keys: SequenceKeys | null): void {
  current.value = keys;
}
