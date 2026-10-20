// SPDX-License-Identifier: Apache-2.0
/**
 * The sequence ops: the edits of the open `*.sequence.json` document. Each op is one change of the sequence channel of
 * the one history (history.ts): add or remove a track, put, move, change or delete a key, and set or remove a marker.
 * The apply keeps the keys of each track in time order and checks the result with the schema of `@scenity/scene`. The
 * functions are pure. No Vue import.
 */
import { sequenceSchema, type SequenceDocument, type Track } from "@scenity/scene/sequence";
import { defineOpKind, EditError } from "../ops";

/** The name of the channel of the sequence document in the history. */
export const SEQUENCE_CHANNEL = "sequence";

/** A key of any track kind: its time and the fields of its kind (the schema checks them). */
export type TrackKey = Track["keys"][number];

/** One change of the sequence document. A track is its index in `tracks`, and a key is its index in the track. */
export type SequenceChange =
  | { readonly type: "addTrack"; readonly track: Track }
  | { readonly type: "removeTrack"; readonly track: number }
  /** Put a key at its time. A key at the same time takes its fields (a transform key keeps the other parts). */
  | { readonly type: "putKey"; readonly track: number; readonly key: TrackKey }
  | { readonly type: "moveKey"; readonly track: number; readonly key: number; readonly t: number }
  /** Replace a key (its time can also change). */
  | { readonly type: "setKey"; readonly track: number; readonly key: number; readonly value: TrackKey }
  | { readonly type: "deleteKey"; readonly track: number; readonly key: number }
  /** Set the time of a marker. Null removes it. */
  | { readonly type: "marker"; readonly name: string; readonly t: number | null }
  /** Set the duration, the loop flag (null: no flag) or the initial state (null: none) of the sequence. */
  | {
      readonly type: "settings";
      readonly duration?: number;
      readonly loop?: boolean | null;
      readonly initial?: SequenceDocument["initial"] | null;
      /** The rules of the sequence (null or an empty list: none). */
      readonly rules?: SequenceDocument["rules"] | null;
    };

/** An op of the sequence channel. */
export interface SequenceOp {
  readonly kind: "sequence";
  readonly change: SequenceChange;
}

const CHANGE_TYPES: readonly string[] = [
  "addTrack",
  "removeTrack",
  "putKey",
  "moveKey",
  "setKey",
  "deleteKey",
  "marker",
  "settings",
];

/** The keys with `key` at its place: after each key at the same time or before it. */
function insertKey<K extends { readonly t: number }>(keys: readonly K[], key: K): K[] {
  let index = keys.length;
  while (index > 0 && (keys[index - 1]?.t ?? 0) > key.t) index -= 1;
  return [...keys.slice(0, index), key, ...keys.slice(index)];
}

function trackAt(doc: SequenceDocument, index: number): Track {
  const track = doc.tracks[index];
  if (track === undefined) throw new EditError(`The sequence has no track ${String(index)}.`);
  return track;
}

function keyAt(track: Track, index: number): TrackKey {
  const key = track.keys[index];
  if (key === undefined) throw new EditError(`The track has no key ${String(index)}.`);
  return key;
}

/** The track with new keys. The kinds share the key list shape, and the schema checks the fields. */
function withKeys(track: Track, keys: readonly TrackKey[]): Track {
  return { ...track, keys } as Track;
}

function replaceTrack(doc: SequenceDocument, index: number, track: Track): SequenceDocument {
  return { ...doc, tracks: doc.tracks.map((item, at) => (at === index ? track : item)) };
}

/** Put a key at its time. The last key at the same time takes its fields. */
function putKey(track: Track, key: TrackKey): Track {
  const keys: readonly TrackKey[] = track.keys;
  let same = -1;
  keys.forEach((item, index) => {
    if (item.t === key.t) same = index;
  });
  if (same < 0) return withKeys(track, insertKey(keys, key));
  const merged = track.kind === "transform" ? { ...keys[same], ...key } : key;
  return withKeys(
    track,
    keys.map((item, index) => (index === same ? merged : item)),
  );
}

/** The document after one change. A bad change throws an EditError. */
function change(doc: SequenceDocument, op: SequenceChange): SequenceDocument {
  switch (op.type) {
    case "addTrack":
      return { ...doc, tracks: [...doc.tracks, op.track] };
    case "removeTrack":
      trackAt(doc, op.track);
      return { ...doc, tracks: doc.tracks.filter((_, index) => index !== op.track) };
    case "putKey":
      return replaceTrack(doc, op.track, putKey(trackAt(doc, op.track), op.key));
    case "moveKey":
    case "setKey":
    case "deleteKey": {
      const track = trackAt(doc, op.track);
      const key = keyAt(track, op.key);
      const rest = track.keys.filter((_, index) => index !== op.key);
      if (op.type === "deleteKey") return replaceTrack(doc, op.track, withKeys(track, rest));
      const next = op.type === "moveKey" ? { ...key, t: op.t } : op.value;
      return replaceTrack(doc, op.track, withKeys(track, insertKey<TrackKey>(rest, next)));
    }
    case "marker": {
      const kept = Object.entries(doc.markers ?? {}).filter(([name]) => name !== op.name);
      const markers = Object.fromEntries(op.t === null ? kept : [...kept, [op.name, op.t]]);
      const rest: SequenceDocument = { ...doc };
      delete rest.markers;
      return Object.keys(markers).length === 0 ? rest : { ...rest, markers };
    }
    case "settings": {
      const next: SequenceDocument = { ...doc, ...(op.duration === undefined ? {} : { duration: op.duration }) };
      if (op.loop === null) delete next.loop;
      else if (op.loop !== undefined) next.loop = op.loop;
      if (op.initial === null) delete next.initial;
      else if (op.initial !== undefined) next.initial = op.initial;
      if (op.rules === null || op.rules?.length === 0) delete next.rules;
      else if (op.rules !== undefined) next.rules = op.rules;
      return next;
    }
  }
}

/** The sequence document after a change, checked by the schema. A bad change throws an EditError. */
export function applySequenceChange(doc: SequenceDocument, op: SequenceChange): SequenceDocument {
  const next = change(doc, op);
  const checked = sequenceSchema.safeParse(next);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    const where = issue === undefined ? "" : `/${issue.path.map(String).join("/")}: `;
    throw new EditError(`The sequence change is not valid (${where}${issue?.message ?? "no reason"}).`);
  }
  return next;
}

/** The sequence ops: each one changes the sequence document of the channel `sequence`. */
export const SEQUENCE_OP = defineOpKind<SequenceOp, SequenceDocument>({
  kind: "sequence",
  channel: SEQUENCE_CHANNEL,
  problem(op) {
    const value = op.change as { type?: unknown } | null | undefined;
    if (typeof value !== "object" || value === null) return "a sequence op has a change.";
    return CHANGE_TYPES.includes(String(value.type)) ? null : `a sequence change is one of ${CHANGE_TYPES.join(", ")}.`;
  },
  apply: (doc, op) => applySequenceChange(doc, op.change),
});

/** A sequence op of a change. */
export function sequenceOp(value: SequenceChange): SequenceOp {
  return { kind: "sequence", change: value };
}
