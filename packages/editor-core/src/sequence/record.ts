// SPDX-License-Identifier: Apache-2.0
/**
 * The record mode of the sequencer. While the record mode is active, an edit of a value that a track can key writes a
 * key at the time of the clock and leaves the base scene as it is:
 *
 * - a part of a transform (`position`, `rotation`, `scale`) gives a key of the transform track of the entity;
 * - `visibility/visible` gives a key of the visibility track;
 * - another component value gives a key of a property track: the path of a property track of the entity that holds
 *   the value, else the shortest path to a number, a list of numbers or a boolean (`light/intensity`).
 *
 * The key gets the change of the edit on top of the value of the sequence at that time. Thus a drag of an animated
 * entity moves it from the place that the frame shows. A position adds the change, a scale multiplies it, a rotation
 * turns by it and a number adds it. Another value takes the new value. An edit with any other change (a new component,
 * a rename, a change of parent) does not record. It changes the base scene as usual. Pure. No Vue import.
 */
import {
  diffDocuments,
  getAt,
  parsePointer,
  qconjugate,
  qmul,
  qnormalize,
  vadd,
  vsub,
  type EntityDocument,
  type Quat,
  type Vec3,
} from "@scenity/scene";
import { propertyTokens, sampleTrack, type SequenceDocument, type Track } from "@scenity/scene/sequence";
import { sequenceOp, type SequenceOp, type TrackKey } from "./edits";
import {
  findTrack,
  isCurveValue,
  propertyPath,
  TRANSFORM_DEFAULTS,
  trackEntity,
  type TrackTarget,
  type TransformPart,
} from "./tracks";

/** One value that an edit changes and the track field that keys it. */
interface Keyed {
  readonly target: TrackTarget;
  /** The transform part, or null for the value of a visibility or a property key. */
  readonly part: TransformPart | null;
  /** The component tokens of the value in the entity. */
  readonly tokens: readonly string[];
}

function isPart(value: string | undefined): value is TransformPart {
  return value === "position" || value === "rotation" || value === "scale";
}

/** True when `prefix` is the start of `tokens`. */
function startsWith(tokens: readonly string[], prefix: readonly string[]): boolean {
  return prefix.length <= tokens.length && prefix.every((token, index) => tokens[index] === token);
}

/** The property field of a component value: the path of a track of the entity, else the shortest keyable path. */
function propertyField(after: EntityDocument, seq: SequenceDocument, entity: string, tokens: string[]): Keyed | null {
  for (const track of seq.tracks) {
    if (track.kind !== "property" || trackEntity(track) !== entity) continue;
    const own = propertyTokens(track.path);
    if (startsWith(tokens, own))
      return { target: { kind: "property", entity, path: track.path }, part: null, tokens: own };
  }
  const components = after.entities[entity]?.components;
  for (let size = 2; size <= tokens.length; size += 1) {
    const value = getAt(components, tokens.slice(0, size));
    if (!isCurveValue(value) && typeof value !== "boolean") continue;
    const [component = "", ...rest] = tokens.slice(0, size);
    return {
      target: { kind: "property", entity, path: propertyPath(component, rest) },
      part: null,
      tokens: tokens.slice(0, size),
    };
  }
  return null;
}

/** The keyed field of one scene op, or null when the op does not record. */
function keyedOf(op: ReturnType<typeof diffDocuments>[number], after: EntityDocument, seq: SequenceDocument) {
  if (op.op !== "set" || op.value === undefined) return null;
  const tokens = parsePointer(op.path);
  if (tokens?.[0] !== "entities" || tokens[2] !== "components" || tokens.length < 5) return null;
  const entity = tokens[1] ?? "";
  const field = tokens.slice(3);
  if (field[0] === "transform" && isPart(field[1])) {
    return { target: { kind: "transform", entity }, part: field[1], tokens: field.slice(0, 2) } satisfies Keyed;
  }
  if (field[0] === "visibility" && field[1] === "visible" && field.length === 2) {
    return { target: { kind: "visibility", entity }, part: null, tokens: field } satisfies Keyed;
  }
  return propertyField(after, seq, entity, field);
}

