// SPDX-License-Identifier: Apache-2.0
/**
 * The values of the inspector: the components that the subjects share, the model of each component (its fields and
 * widgets), and the state of one field over all the subjects. The state tells the value, a mixed value, a stored value
 * or only the default, an override of a prefab instance and the prefab value. No Vue import.
 */
import { getAt, jsonEqual, mergeDefaults } from "@scenity/scene";
import { componentJsonSchema, type ComponentDefinition } from "@scenity/scene/components";
import {
  hasComponent,
  siteTokens,
  storedValue,
  type InspectorSource,
  type PrefabSubject,
  type Subject,
} from "./subjects";
import { fieldLabel, objectFields, widgetOfSchema, type FieldModel, type SchemaNode } from "./widgets";

/** The model of one component: its label, its group, its site and its fields. */
export interface ComponentModel {
  readonly id: string;
  readonly label: string;
  readonly group?: string;
  readonly site: ComponentDefinition["site"];
  /** The fields of an object value. A value that is no object has one field with the key "". */
  readonly fields: readonly FieldModel[];
}

const models = new WeakMap<ComponentDefinition, ComponentModel>();

/** The model of a component from its editor hints and its JSON Schema (kept for each definition). */
export function componentModel(definition: ComponentDefinition): ComponentModel {
  const known = models.get(definition);
  if (known !== undefined) return known;
  const schema: SchemaNode = componentJsonSchema(definition);
  const { editor } = definition;
  const fields: FieldModel[] =
    schema.type === "object" && typeof schema.properties === "object"
      ? objectFields(schema, schema, editor.fields)
      : [{ key: "", label: editor.label, required: true, widget: widgetOfSchema(schema) }];
  const model: ComponentModel = {
    id: definition.id,
    label: editor.label || fieldLabel(definition.id),
    ...(editor.group === undefined ? {} : { group: editor.group }),
    site: definition.site,
    fields,
  };
  models.set(definition, model);
  return model;
}

/**
 * The components that each subject holds, in the order of the registry: the `component` site of the shared
 * components and each `entity` site for entities, or each `scene` site for the scene. A component that the registry
 * does not know is left out (the document keeps its value).
 */
export function sharedComponents(source: InspectorSource, subjects: readonly Subject[]): ComponentDefinition[] {
  if (subjects.length === 0) return [];
  return source.registry.list().filter((definition) => subjects.every((subject) => hasComponent(subject, definition)));
}

/** The components that the "add component" menu offers: `component` site, not on each subject yet. */
export function addableComponents(source: InspectorSource, subjects: readonly Subject[]): ComponentDefinition[] {
  if (subjects.length === 0 || subjects.some((subject) => subject.kind === "scene")) return [];
  return source.registry
    .atSite("component")
    .filter((definition) => !subjects.every((subject) => hasComponent(subject, definition)))
    .sort((a, b) => groupKey(a).localeCompare(groupKey(b)));
}

function groupKey(definition: ComponentDefinition): string {
  return `${definition.editor.group ?? "~"}\u0000${definition.editor.label}`;
}

/** The state of one field over the subjects. */
export interface FieldState {
  /** The value of the first subject (with the defaults), or undefined. */
  readonly value: unknown;
  /** The value of each subject (with the defaults). */
  readonly values: readonly unknown[];
  /** True when the subjects have different values. */
  readonly mixed: boolean;
  /** True when a subject stores a value at the path (not only the default). */
  readonly stored: boolean;
  /** The default of the path, or undefined when the component has none. */
  readonly defaultValue: unknown;
  /** True when a prefab subject has an override at the path or above it. */
  readonly overridden: boolean;
  /** The value of the prefab (no overrides) of the first prefab subject. Undefined for no prefab subject. */
  readonly prefabValue: unknown;
}

/** The tokens of a field path ("" is the whole value). */
export function pathTokens(path: string | readonly string[]): string[] {
  if (typeof path !== "string") return [...path];
  return path === "" ? [] : path.split("/");
}

/** The JSON Pointer of the tokens. */
function pointer(tokens: readonly string[]): string {
  return tokens.map((token) => `/${token.replaceAll("~", "~0").replaceAll("/", "~1")}`).join("");
}

/** True when an override op of a prefab subject sets the pointer, a value under it, or a value above it. */
export function overrideTouches(op: { readonly op: string; readonly path?: string }, at: string): boolean {
  if (op.op !== "set" || op.path === undefined) return false;
  return op.path === at || op.path.startsWith(`${at}/`) || at.startsWith(`${op.path}/`);
}

/** The pointer of a field of a component in the prefab document of a prefab subject. */
export function prefabPointer(
  subject: PrefabSubject,
  definition: ComponentDefinition,
  path: readonly string[],
): string {
  return pointer([...siteTokens(subject, definition), ...path]);
}

/** The state of the field at `path` of a component over the subjects. */
export function fieldState(
  source: InspectorSource,
  subjects: readonly Subject[],
  definition: ComponentDefinition,
  path: string | readonly string[],
): FieldState {
  const tokens = pathTokens(path);
  const values = subjects.map((subject) =>
    getAt(mergeDefaults(definition.defaults, storedValue(source, subject, definition)), tokens),
  );
  const stored = subjects.some((subject) => getAt(storedValue(source, subject, definition), tokens) !== undefined);
  const first = values[0];
  const prefabs = subjects.filter((subject): subject is PrefabSubject => subject.kind === "prefab");
  const overridden = prefabs.some((subject) =>
    subject.overrides.some((op) => overrideTouches(op, prefabPointer(subject, definition, tokens))),
  );
  const original = prefabs[0];
  const prefabValue =
    original === undefined
      ? undefined
      : getAt(mergeDefaults(definition.defaults, originalValue(original, definition)), tokens);
  return {
    value: first,
    values,
    mixed: values.some((value) => !jsonEqual(value, first)),
    stored,
    defaultValue: getAt(definition.defaults, tokens),
    overridden,
    prefabValue,
  };
}

/** The value of a component in the prefab document (no overrides). */
function originalValue(subject: PrefabSubject, definition: ComponentDefinition): unknown {
  if (definition.site === "component") return subject.original.components[definition.id];
  return (subject.original as unknown as Record<string, unknown>)[definition.id];
}

/** For a vector field: true at each part where the subjects have different numbers. */
export function mixedParts(values: readonly unknown[], size: number): boolean[] {
  return Array.from({ length: size }, (_, index) => {
    const parts = values.map((value) => (Array.isArray(value) ? (value[index] as unknown) : undefined));
    return parts.some((part) => part !== parts[0]);
  });
}
