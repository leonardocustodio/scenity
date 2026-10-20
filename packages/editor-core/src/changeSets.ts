// SPDX-License-Identifier: Apache-2.0
/**
 * The change sets of the review. The proposals of one turn of one agent session form one change set. The actor has the
 * session and the turn. Each other proposal is a change set of its own. The review lists the ops of a change set by
 * entity, each op with its old and new value. A person accepts or rejects the whole set, the ops of one entity or one
 * op. The runner applies the chosen ops as one step of the history (`Runner.acceptOps`). The key of an op is
 * `<proposal>:<index>`. No Vue import.
 */
import { parsePointer } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { PERSON, type Actor, type BaseOp } from "./ops";
import type { Proposal } from "./runner";

/** One op of a change set for the review. */
export interface ReviewOp<O extends BaseOp = BaseOp> {
  /** `<proposal>:<index>`. */
  readonly key: string;
  readonly proposal: string;
  readonly index: number;
  /** The entity of the op, or null (a value of the document, an op of another kind). */
  readonly entity: string | null;
  readonly op: O;
}

/** The proposals of one turn (or one proposal) for the review. */
export interface ChangeSet<O extends BaseOp = BaseOp> {
  /** `<session>#<turn>`, or `proposal:<id>`. */
  readonly key: string;
  readonly actor: Actor;
  /** The title of the first edit, and the count of the others. */
  readonly title: string;
  readonly proposals: readonly Proposal<O>[];
  readonly ops: readonly ReviewOp<O>[];
}

/** The key of the change set of a proposal. */
export function changeSetKey(proposal: Pick<Proposal, "id" | "edit">): string {
  const actor = proposal.edit.actor;
  return actor?.session !== undefined && actor.turn !== undefined
    ? `${actor.session}#${String(actor.turn)}`
    : `proposal:${proposal.id}`;
}

/** The change sets of the proposals, in the order of their first proposal. `entityOf` gives the entity of an op. */
export function changeSetsOf<O extends BaseOp>(
  proposals: readonly Proposal<O>[],
  entityOf: (op: O) => string | null,
): ChangeSet<O>[] {
  const groups = new Map<string, Proposal<O>[]>();
  for (const proposal of proposals) {
    const key = changeSetKey(proposal);
    groups.set(key, [...(groups.get(key) ?? []), proposal]);
  }
  return [...groups].map(([key, items]) => {
    const first = items[0];
    const more = items.length - 1;
    const title = `${first?.edit.title ?? ""}${more > 0 ? ` (+${String(more)})` : ""}`;
    const ops = items.flatMap((proposal) =>
      proposal.edit.ops.map((op, index) => ({
        key: `${proposal.id}:${String(index)}`,
        proposal: proposal.id,
        index,
        entity: entityOf(op),
        op,
      })),
    );
    return { key, actor: first?.edit.actor ?? PERSON, title, proposals: items, ops };
  });
}

/** The ops of a change set by entity (null: the ops with no entity), in the order of their first op. */
export function opsByEntity<O extends BaseOp>(set: ChangeSet<O>): Map<string | null, ReviewOp<O>[]> {
  const out = new Map<string | null, ReviewOp<O>[]>();
  for (const op of set.ops) out.set(op.entity, [...(out.get(op.entity) ?? []), op]);
  return out;
}

/** The entity of a scene op, or null for a value of the document. */
export function sceneOpEntity(op: SceneOp): string | null {
  if (op.op !== "set") return op.id;
  const tokens = parsePointer(op.path) ?? [];
  return tokens[0] === "entities" ? (tokens[1] ?? null) : null;
}

/** A scene op for the review: what kind of change, the field, and the value before and after. */
export interface SceneOpView {
  readonly change: "added" | "removed" | "changed" | "moved";
  /** The field (`components.light.colour`, `name`), or "" for the entity. */
  readonly field: string;
  readonly before: unknown;
  readonly after: unknown;
}

/** The value at a pointer of a document, or undefined. */
function valueAt(doc: unknown, tokens: readonly string[]): unknown {
  let at: unknown = doc;
  for (const token of tokens) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string, unknown>)[token];
  }
  return at;
}

/** The review view of a scene op on the current document. */
export function sceneOpView(doc: EntityDocument, op: SceneOp): SceneOpView {
  switch (op.op) {
    case "add":
      return { change: "added", field: "", before: undefined, after: op.entity.name ?? op.id };
    case "remove":
      return { change: "removed", field: "", before: doc.entities[op.id]?.name ?? op.id, after: undefined };
    case "move": {
      const old = doc.entities[op.id];
      const place = (parent: string | null | undefined, index: number | undefined) => ({ parent, index });
      return {
        change: "moved",
        field: "parent",
        before: place(old?.parent, old?.index),
        after: place(op.parent, op.index),
      };
    }
    case "addComponent":
      return { change: "added", field: `components.${op.component}`, before: undefined, after: op.value };
    case "removeComponent":
      return {
        change: "removed",
        field: `components.${op.component}`,
        before: doc.entities[op.id]?.components[op.component],
        after: undefined,
      };
    default: {
      const tokens = parsePointer(op.path) ?? [];
      const field = (tokens[0] === "entities" ? tokens.slice(2) : tokens).join(".");
      return { change: "changed", field, before: valueAt(doc, tokens), after: op.value };
    }
  }
}