/** The change from `before` to `after` on top of `sampled` (see the module comment). */
function mixChange(sampled: unknown, before: unknown, after: unknown, part: TransformPart | null): unknown {
  if (sampled === undefined || before === undefined) return after;
  if (part === "rotation") return qnormalize(qmul(qmul(after as Quat, qconjugate(before as Quat)), sampled as Quat));
  if (part === "scale") {
    const [b, a, s] = [before, after, sampled] as Vec3[];
    return s?.map((value, i) => ((b?.[i] ?? 0) === 0 ? (a?.[i] ?? value) : (value * (a?.[i] ?? 0)) / (b?.[i] ?? 1)));
  }
  if (part === "position") return vadd(sampled as Vec3, vsub(after as Vec3, before as Vec3));
  if (typeof sampled === "number" && typeof before === "number" && typeof after === "number") {
    return sampled + after - before;
  }
  if (isCurveValue(sampled) && isCurveValue(before) && isCurveValue(after) && Array.isArray(sampled)) {
    return sampled.map((value, i) => value + (((after as number[])[i] ?? 0) - ((before as number[])[i] ?? 0)));
  }
  return after;
}

/** The value of the track field at `t`, or undefined when the track has no key of it. */
function sampled(track: Track | undefined, keyed: Keyed, t: number): unknown {
  if (track === undefined || track.keys.length === 0) return undefined;
  const sample = sampleTrack(track, t);
  if (sample.kind === "transform" && keyed.part !== null) return sample[keyed.part];
  if (sample.kind === "property") return sample.value;
  if (sample.kind === "visibility") return sample.visible;
  return undefined;
}

/** The value of a field in a document, with the transform default for a part that the entity does not have. */
function fieldValue(doc: EntityDocument, keyed: Keyed): unknown {
  const value = getAt(doc.entities[keyed.target.entity ?? ""]?.components, keyed.tokens);
  return value ?? (keyed.part === null ? undefined : TRANSFORM_DEFAULTS[keyed.part]);
}

/** The keys of the record mode, one per track. A new track has a negative number (its order of creation). */
function recordKeys(before: EntityDocument, after: EntityDocument, seq: SequenceDocument, t: number) {
  const ops = diffDocuments(before, after);
  if (ops.length === 0) return null;
  const keys = new Map<string, { target: TrackTarget; key: Record<string, unknown> }>();
  for (const op of ops) {
    const keyed = keyedOf(op, after, seq);
    if (keyed === null) return null;
    const id = JSON.stringify(keyed.target);
    const entry = keys.get(id) ?? { target: keyed.target, key: { t } };
    const track = seq.tracks[findTrack(seq, keyed.target)];
    const value = mixChange(sampled(track, keyed, t), fieldValue(before, keyed), fieldValue(after, keyed), keyed.part);
    const field = keyed.part ?? (keyed.target.kind === "visibility" ? "visible" : "value");
    entry.key[field] = value;
    keys.set(id, entry);
  }
  return [...keys.values()];
}

/**
 * The sequence ops that key a change of the base scene from `before` to `after` at the time `t` (ms), or null when the
 * change does not record (no change, or a change that a track cannot key).
 */
export function recordOps(
  before: EntityDocument,
  after: EntityDocument,
  seq: SequenceDocument,
  t: number,
): SequenceOp[] | null {
  const time = Math.min(Math.max(0, Math.round(t)), seq.duration);
  const keys = recordKeys(before, after, seq, time);
  if (keys === null) return null;
  return keys.map(({ target, key }) => {
    const index = findTrack(seq, target);
    if (index >= 0) return sequenceOp({ type: "putKey", track: index, key: key as unknown as TrackKey });
    const track = {
      kind: target.kind,
      entity: target.entity,
      ...(target.path === undefined ? {} : { path: target.path }),
    };
    return sequenceOp({ type: "addTrack", track: { ...track, keys: [key] } as unknown as Track });
  });
}
