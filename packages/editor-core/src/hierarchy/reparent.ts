// SPDX-License-Identifier: Apache-2.0
/**
 * The scene ops of a change of parent: a `move` op for each entity and the new local transform that keeps its world
 * transform. The result is exact when each scale of the new parent chain is
 * uniform (worldTransform of `@scenity/scene/world`). The functions are pure. No Vue import.
 */
import { childrenMap } from "@scenity/scene/hierarchy";
import { qconjugate, qmul, qnormalize, qrotate, vsub, type Quat, type Vec3 } from "@scenity/scene/math";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { localTransform, worldTransform, type HasEntities } from "@scenity/scene/world";
import type { DropTarget } from "./tree";

/** The grid of the transform values that a change of parent writes (the grid of the canonical writer). */
const GRID = 1e-6;

function onGrid(value: number): number {
  const out = Math.round(value / GRID) * GRID;
  return Number(out.toFixed(6)) + 0;
}

function sameValues(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((value, index) => Math.abs(value - (b[index] ?? 0)) <= GRID / 2);
}

interface Local {
  readonly position: Vec3;
  readonly rotation: Quat;
  readonly scale: Vec3;
}

/** The local transform under a new parent (null: the roots) that keeps the world transform of the entity. */
export function keptLocal(doc: HasEntities, id: string, parent: string | null): Local | null {
  const world = worldTransform(doc, id);
  if (world === undefined) return null;
  const base = parent === null ? null : worldTransform(doc, parent);
  if (parent !== null && base === undefined) return null;
  if (base === null || base === undefined) return world;
  const turn = qconjugate(base.rotation);
  const offset = qrotate(turn, vsub(world.position, base.position));
  const divide = (a: Vec3, b: Vec3): Vec3 => [a[0] / b[0], a[1] / b[1], a[2] / b[2]];
  return {
    position: divide(offset, base.scale),
    rotation: qnormalize(qmul(turn, world.rotation)),
    scale: divide(world.scale, base.scale),
  };
}

const DEFAULTS: Local = { position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] };
const FIELDS = ["position", "rotation", "scale"] as const;

/** The `set` or `addComponent` ops that write a new local transform. No op when the transform does not change. */
function transformOps(doc: HasEntities, id: string, next: Local): SceneOp[] {
  const entity = doc.entities[id];
  if (entity === undefined) return [];
  const now = localTransform(entity);
  const rounded = Object.fromEntries(FIELDS.map((field) => [field, next[field].map(onGrid)])) as unknown as Local;
  const changed = FIELDS.filter((field) => !sameValues(now[field], rounded[field]));
  if (changed.length === 0) return [];
  if (entity.components.transform === undefined) {
    const value = Object.fromEntries(
      FIELDS.filter((field) => !sameValues(rounded[field], DEFAULTS[field])).map((field) => [field, rounded[field]]),
    );
    return [{ op: "addComponent", id, component: "transform", value }];
  }
  return changed.map((field) => ({
    op: "set",
    path: `/entities/${id}/components/transform/${field}`,
    value: [...rounded[field]],
  }));
}

/**
 * The ops that move the entities, in their order, under the parent of the target, from the index of the target on.
 * Each entity keeps its world transform. An entity whose place does not change gets no op. The caller checks the
 * target first (dropTarget, canParent). The ops of a cycle fail when the editor applies them.
 */
export function reparentOps(doc: EntityDocument, ids: readonly string[], target: DropTarget): SceneOp[] {
  const moved = [...new Set(ids)].filter((id) => Object.hasOwn(doc.entities, id));
  const lists = childrenMap(doc.entities);
  const key = target.parent ?? "";
  const final = (lists.get(key) ?? []).filter((id) => !moved.includes(id));
  const index = Math.max(0, Math.min(target.index, final.length));
  final.splice(index, 0, ...moved);
  const ops: SceneOp[] = [];
  for (const id of moved) {
    const entity = doc.entities[id];
    if (entity === undefined) continue;
    const old = lists.get(entity.parent ?? "") ?? [];
    // The current children of the parent, without the entity. The index of a move op counts in that list. The entity
    // goes after the entity before it in the final order: a sibling that stays, or the moved entity before it.
    const others = (lists.get(key) ?? []).filter((item) => item !== id);
    const previous = final[final.indexOf(id) - 1];
    const at = previous === undefined ? 0 : others.indexOf(previous) + 1;
    const before = old.indexOf(id);
    if (entity.parent !== target.parent || before !== at) {
      ops.push({ op: "move", id, parent: target.parent, index: at });
      lists.set(
        entity.parent ?? "",
        old.filter((item) => item !== id),
      );
      lists.set(key, [...others.slice(0, at), id, ...others.slice(at)]);
    }
    if (entity.parent !== target.parent) {
      const local = keptLocal(doc, id, target.parent);
      if (local !== null) ops.push(...transformOps(doc, id, local));
    }
  }
  return ops;
}
