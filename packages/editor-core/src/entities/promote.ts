// SPDX-License-Identifier: Apache-2.0
/**
 * The scene op of a promote. A scratch or dropped model first becomes a project asset (`importProjectFile` of
 * `@scenity/assets/projectImport`). Then this op adds an entity with a `model` component of that asset at the place of
 * the scratch model. It is the op of `entity.add` (`addEntityOps`) with the turn of the scratch model about Y. Thus the
 * editor keeps one undo step for it, and the workbench host writes the same op into the scene file. Pure functions. No
 * Vue import.
 */
import { roundNumber } from "@scenity/scene/canonical";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";
import { addEntityOps, type EntityEdit } from "./edits";

/** The entity of a promote: the new asset, a name and the place of the scratch or dropped model. */
export interface PromotedModel {
  /** The asset reference `asset:<id>`, or an asset ID. */
  readonly asset: string;
  /** The name of the entity (the file name of the model, with no extension). */
  readonly name?: string;
  /** The base of the new ID (default: from the name). */
  readonly id?: string;
  readonly parent?: string | null;
  /** The position in the frame of the parent, metres. */
  readonly position: readonly [number, number, number];
  /** The turn about Y, radians (default 0: no `rotation` value). */
  readonly yaw?: number;
}

/** The quaternion of a turn about Y, each part on the number grid of the documents. */
export function yawRotation(yaw: number): [number, number, number, number] {
  return [0, roundNumber(Math.sin(yaw / 2)), 0, roundNumber(Math.cos(yaw / 2))];
}

/** The op of a promote: one `add` op of the new entity with its `model`, `transform` and turn. */
export function promoteEdit(doc: EntityDocument, model: PromotedModel): EntityEdit {
  const edit = addEntityOps(doc, {
    asset: model.asset,
    position: model.position,
    parent: model.parent ?? null,
    ...(model.name === undefined || model.name.trim() === "" ? {} : { name: model.name }),
    ...(model.id === undefined ? {} : { id: model.id }),
  });
  const yaw = model.yaw ?? 0;
  if (roundNumber(yaw) === 0) return edit;
  const ops = edit.ops.map((op): SceneOp => {
    if (op.op !== "add") return op;
    const transform = { ...(op.entity.components.transform as object), rotation: yawRotation(yaw) };
    const entity: Entity = { ...op.entity, components: { ...op.entity.components, transform } };
    return { ...op, entity };
  });
  return { ...edit, ops };
}

/** The name of a promoted entity from a file name: the base name with no extension. */
export function promotedName(file: string): string {
  const base = file.slice(file.replace(/\\/g, "/").lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot > 0 ? base.slice(0, dot) : base;
}
