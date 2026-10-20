// SPDX-License-Identifier: Apache-2.0
/**
 * The subjects of the inspector: what one inspector view edits. A subject is the scene (its `environment` and other
 * scene-level values), an entity of the document, or an entity of a prefab under an instance. A prefab entity has the
 * ID `<instance>/<prefab entity>`, as `expandPrefabs` gives it. Its values are the prefab values with the instance
 * overrides on top. An edit of it changes the overrides of the instance, never the prefab document. No Vue import.
 */
import type { ComponentDefinition, ComponentRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import { prefabOf } from "@scenity/scene";
import type { EntityDocument, PrefabDocument } from "@scenity/scene/schema/documents";
import type { Entity, SceneOp } from "@scenity/scene/schema/entity";

/** What the inspector reads: the document, the components and the prefab documents of the instances. */
export interface InspectorSource {
  readonly doc: EntityDocument;
  readonly registry: ComponentRegistry;
  /** The prefab document of a `prefab.source` value, or undefined when the page does not have it. */
  readonly prefab?: (source: string) => PrefabDocument | undefined;
}

/** The scene itself: its scene-level values (the `scene` site of a component). */
export interface SceneSubject {
  readonly kind: "scene";
}

/** An entity of the document. */
export interface EntitySubject {
  readonly kind: "entity";
  readonly id: string;
  readonly entity: Entity;
}

/** An entity of the prefab of an instance, with the overrides of the instance on top. */
export interface PrefabSubject {
  readonly kind: "prefab";
  /** `<instance>/<prefab entity>`. */
  readonly id: string;
  readonly instance: string;
  /** The ID of the entity in the prefab document. */
  readonly entityId: string;
  /** The entity with the overrides. */
  readonly entity: Entity;
  /** The entity of the prefab document (no overrides). */
  readonly original: Entity;
  /** The current overrides of the instance. */
  readonly overrides: readonly SceneOp[];
}

export type Subject = SceneSubject | EntitySubject | PrefabSubject;

export const SCENE_SUBJECT: SceneSubject = { kind: "scene" };

/** The prefab document and the overrides of an instance entity, or undefined. */
function instanceOf(
  source: InspectorSource,
  instance: string,
): { prefab: PrefabDocument; overrides: readonly SceneOp[] } | undefined {
  const entity = source.doc.entities[instance];
  const value = entity === undefined ? undefined : prefabOf(entity);
  const prefab = value === undefined ? undefined : source.prefab?.(value.source);
  return prefab === undefined ? undefined : { prefab, overrides: value?.overrides ?? [] };
}

/** The prefab document with the overrides. Each op applies alone, and a bad op does not stop the others. */
export function withOverrides(
  prefab: PrefabDocument,
  overrides: readonly SceneOp[],
  registry: ComponentRegistry,
): PrefabDocument {
  let doc = prefab;
  for (const op of overrides) {
    const result = applyOps(doc, [op], registry);
    if (result.ok) doc = result.doc;
  }
  return doc;
}

/** The subject of an entity ID (a document entity, or `<instance>/<prefab entity>`), or null. */
export function subjectOf(source: InspectorSource, id: string): EntitySubject | PrefabSubject | null {
  const entity = source.doc.entities[id];
  if (entity !== undefined) return { kind: "entity", id, entity };
  const slash = id.indexOf("/");
  if (slash < 0) return null;
  const instance = id.slice(0, slash);
  const entityId = id.slice(slash + 1);
  const found = instanceOf(source, instance);
  const original = found?.prefab.entities[entityId];
  if (found === undefined || original === undefined) return null;
  const shown = withOverrides(found.prefab, found.overrides, source.registry).entities[entityId];
  if (shown === undefined) return null;
  return { kind: "prefab", id, instance, entityId, entity: shown, original, overrides: found.overrides };
}

/** The subjects of a list of IDs. An ID with no subject is left out. */
export function subjectsOf(source: InspectorSource, ids: readonly string[]): (EntitySubject | PrefabSubject)[] {
  return ids.map((id) => subjectOf(source, id)).filter((subject) => subject !== null);
}

/** One entity of the prefab of an instance, for the list of the inspector. */
export interface PrefabEntityChoice {
  /** `<instance>/<prefab entity>`. */
  readonly id: string;
  readonly label: string;
  /** The number of override ops of the instance on this entity. */
  readonly overrides: number;
}

/** The entities of the prefab of an instance (empty when the entity is no instance or the page has no prefab). */
export function prefabEntities(source: InspectorSource, instance: string): PrefabEntityChoice[] {
  const found = instanceOf(source, instance);
  if (found === undefined) return [];
  return Object.entries(found.prefab.entities).map(([id, entity]) => ({
    id: `${instance}/${id}`,
    label: entity.name ?? id,
    overrides: found.overrides.filter((op) => opEntity(op) === id).length,
  }));
}

/** The prefab entity that an override op changes. */
export function opEntity(op: SceneOp): string | undefined {
  if (op.op !== "set") return op.id;
  const match = /^\/entities\/([^/]+)/.exec(op.path);
  return match?.[1];
}

/** The tokens of the value of a component in the document of a subject (the scene or the prefab document). */
export function siteTokens(subject: Subject, definition: ComponentDefinition): string[] {
  if (subject.kind === "scene") return [definition.id];
  const id = subject.kind === "prefab" ? subject.entityId : subject.id;
  return definition.site === "component"
    ? ["entities", id, "components", definition.id]
    : ["entities", id, definition.id];
}

/** The stored value of a component of a subject (no defaults), or undefined. */
export function storedValue(source: InspectorSource, subject: Subject, definition: ComponentDefinition): unknown {
  if (subject.kind === "scene") return (source.doc as unknown as Record<string, unknown>)[definition.id];
  if (definition.site === "component") return subject.entity.components[definition.id];
  return (subject.entity as unknown as Record<string, unknown>)[definition.id];
}

/** True when the subject can hold the component: the site fits, and a `component` site has the component. */
export function hasComponent(subject: Subject, definition: ComponentDefinition): boolean {
  if (subject.kind === "scene") return definition.site === "scene";
  if (definition.site === "scene") return false;
  return definition.site === "entity" || Object.hasOwn(subject.entity.components, definition.id);
}
