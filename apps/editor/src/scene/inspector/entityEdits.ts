// SPDX-License-Identifier: Apache-2.0
/**
 * The edits of the inspector on one entity and on one component: the tags, the visible
 * switch, Copy and Paste values of a component (the browser storage keeps the copy, so it pastes into another entity,
 * scene or project of the origin), and the raw JSON of an entity. Each edit is scene ops and one step of the history.
 */
import { docOps, visibilityOps } from "@scenity/editor-core";
import type { ComponentRegistry } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";
import { t } from "../../texts";

/** The storage key of the copied values of a component. */
export const COMPONENT_CLIPBOARD_KEY = "scenity.inspector.component";

/** The copied values of a component. */
export interface ComponentCopy {
  readonly component: string;
  readonly value: unknown;
}

let memory: ComponentCopy | null = null;

/** Keep a copy of the values of a component. */
export function copyComponent(copy: ComponentCopy): void {
  memory = copy;
  try {
    localStorage.setItem(COMPONENT_CLIPBOARD_KEY, JSON.stringify(copy));
  } catch {
    // No storage: the copy stays in the memory of the page.
  }
}

/** The copied values of a component, or null. */
export function copiedComponent(): ComponentCopy | null {
  try {
    const text = localStorage.getItem(COMPONENT_CLIPBOARD_KEY);
    if (text === null) return memory;
    const value = JSON.parse(text) as Partial<ComponentCopy> | null;
    return typeof value?.component === "string" ? { component: value.component, value: value.value } : memory;
  } catch {
    return memory;
  }
}

/** The ops of new tags of an entity (no tag: the key goes). */
export function tagOps(doc: SceneDocument, id: string, tags: readonly string[]): SceneOp[] {
  const now = doc.entities[id]?.tags ?? [];
  const clean = [...new Set(tags.map((tag) => tag.trim()).filter((tag) => tag !== ""))];
  if (clean.length === now.length && clean.every((tag, index) => tag === now[index])) return [];
  const path = `/entities/${id}/tags`;
  return [clean.length === 0 ? { op: "set", path } : { op: "set", path, value: clean }];
}

/** The ops that show or hide an entity. */
export function visibleOps(doc: SceneDocument, id: string, visible: boolean): SceneOp[] {
  return visibilityOps(doc, id, visible);
}

/** The text of the raw JSON mode of an entity (its name, tags and components). */
export function entityJson(entity: Entity): string {
  const { name, tags, components } = entity;
  return JSON.stringify(
    { ...(name === undefined ? {} : { name }), ...(tags === undefined ? {} : { tags }), components },
    null,
    2,
  );
}

/**
 * The ops of a raw JSON text of an entity: its name, tags and components (the place in the tree stays). Throws for a
 * text that is not an object; the registry checks the values when the ops apply.
 */
export function jsonOps(doc: SceneDocument, id: string, text: string, registry: ComponentRegistry): SceneOp[] {
  const value = JSON.parse(text) as unknown;
  const entity = doc.entities[id];
  if (entity === undefined || typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(t("inspector-json-object"));
  }
  const given = value as { name?: unknown; tags?: unknown; components?: unknown };
  const next: Entity = {
    parent: entity.parent,
    index: entity.index,
    components: (typeof given.components === "object" && given.components !== null
      ? given.components
      : {}) as Entity["components"],
    ...(typeof given.name === "string" ? { name: given.name } : {}),
    ...(Array.isArray(given.tags) ? { tags: given.tags as string[] } : {}),
  };
  const ops = docOps(doc, { ...doc, entities: { ...doc.entities, [id]: next } }, registry);
  if (ops === null) throw new Error(t("inspector-json-no-ops"));
  return ops;
}
