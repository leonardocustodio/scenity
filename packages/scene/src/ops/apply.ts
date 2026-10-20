// SPDX-License-Identifier: Apache-2.0
/**
 * `applyOps` and the transactions. `applyOps` is pure: it does not change its input. The output shares each branch
 * that did not change. It gives the new document and the ops that undo the list, or the index of the first bad op and
 * the reason.
 */
import type { ComponentRegistry } from "../components/registry";
import { formatErrors, zodErrors } from "../errors";
import type { EntityDocument } from "../schema/documents";
import { opSchema, type SceneOp } from "../schema/entity";
import { applyAddComponent, applyRemoveComponent, applySet } from "./set";
import type { StepResult } from "./shared";
import { applyAdd, applyMove, applyRemove } from "./tree";

export type ApplyResult<D extends EntityDocument> =
  | {
      readonly ok: true;
      readonly doc: D;
      /** The ops that undo the list, in the order to apply them. */
      readonly inverse: SceneOp[];
      /** The notes of the ops, for example a value of an unknown component that no schema checked. */
      readonly warnings: string[];
    }
  | { readonly ok: false; readonly index: number; readonly reason: string };

/** Apply one op. The op must have a valid shape (`opSchema`). */
export function applyOp(doc: EntityDocument, op: SceneOp, registry: ComponentRegistry): StepResult {
  switch (op.op) {
    case "set":
      return applySet(doc, op, registry);
    case "add":
      return applyAdd(doc, op, registry);
    case "remove":
      return applyRemove(doc, op);
    case "move":
      return applyMove(doc, op);
    case "addComponent":
      return applyAddComponent(doc, op, registry);
    case "removeComponent":
      return applyRemoveComponent(doc, op);
  }
}

/** Apply a list of ops in order. The first bad op stops the list, and the input stays as it was. */
export function applyOps<D extends EntityDocument>(
  doc: D,
  ops: readonly SceneOp[],
  registry: ComponentRegistry,
): ApplyResult<D> {
  let current: EntityDocument = doc;
  const inverse: SceneOp[] = [];
  const warnings: string[] = [];
  for (const [index, op] of ops.entries()) {
    const shape = opSchema.safeParse(op);
    if (!shape.success) return { ok: false, index, reason: formatErrors(zodErrors(shape.error)) };
    const step = applyOp(current, op, registry);
    if (!step.ok) return { ok: false, index, reason: step.reason };
    current = step.doc;
    inverse.unshift(...step.inverse);
    warnings.push(...step.warnings);
  }
  return { ok: true, doc: current as D, inverse, warnings };
}

/** A group of ops that is one undo step. */
export interface Transaction {
  readonly label: string;
  readonly ops: readonly SceneOp[];
}

export function transaction(label: string, ops: readonly SceneOp[]): Transaction {
  return { label, ops };
}

/** Apply a transaction. Its inverse is one transaction with the same label: one undo step. */
export function applyTransaction<D extends EntityDocument>(
  doc: D,
  tx: Transaction,
  registry: ComponentRegistry,
): { ok: true; doc: D; inverse: Transaction; warnings: string[] } | { ok: false; index: number; reason: string } {
  const result = applyOps(doc, tx.ops, registry);
  if (!result.ok) return result;
  return { ok: true, doc: result.doc, inverse: transaction(tx.label, result.inverse), warnings: result.warnings };
}
