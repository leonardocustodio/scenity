// SPDX-License-Identifier: Apache-2.0
/**
 * The view state of the hierarchy panel: solo and lock. They are editor view values, not document values: the saved
 * scene file never holds them. They are a channel of the one history. Thus a solo or a lock is one undo step, as a
 * scene edit is.
 *
 * - **Solo**: only the solo entities, their subtrees and their ancestors show. The visibility of an entity hides its
 *   subtree. Thus an ancestor of a solo entity shows with its own parts.
 * - **Lock**: a locked entity and its subtree cannot take a pick. Thus the viewport cannot select or drag them.
 *
 * The runtime draws the scene document with the view overlay (`viewOverlay`). The overlay is an override layer. It
 * sets `visibility.visible` to false outside the solo set and `pickable.enabled` to false on the locked entities.
 * Hide is not here: it is the document value `visibility.visible` (commands.ts). The functions are pure. No Vue
 * import.
 */
import { isObject } from "@scenity/scene";
import { subtreeOf } from "@scenity/scene/hierarchy";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { defineOpKind } from "../ops";

/** The name of the channel of the view state in the history. */
export const VIEW_CHANNEL = "view";

/** The view state: the solo entities and the locked entities, each list sorted. */
export interface SceneView {
  readonly solo: readonly string[];
  readonly locked: readonly string[];
}

export const EMPTY_VIEW: SceneView = { solo: [], locked: [] };

/** A list of the view state. */
export type ViewFlag = keyof SceneView;

export const VIEW_FLAGS: readonly ViewFlag[] = ["solo", "locked"];

/** An op of the view channel: the new list of one flag. */
export interface ViewOp {
  readonly kind: "view";
  readonly flag: ViewFlag;
  readonly ids: readonly string[];
}

function sameList(a: readonly string[], b: readonly string[]): boolean {
  return a.length === b.length && a.every((id, index) => id === b[index]);
}

/** True when two view states are equal. */
export function sameView(a: SceneView, b: SceneView): boolean {
  return VIEW_FLAGS.every((flag) => sameList(a[flag], b[flag]));
}

/** True when the view state changes nothing: no solo and no lock. */
export function isEmptyView(view: SceneView): boolean {
  return view.solo.length === 0 && view.locked.length === 0;
}

/** The view ops: each one sets one list of the view state. */
export const VIEW_OP = defineOpKind<ViewOp, SceneView>({
  kind: "view",
  channel: VIEW_CHANNEL,
  problem(op) {
    if (!VIEW_FLAGS.includes(op.flag as ViewFlag)) return `a view op sets ${VIEW_FLAGS.join(" or ")}.`;
    const ids = op.ids;
    return Array.isArray(ids) && ids.every((id) => typeof id === "string") ? null : "the ids of a view op are texts.";
  },
  apply(view, op) {
    const ids = [...new Set(op.ids)].sort();
    return sameList(view[op.flag], ids) ? view : { ...view, [op.flag]: ids };
  },
});

/** The entities in the subtrees of a list of entities. An ID that is not in the document is left out. */
function subtrees(doc: EntityDocument, ids: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const id of ids) {
    if (!Object.hasOwn(doc.entities, id)) continue;
    for (const item of subtreeOf(doc.entities, id)) out.add(item);
  }
  return out;
}

/** The locked entities: each locked entity and its subtree. */
export function lockedEntities(doc: EntityDocument, view: SceneView): Set<string> {
  return subtrees(doc, view.locked);
}

/** True when the entity or one of its ancestors is locked. */
export function isLocked(doc: EntityDocument, view: SceneView, id: string): boolean {
  return lockedEntities(doc, view).has(id);
}

/** The entities that show with the solo: the solo subtrees and their ancestors. Null when no entity is solo. */
export function soloEntities(doc: EntityDocument, view: SceneView): Set<string> | null {
  const shown = subtrees(doc, view.solo);
  if (shown.size === 0) return null;
  for (const id of [...shown]) {
    for (let next = doc.entities[id]?.parent ?? null; next !== null && !shown.has(next);) {
      shown.add(next);
      next = doc.entities[next]?.parent ?? null;
    }
  }
  return shown;
}

/** The value of a component with one field changed (a missing or bad value gives the field alone). */
function withField(value: unknown, field: string, next: boolean): Record<string, unknown> {
  return { ...(isObject(value) ? value : {}), [field]: next };
}

/**
 * The document that the runtime draws: the scene document with the view state on it. With an empty view state the
 * result is the document itself. The result is never saved.
 */
export function viewOverlay<D extends EntityDocument>(doc: D, view: SceneView): D {
  if (isEmptyView(view)) return doc;
  const shown = soloEntities(doc, view);
  const locked = lockedEntities(doc, view);
  const entities = { ...doc.entities };
  for (const [id, entity] of Object.entries(doc.entities)) {
    const hide = shown !== null && !shown.has(id);
    if (!hide && !locked.has(id)) continue;
    const components = { ...entity.components };
    if (hide) components.visibility = withField(components.visibility, "visible", false);
    if (locked.has(id)) components.pickable = withField(components.pickable, "enabled", false);
    entities[id] = { ...entity, components };
  }
  return { ...doc, entities };
}
