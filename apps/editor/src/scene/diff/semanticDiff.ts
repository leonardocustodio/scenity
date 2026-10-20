// SPDX-License-Identifier: Apache-2.0
/**
 * The semantic diff of two documents: the changes of a scene or a prefab by entity and
 * component, and the changes of a sequence by track and key time. Each changed value has its field, its old value and
 * its new value (undefined: the field is not there). Review, the change sets, the conflict dialog and the version
 * control panel show it with `SemanticDiff.vue`. Pure functions, no DOM.
 */
import { diffValues, parsePointer } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity } from "@scenity/scene/schema/entity";

/** The state of a part of a document from the old version to the new one. */
export type ChangeState = "added" | "removed" | "changed";

/** One changed value: its dotted field path, its old value and its new value. */
export interface ValueChange {
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

export interface ComponentChange {
  readonly component: string;
  readonly state: ChangeState;
  readonly values: readonly ValueChange[];
}

export interface EntityChange {
  readonly id: string;
  readonly name: string;
  readonly state: ChangeState;
  /** The parent before and after, when it changed (null: the root). */
  readonly parent?: { readonly before: string | null; readonly after: string | null };
  /** The changed fields of the entity that are not components (the name, the tags). */
  readonly values: readonly ValueChange[];
  readonly components: readonly ComponentChange[];
}

export interface KeyChange {
  /** The key time in ms. */
  readonly t: number;
  readonly state: ChangeState;
  readonly values: readonly ValueChange[];
}

export interface TrackChange {
  /** The kind, the entity and the path of the track: a track has no ID. */
  readonly track: string;
  readonly state: ChangeState;
  readonly values: readonly ValueChange[];
  readonly keys: readonly KeyChange[];
}

/** The diff of two documents: the top fields, and the entities or the tracks. */
export interface DocumentDiff {
  readonly kind: "entities" | "sequence";
  readonly values: readonly ValueChange[];
  readonly entities: readonly EntityChange[];
  readonly tracks: readonly TrackChange[];
}

type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function valueAt(value: unknown, tokens: readonly string[]): unknown {
  let at = value;
  for (const token of tokens) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Json)[token];
  }
  return at;
}

/** The changed values from `a` to `b`, with the field paths below `a` and `b`. */
export function valueChanges(a: unknown, b: unknown): ValueChange[] {
  const numbers = (value: unknown): boolean => Array.isArray(value) && value.every((item) => typeof item === "number");
  const out = new Map<string, ValueChange>();
  for (const op of diffValues(a, b, [])) {
    let tokens = parsePointer(op.path) ?? [];
    // A changed item of a vector (a position, a colour) shows as the whole vector.
    const parent = tokens.slice(0, -1);
    if (tokens.length > 0 && numbers(valueAt(a, parent)) && numbers(valueAt(b, parent))) tokens = parent;
    const field = tokens.join(".");
    out.set(field, { field, before: valueAt(a, tokens), after: valueAt(b, tokens) });
  }
  return [...out.values()];
}

/** The fields of an object without some keys. */
const without = (value: Json, keys: readonly string[]): Json =>
  Object.fromEntries(Object.entries(value).filter(([key]) => !keys.includes(key)));

/** The component changes of one entity. */
function componentChanges(before: Entity | undefined, after: Entity | undefined): ComponentChange[] {
  const a = (before?.components ?? {}) as Json;
  const b = (after?.components ?? {}) as Json;
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].sort().flatMap((component): ComponentChange[] => {
    if (!(component in a)) return [{ component, state: "added", values: valueChanges({}, b[component]) }];
    if (!(component in b)) return [{ component, state: "removed", values: [] }];
    const values = valueChanges(a[component], b[component]);
    return values.length === 0 ? [] : [{ component, state: "changed", values }];
  });
}

/** The diff of two scene or prefab documents, by entity (in the order of the IDs) and component. */
export function entityDiff(from: EntityDocument, to: EntityDocument): DocumentDiff {
  const ids = [...new Set([...Object.keys(from.entities), ...Object.keys(to.entities)])].sort();
  const entities = ids.flatMap((id): EntityChange[] => {
    const before = from.entities[id];
    const after = to.entities[id];
    const name = after?.name ?? before?.name ?? id;
    const state: ChangeState = before === undefined ? "added" : after === undefined ? "removed" : "changed";
    const parentBefore = before?.parent ?? null;
    const parentAfter = after?.parent ?? null;
    const moved = state === "changed" && parentBefore !== parentAfter;
    const values =
      state === "removed"
        ? []
        : valueChanges(
            without(before ?? {}, ["components", "parent"]),
            without(after as Json, ["components", "parent"]),
          );
    const components = state === "removed" ? [] : componentChanges(before, after);
    if (state === "changed" && !moved && values.length === 0 && components.length === 0) return [];
    return [
      {
        id,
        name,
        state,
        ...(moved ? { parent: { before: parentBefore, after: parentAfter } } : {}),
        values,
        components,
      },
    ];
  });
  const top = valueChanges(without(from, ["entities"]), without(to, ["entities"]));
  return { kind: "entities", values: top, entities, tracks: [] };
}

