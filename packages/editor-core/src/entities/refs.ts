// SPDX-License-Identifier: Apache-2.0
/**
 * The entity references of the entity edits. A delete or a paste can leave an entity reference (`entity:<id>` or
 * `entity:<id>#<sub>`) that names no entity of the scene. The rule of the editor:
 *
 * - The command finds each such reference and reports it in the title of its edit.
 * - With the rule "clear" (the default), the edit clears the reference. An object field with the reference goes, and
 *   a list item with the reference goes. The clear is a `set` op of the whole component in the same edit. Thus one
 *   undo step restores the entities and the references.
 * - With the rule "refuse", or when the component schema needs the cleared field, the command refuses with a reason
 *   that names the references. Nothing changes.
 *
 * Pure functions. No Vue import.
 */
import { findReferences } from "@scenity/scene/refs";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";

/** What a command does with a reference to an entity that goes: clear it, or refuse the edit. */
export type RefRule = "clear" | "refuse";

/** One entity reference of a kept entity to an entity that is not in the scene after the edit. */
export interface LostRef {
  /** The entity that holds the reference. */
  readonly entity: string;
  readonly component: string;
  /** The JSON Pointer of the reference in the component value. */
  readonly path: string;
  /** The ID of the entity that the reference names. */
  readonly target: string;
}

/** The references in the entities of `entities` (not in `skip`) to an entity for which `lost` is true. */
export function lostRefs(
  entities: Readonly<Record<string, Entity>>,
  lost: (id: string) => boolean,
  skip: ReadonlySet<string> = new Set(),
): LostRef[] {
  const out: LostRef[] = [];
  for (const id of Object.keys(entities).sort()) {
    if (skip.has(id)) continue;
    const components = entities[id]?.components ?? {};
    for (const component of Object.keys(components).sort()) {
      for (const found of findReferences(components[component])) {
        if (found.ref.kind !== "entity" || !lost(found.ref.id)) continue;
        out.push({ entity: id, component, path: found.path, target: found.ref.id });
      }
    }
  }
  return out;
}

/** The references of the other entities of a document to the entities of `gone` (a delete). */
export function refsInto(doc: EntityDocument, gone: ReadonlySet<string>): LostRef[] {
  return lostRefs(doc.entities, (id) => gone.has(id), gone);
}

/** The sign of a value that goes out of its object or list. */
const GONE = Symbol("gone");

/** A JSON value without the entity references for which `lost` is true. */
function cleared(value: unknown, lost: (id: string) => boolean): unknown {
  if (typeof value === "string") {
    const found = findReferences(value)[0];
    return found?.ref.kind === "entity" && lost(found.ref.id) ? GONE : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => cleared(item, lost)).filter((item) => item !== GONE);
  }
  if (typeof value === "object" && value !== null) {
    const out: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      const next = cleared(item, lost);
      if (next !== GONE) out[key] = next;
    }
    return out;
  }
  return value;
}

/** A token of a JSON Pointer (RFC 6901 escape). */
function token(text: string): string {
  return text.replaceAll("~", "~0").replaceAll("/", "~1");
}

/**
 * The components of `entities` without the references `refs`: for each entity with a reference, the new value of each
 * component with a reference (null when nothing of the value stays).
 */
export function clearedComponents(
  entities: Readonly<Record<string, Entity>>,
  refs: readonly LostRef[],
): Map<string, Map<string, unknown>> {
  const out = new Map<string, Map<string, unknown>>();
  for (const ref of refs) {
    const parts = out.get(ref.entity) ?? new Map<string, unknown>();
    out.set(ref.entity, parts);
    if (parts.has(ref.component)) continue;
    const targets = new Set(refs.filter((other) => other.entity === ref.entity).map((other) => other.target));
    const value = cleared(entities[ref.entity]?.components[ref.component], (id) => targets.has(id));
    parts.set(ref.component, value === GONE ? null : value);
  }
  return out;
}

/**
 * The ops that clear the references `refs` from the entities of `entities`: one `set` op per component with a
 * reference (the new component value), or a `removeComponent` op when nothing of the value stays.
 */
export function clearOps(entities: Readonly<Record<string, Entity>>, refs: readonly LostRef[]): SceneOp[] {
  const ops: SceneOp[] = [];
  for (const [id, parts] of clearedComponents(entities, refs)) {
    for (const [component, value] of parts) {
      if (value === null) {
        ops.push({ op: "removeComponent", id, component });
        continue;
      }
      const path = `/entities/${token(id)}/components/${token(component)}`;
      ops.push({ op: "set", path, value: value as Extract<SceneOp, { op: "set" }>["value"] });
    }
  }
  return ops;
}

/** An entity with the components of `parts` (clearedComponents): a null value removes the component. */
export function withComponents(entity: Entity, parts: ReadonlyMap<string, unknown>): Entity {
  const kept = Object.entries(entity.components).filter(([component]) => parts.get(component) !== null);
  const components = Object.fromEntries(kept.map(([component, value]) => [component, parts.get(component) ?? value]));
  return { ...entity, components };
}

/** The words of a list of references for a title or a reason, for example `sun light/target (entity:bench)`. */
export function refWords(refs: readonly LostRef[]): string {
  const shown = refs.slice(0, 4).map((ref) => `${ref.entity} ${ref.component}${ref.path} (entity:${ref.target})`);
  const more = refs.length > shown.length ? ` and ${String(refs.length - shown.length)} more` : "";
  return `${shown.join(", ")}${more}`;
}
