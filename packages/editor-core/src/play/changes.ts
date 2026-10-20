// SPDX-License-Identifier: Apache-2.0
/**
 * The changes of a play session: the difference between the edit state at the start of the play mode and the current
 * play state, in parts that the owner can keep one by one. A part is one component of one entity, a field of an entity
 * (the name, the tags), the place of an entity in the tree, a top field of the scene, or the whole sequence. The ops of
 * each part change the edit state into the play state for that part. Pure. No Vue import, no DOM.
 */
import { jsonEqual, parsePointer } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { diffDocuments } from "@scenity/scene/ops";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { BaseOp, SceneEditOp } from "../ops";
import { sequenceOp, type SequenceOp } from "../sequence/edits";

/** The ID of the sequence part of the changes. */
export const SEQUENCE_PART = "@sequence";

/** One part of the changes of a play session. */
export interface PlayChange {
  /**
   * The ID of the part: `<entity>/<component>`, `<entity>/@tree`, `<entity>/@<field>`, `@scene/<field>` or
   * `@sequence`.
   */
  readonly id: string;
  readonly channel: "scene" | "sequence";
  /** The entity of the part, or null for a top field of the scene and for the sequence. */
  readonly entity: string | null;
  /** The component of the part, or null. */
  readonly component: string | null;
  /** A short text for the list of the changes. */
  readonly label: string;
  /** The ops that change the edit state into the play state for this part, in the order of the diff. */
  readonly ops: readonly BaseOp[];
}

/** The ID of the part of a component of an entity. */
export function componentPart(entity: string, component: string): string {
  return `${entity}/${component}`;
}

/** The part of one scene op: its ID, entity, component and label. */
function partOf(op: SceneOp): Omit<PlayChange, "ops" | "channel"> {
  if (op.op === "add" || op.op === "remove" || op.op === "move") {
    const what = op.op === "add" ? "added" : op.op === "remove" ? "removed" : "place in the tree";
    return { id: `${op.id}/@tree`, entity: op.id, component: null, label: `${op.id}: ${what}` };
  }
  if (op.op === "addComponent" || op.op === "removeComponent") {
    const what = op.op === "addComponent" ? "added" : "removed";
    const id = componentPart(op.id, op.component);
    return { id, entity: op.id, component: op.component, label: `${op.id}: ${op.component} ${what}` };
  }
  const tokens = parsePointer(op.path) ?? [];
  const [top = "", entity = "", field = "", component = ""] = tokens;
  if (top !== "entities") return { id: `@scene/${top}`, entity: null, component: null, label: `scene: ${top}` };
  if (field === "components") {
    return { id: componentPart(entity, component), entity, component, label: `${entity}: ${component}` };
  }
  return { id: `${entity}/@${field}`, entity, component: null, label: `${entity}: ${field}` };
}

/** The scene parts that change the scene `edit` into the scene `play`, in the order of their first op. */
export function sceneChanges(edit: EntityDocument, play: EntityDocument): PlayChange[] {
  const parts = new Map<string, { part: Omit<PlayChange, "ops" | "channel">; ops: SceneEditOp[] }>();
  for (const op of diffDocuments(edit, play)) {
    const part = partOf(op);
    const entry = parts.get(part.id) ?? { part, ops: [] };
    entry.ops.push({ kind: "scene", op });
    parts.set(part.id, entry);
  }
  return [...parts.values()].map(({ part, ops }) => ({ ...part, channel: "scene", ops }));
}

/**
 * The sequence part that changes the sequence `edit` into the sequence `play`, or null when they are equal. The ops
 * remove each track of `edit`, add each track of `play`, and set the markers. Thus one part keeps the whole sequence.
 */
export function sequenceChange(edit: SequenceDocument, play: SequenceDocument): PlayChange | null {
  if (edit === play || jsonEqual(edit, play)) return null;
  const ops: SequenceOp[] = [];
  for (let index = edit.tracks.length - 1; index >= 0; index -= 1) {
    ops.push(sequenceOp({ type: "removeTrack", track: index }));
  }
  for (const track of play.tracks) ops.push(sequenceOp({ type: "addTrack", track }));
  const before = edit.markers ?? {};
  const after = play.markers ?? {};
  for (const name of Object.keys(before).sort()) {
    if (!(name in after)) ops.push(sequenceOp({ type: "marker", name, t: null }));
  }
  for (const [name, t] of Object.entries(after).sort(([a], [b]) => a.localeCompare(b))) {
    if (before[name] !== t) ops.push(sequenceOp({ type: "marker", name, t }));
  }
  const tracks = play.tracks.filter((track, index) => !jsonEqual(track, edit.tracks[index])).length;
  const label = `sequence: ${String(tracks)} track(s) changed`;
  return { id: SEQUENCE_PART, channel: "sequence", entity: null, component: null, label, ops };
}
