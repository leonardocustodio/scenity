// SPDX-License-Identifier: Apache-2.0
/**
 * The model of the Review panel: each change set with its ops by entity, each op with its field and its old and new
 * value as short texts, and the document after the whole set (the Preview and the marks in the view). No Vue import.
 */
import { applyOps, type ComponentRegistry } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { opsByEntity, sceneOpView, type Actor, type ChangeSet, type SceneOpView } from "@scenity/editor-core";
import type { PageOp } from "../hierarchy/sceneCommands";

/** One op of a row. */
export interface ReviewOpRow {
  readonly key: string;
  /** The pointer of a `set` op (`/entities/lamp/name`), or null. */
  readonly path: string | null;
  readonly change: SceneOpView["change"];
  readonly field: string;
  readonly before: string;
  readonly after: string;
}

/** The ops of one entity (or of the document). */
export interface ReviewRow {
  /** The entity, or null for the values of the document. */
  readonly entity: string | null;
  readonly name: string;
  /** The change of the entity: added or removed when an op adds or removes it, else changed. */
  readonly change: SceneOpView["change"];
  /** True when the entity is gone from the document (an op of it can no longer apply). */
  readonly stale: boolean;
  readonly ops: readonly ReviewOpRow[];
}

/** One change set of the panel. */
export interface ReviewSet {
  readonly key: string;
  readonly actor: Actor;
  readonly title: string;
  readonly rows: readonly ReviewRow[];
  /** The keys of all its ops. */
  readonly keys: readonly string[];
}

/** The most characters of a value text. */
const VALUE_MAX = 48;

/** A short text of a value: numbers with 3 decimals at most, vectors in brackets, objects as cut JSON. */
export function valueText(value: unknown): string {
  if (value === undefined) return "—";
  if (typeof value === "number") return String(Number(value.toFixed(3)));
  if (typeof value === "string") return value.length > VALUE_MAX ? `${value.slice(0, VALUE_MAX)}…` : value;
  if (Array.isArray(value) && value.every((item) => typeof item === "number")) {
    return `(${value.map((item) => valueText(item)).join(", ")})`;
  }
  const text = JSON.stringify(value);
  return text.length > VALUE_MAX ? `${text.slice(0, VALUE_MAX)}…` : text;
}

/** The scene op of a page op, or null. */
function sceneOp(op: PageOp): SceneOp | null {
  return op.kind === "scene" ? (op as { readonly op: SceneOp }).op : null;
}

/** The pointer of a `set` op of the page, or null. */
function pathOf(op: PageOp): string | null {
  const scene = sceneOp(op);
  return scene?.op === "set" ? scene.path : null;
}

/** The view of an op of the page on the current document. */
function opView(doc: SceneDocument, op: PageOp): SceneOpView {
  const scene = sceneOp(op);
  return scene === null
    ? { change: "changed", field: op.kind, before: undefined, after: undefined }
    : sceneOpView(doc, scene);
}

/** The rows of a change set on the current document. */
export function reviewSet(set: ChangeSet<PageOp>, doc: SceneDocument): ReviewSet {
  const rows: ReviewRow[] = [];
  for (const [entity, ops] of opsByEntity(set)) {
    const views = ops.map((item) => ({ item, view: opView(doc, item.op) }));
    const whole = views.find(({ view }) => view.field === "" && view.change !== "moved")?.view.change;
    const added = ops.map((item) => sceneOp(item.op)).find((op) => op?.op === "add");
    const name =
      entity === null
        ? ""
        : (doc.entities[entity]?.name ?? (added?.op === "add" ? added.entity.name : undefined) ?? entity);
    const change = whole ?? "changed";
    const stale = entity !== null && change !== "added" && doc.entities[entity] === undefined;
    rows.push({
      entity,
      name,
      change,
      stale,
      ops: views.map(({ item, view }) => ({
        key: item.key,
        path: pathOf(item.op),
        change: view.change,
        field: view.field,
        before: valueText(view.before),
        after: valueText(view.after),
      })),
    });
  }
  return { key: set.key, actor: set.actor, title: set.title, rows, keys: set.ops.map((op) => op.key) };
}

/** The document after all the scene ops of a change set, or null when they do not apply. */
export function proposedDoc(
  doc: SceneDocument,
  set: ChangeSet<PageOp>,
  registry: ComponentRegistry,
): SceneDocument | null {
  const ops = set.ops.flatMap((item) => {
    const op = sceneOp(item.op);
    return op === null ? [] : [op];
  });
  const result = applyOps(doc, ops, registry);
  return result.ok ? result.doc : null;
}
