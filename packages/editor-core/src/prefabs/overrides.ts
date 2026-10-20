// SPDX-License-Identifier: Apache-2.0
/**
 * Apply and revert the overrides of a prefab instance. The overrides of an instance are ops on its prefab document (the
 * `overrides` list of its `prefab` component). A scope picks a part of the list: all of it, the ops of one prefab
 * entity, of one component of that entity, or of one field.
 *
 * - Revert: the ops in the scope leave the list. Thus the instance shows the prefab values again.
 * - Apply: the ops in the scope go into the prefab document (ops of the `prefab` op kind on the prefab set) and leave
 *   the list. Each other instance of the prefab then shows the change, and its own overrides stay on top.
 *
 * Each result is ops for one edit, and thus one step of the history. No Vue import.
 */
import { formatPointer, prefabOf } from "@scenity/scene";
import type { ComponentRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { opSchema, type SceneOp, type SetOp } from "@scenity/scene/schema/entity";
import { opEntity } from "../inspector/subjects";
import { overrideTouches } from "../inspector/values";
import { defineOpKind, EditError, type SceneEditOp } from "../ops";
import { instancePrefabPath, PREFAB_CHANNEL, type PrefabPaths, type PrefabSet } from "./library";

/** One scene op on a prefab document of the prefab set. */
export interface PrefabEditOp {
  readonly kind: "prefab";
  /** The project path of the prefab. */
  readonly path: string;
  readonly op: SceneOp;
}

/** The ops of `prefab` kind on the prefab set of the page, checked by the component registry. */
export function prefabOpKind(registry: ComponentRegistry) {
  return defineOpKind<PrefabEditOp, PrefabSet>({
    kind: "prefab",
    channel: PREFAB_CHANNEL,
    problem(op) {
      if (typeof op.path !== "string" || op.path === "") return "a prefab op names the path of its prefab.";
      const shape = opSchema.safeParse(op.op);
      return shape.success ? null : `the prefab op is not valid (${shape.error.issues[0]?.message ?? "no reason"}).`;
    },
    apply(set, op) {
      const prefab = set[op.path];
      if (prefab === undefined) throw new EditError(`The page has no prefab ${op.path}.`);
      const result = applyOps(prefab, [op.op], registry);
      if (!result.ok) throw new EditError(`The prefab ${op.path} refuses the op: ${result.reason}`);
      return { ...set, [op.path]: result.doc };
    },
  });
}

/** A part of the override list of an instance. An empty scope is the whole list. */
export interface OverrideScope {
  /** The ID of an entity in the prefab document. */
  readonly entity?: string;
  /** A component ID (with `entity`). An entity field such as `name` is a component of the `entity` site. */
  readonly component?: string;
  /** The tokens of a field under the component (with `component`). */
  readonly field?: readonly string[];
}

/** The override list of an instance entity. Empty when the entity is no instance. */
export function instanceOverrides(doc: EntityDocument, instance: string): readonly SceneOp[] {
  const entity = doc.entities[instance];
  return (entity === undefined ? undefined : prefabOf(entity)?.overrides) ?? [];
}

/** True when an override op is in the scope. */
export function inScope(op: SceneOp, scope: OverrideScope): boolean {
  if (scope.entity === undefined) return true;
  if (opEntity(op) !== scope.entity) return false;
  const { component, field } = scope;
  if (component === undefined) return true;
  if (op.op === "addComponent" || op.op === "removeComponent") return op.component === component && field === undefined;
  if (op.op !== "set") return false;
  const sites = [
    ["entities", scope.entity, "components", component],
    ["entities", scope.entity, component],
  ];
  return sites.some((tokens) => overrideTouches(op, formatPointer([...tokens, ...(field ?? [])])));
}

/** The op that writes the override list of an instance. An empty list removes the key. */
function listOp(instance: string, list: readonly SceneOp[]): SceneOp {
  const path = formatPointer(["entities", instance, "components", "prefab", "overrides"]);
  return list.length === 0 ? { op: "set", path } : { op: "set", path, value: [...list] as SetOp["value"] };
}

/** The scene ops that revert the overrides in the scope. Empty when the scope holds no override. */
export function revertOverrideOps(doc: EntityDocument, instance: string, scope: OverrideScope = {}): SceneOp[] {
  const list = instanceOverrides(doc, instance);
  const kept = list.filter((op) => !inScope(op, scope));
  return kept.length === list.length ? [] : [listOp(instance, kept)];
}

/** The ops of an apply: the prefab ops, then the scene op of the new override list. */
export interface ApplyOverrides {
  readonly ops: readonly (PrefabEditOp | SceneEditOp)[];
  /** The project path of the prefab. */
  readonly path: string;
  /** The number of overrides that go into the prefab. */
  readonly count: number;
}

/**
 * The ops that apply the overrides in the scope to the prefab of an instance. It throws an EditError when the entity
 * is no instance, the page has no prefab document for it, the scope holds no override, or the prefab refuses an op.
 */
export function applyOverrideOps(
  doc: EntityDocument,
  instance: string,
  set: PrefabSet,
  context: { readonly paths: PrefabPaths; readonly registry: ComponentRegistry },
  scope: OverrideScope = {},
): ApplyOverrides {
  const path = instancePrefabPath(doc, instance, context.paths);
  if (path === undefined) throw new EditError(`"${instance}" is not a prefab instance.`);
  const prefab = set[path];
  if (prefab === undefined) throw new EditError(`The page has no prefab ${path}.`);
  const list = instanceOverrides(doc, instance);
  const moved = list.filter((op) => inScope(op, scope));
  if (moved.length === 0) throw new EditError("No override to apply.");
  const check = applyOps(prefab, moved, context.registry);
  if (!check.ok) throw new EditError(`The prefab refuses override ${String(check.index)}: ${check.reason}`);
  const kept = list.filter((op) => !inScope(op, scope));
  const prefabOps = moved.map((op): PrefabEditOp => ({ kind: "prefab", path, op }));
  return { ops: [...prefabOps, { kind: "scene", op: listOp(instance, kept) }], path, count: moved.length };
}

/** The override marks of the rows of an expanded tree: each instance with overrides, each prefab entity with some. */
export function overrideMarks(doc: EntityDocument): Map<string, number> {
  const out = new Map<string, number>();
  for (const instance of Object.keys(doc.entities)) {
    const list = instanceOverrides(doc, instance);
    if (list.length === 0) continue;
    out.set(instance, list.length);
    for (const op of list) {
      const entity = opEntity(op);
      if (entity === undefined) continue;
      const id = `${instance}/${entity}`;
      out.set(id, (out.get(id) ?? 0) + 1);
    }
  }
  return out;
}
