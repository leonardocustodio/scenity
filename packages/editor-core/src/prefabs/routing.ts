// SPDX-License-Identifier: Apache-2.0
/**
 * Edits inside a prefab instance. An op on an entity of the prefab of an instance (the ID `<instance>/<prefab entity>`
 * of the expanded document) becomes an override of the instance, never an edit of the prefab. Thus a rename, a hide, a
 * lock and a move by the gizmo of a prefab entity keep the prefab as it is and change only the instance. A `set`
 * override removes the older `set` overrides at its path or under it. An op on an entity of a nested instance
 * (`<instance>/<inner>/<entity>`) has no place in the overrides of the outer instance, so the editor refuses it. The
 * other ops stay. No Vue import.
 */
import { formatPointer, parsePointer } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { EditError } from "../ops";
import { instanceOverrides } from "./overrides";

/** The keys of an entity. A token after the entity ID that is no key is a part of the ID of a prefab entity. */
const ENTITY_FIELDS = new Set(["name", "parent", "index", "tags", "components"]);

/** The instance and the prefab entity of an ID of the expanded document, or null for an entity of the document. */
export function prefabEntityOf(doc: EntityDocument, id: string): { instance: string; entity: string } | null {
  const cut = id.indexOf("/");
  if (cut < 0) return null;
  const instance = id.slice(0, cut);
  const entity = id.slice(cut + 1);
  if (doc.entities[instance]?.components.prefab === undefined) return null;
  if (entity.includes("/")) throw new EditError(`"${id}" is in a nested prefab: edit that prefab instead.`);
  return { instance, entity };
}

/** The op on the prefab document of an op on a prefab entity, or null when the op is on an entity of the document. */
function prefabOp(doc: EntityDocument, op: SceneOp): { instance: string; op: SceneOp } | null {
  if (op.op === "set") {
    const parsed = parsePointer(op.path);
    if (parsed?.[0] !== "entities" || parsed[1] === undefined) return null;
    // A path of a command can hold the ID of a prefab entity with no escape: `/entities/<instance>/<entity>/name`.
    const joined =
      parsed[2] !== undefined &&
      !ENTITY_FIELDS.has(parsed[2]) &&
      doc.entities[parsed[1]]?.components.prefab !== undefined;
    const tokens = joined ? ["entities", `${parsed[1]}/${parsed[2] ?? ""}`, ...parsed.slice(3)] : parsed;
    const found = prefabEntityOf(doc, tokens[1] ?? "");
    if (found === null) return null;
    return {
      instance: found.instance,
      op: { ...op, path: formatPointer(["entities", found.entity, ...tokens.slice(2)]) },
    };
  }
  const found = prefabEntityOf(doc, op.id);
  if (found === null) return null;
  if (op.op === "add") {
    const parent = op.entity.parent === null ? null : prefabEntityOf(doc, op.entity.parent);
    if (parent?.instance !== found.instance)
      throw new EditError("A new prefab entity goes under an entity of its prefab.");
    return {
      instance: found.instance,
      op: { ...op, id: found.entity, entity: { ...op.entity, parent: parent.entity } },
    };
  }
  if (op.op === "move" && op.parent !== null) {
    const parent = prefabEntityOf(doc, op.parent);
    if (parent?.instance !== found.instance) throw new EditError("A prefab entity moves only inside its prefab.");
    return { instance: found.instance, op: { ...op, id: found.entity, parent: parent.entity } };
  }
  return { instance: found.instance, op: { ...op, id: found.entity } };
}

/** The ops of an edit of the expanded document as ops of the document: the ops on prefab entities become overrides. */
export function routeOverrides(doc: EntityDocument, ops: readonly SceneOp[]): SceneOp[] {
  const out: SceneOp[] = [];
  const lists = new Map<string, SceneOp[]>();
  for (const op of ops) {
    const routed = prefabOp(doc, op);
    if (routed === null) {
      out.push(op);
      continue;
    }
    const list = lists.get(routed.instance) ?? [...instanceOverrides(doc, routed.instance)];
    const next = routed.op;
    const kept =
      next.op === "set"
        ? list.filter((old) => !(old.op === "set" && (old.path === next.path || old.path.startsWith(`${next.path}/`))))
        : list;
    lists.set(routed.instance, [...kept, next]);
  }
  for (const [instance, list] of lists) {
    const path = formatPointer(["entities", instance, "components", "prefab", "overrides"]);
    out.push(list.length === 0 ? { op: "set", path } : { op: "set", path, value: list as never });
  }
  return out;
}