/** The name of a track in a diff: its kind, its entity, and its path or its plugin (a new name is a changed value). */
function trackName(track: Json): string {
  return [track.kind, track.entity, track.path, track.plugin]
    .filter((part): part is string => typeof part === "string")
    .join(" ");
}

/** The tracks of a sequence by name; a second track of one name gets "#2". */
function tracksByName(doc: unknown): Map<string, Json> {
  const map = new Map<string, Json>();
  const tracks = isRecord(doc) && Array.isArray(doc.tracks) ? doc.tracks.filter(isRecord) : [];
  for (const track of tracks) {
    const name = trackName(track);
    let key = name;
    for (let count = 2; map.has(key); count += 1) key = `${name} #${String(count)}`;
    map.set(key, track);
  }
  return map;
}

/** The key changes of one track, by key time (a second key at one time gets its own place). */
function keyChanges(before: Json | undefined, after: Json | undefined): KeyChange[] {
  const keysOf = (track: Json | undefined): Map<string, Json> => {
    const map = new Map<string, Json>();
    const keys = Array.isArray(track?.keys) ? track.keys.filter(isRecord) : [];
    for (const key of keys) {
      let place = String(key.t);
      for (let count = 2; map.has(place); count += 1) place = `${String(key.t)}#${String(count)}`;
      map.set(place, key);
    }
    return map;
  };
  const a = keysOf(before);
  const b = keysOf(after);
  const places = [...new Set([...a.keys(), ...b.keys()])].sort((x, y) => parseFloat(x) - parseFloat(y));
  return places.flatMap((place): KeyChange[] => {
    const old = a.get(place);
    const next = b.get(place);
    const t = Number((next ?? old)?.t ?? 0);
    if (old === undefined && next !== undefined)
      return [{ t, state: "added", values: valueChanges({}, without(next, ["t"])) }];
    if (next === undefined) return [{ t, state: "removed", values: [] }];
    const values = valueChanges(without(old ?? {}, ["t"]), without(next, ["t"]));
    return values.length === 0 ? [] : [{ t, state: "changed", values }];
  });
}

/** The diff of two sequence documents, by track and key time. */
export function sequenceDiff(from: unknown, to: unknown): DocumentDiff {
  const a = tracksByName(from);
  const b = tracksByName(to);
  const tracks = [...new Set([...a.keys(), ...b.keys()])].flatMap((track): TrackChange[] => {
    const before = a.get(track);
    const after = b.get(track);
    const state: ChangeState = before === undefined ? "added" : after === undefined ? "removed" : "changed";
    const values =
      state === "changed" ? valueChanges(without(before ?? {}, ["keys"]), without(after ?? {}, ["keys"])) : [];
    const keys = state === "removed" ? [] : keyChanges(before, after);
    if (state === "changed" && values.length === 0 && keys.length === 0) return [];
    return [{ track, state, values, keys }];
  });
  const top = valueChanges(
    isRecord(from) ? without(from, ["tracks"]) : {},
    isRecord(to) ? without(to, ["tracks"]) : {},
  );
  return { kind: "sequence", values: top, entities: [], tracks };
}

/** The number of changes of a diff: each changed value, and each added or removed part once. */
export function changeCount(diff: DocumentDiff): number {
  const entity = diff.entities.reduce(
    (sum, item) =>
      sum +
      (item.state !== "changed"
        ? 1
        : (item.parent === undefined ? 0 : 1) +
          item.values.length +
          item.components.reduce((inner, part) => inner + (part.state === "changed" ? part.values.length : 1), 0)),
    0,
  );
  const track = diff.tracks.reduce(
    (sum, item) =>
      sum +
      (item.state !== "changed"
        ? 1
        : item.values.length +
          item.keys.reduce((inner, key) => inner + (key.state === "changed" ? key.values.length : 1), 0)),
    0,
  );
  return diff.values.length + entity + track;
}

/** The kind of diff of a file path, or null for a file that is not a scene, a prefab or a sequence. */
export function diffKindOf(path: string): "entities" | "sequence" | null {
  if (path.endsWith(".sequence.json")) return "sequence";
  return path.endsWith(".scene.json") || path.endsWith(".prefab.json") ? "entities" : null;
}

/** The diff of two texts of a document file (null: no file in that version); null for a text that is not JSON. */
export function documentDiff(path: string, before: string | null, after: string | null): DocumentDiff | null {
  const kind = diffKindOf(path);
  if (kind === null) return null;
  const read = (text: string | null): unknown => {
    if (text === null) return kind === "sequence" ? { tracks: [] } : { entities: {} };
    try {
      return JSON.parse(text) as unknown;
    } catch {
      return undefined;
    }
  };
  const a = read(before);
  const b = read(after);
  if (!isRecord(a) || !isRecord(b)) return null;
  if (kind === "sequence") return sequenceDiff(a, b);
  if (!isRecord(a.entities) || !isRecord(b.entities)) return null;
  return entityDiff(a as unknown as EntityDocument, b as unknown as EntityDocument);
}
