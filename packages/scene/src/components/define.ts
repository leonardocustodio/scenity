// SPDX-License-Identifier: Apache-2.0
/**
 * The definition of a component type: the ID, the version, the zod schema of the stored
 * value, the defaults, the editor hints and the migrations from older versions. A plugin defines its components with
 * the same function and registers them in a `ComponentRegistry`.
 */
import type { z } from "zod";
import { COMPONENT_ID_PATTERN } from "../schema/common";

/** The editor widget of one field. The editor shows a quaternion as Euler angles in degrees (order XYZ). */
export type FieldWidget =
  | {
      readonly kind: "number";
      readonly unit?: string;
      readonly min?: number;
      readonly max?: number;
      readonly step?: number;
    }
  | { readonly kind: "vector3"; readonly unit?: string; readonly step?: number }
  | { readonly kind: "quaternion" }
  | { readonly kind: "colour" }
  | { readonly kind: "enum"; readonly options: readonly string[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "assetRef"; readonly assetKind: string }
  | { readonly kind: "entityRef" }
  | { readonly kind: "string"; readonly multiline?: boolean }
  | { readonly kind: "curve" }
  | { readonly kind: "list"; readonly item: FieldWidget }
  | { readonly kind: "map"; readonly item: FieldWidget }
  | { readonly kind: "custom"; readonly name: string };

/** The editor hint of one field: the widget, the label and an optional group in the inspector. */
export interface FieldHint {
  readonly widget: FieldWidget;
  readonly label: string;
  readonly group?: string;
}

/** The editor hints of a component: its label, its group in the "add component" menu and its fields. */
export interface EditorHints {
  readonly label: string;
  readonly group?: string;
  readonly fields: Readonly<Record<string, FieldHint>>;
}

/**
 * Where a document keeps the value. `component` is the `components` map of an entity. `entity` is a field of the
 * entity with the component ID as its name (`tags`). `scene` is a field of the scene with that name (`environment`).
 */
export type ComponentSite = "component" | "entity" | "scene";

/** One upcaster: it changes a value of the version `from` into a value of the version `from + 1`. */
export type ComponentUpcaster = (value: unknown) => unknown;

export interface ComponentDefinition<V = unknown> {
  readonly id: string;
  /** The current version (1 or more). A document that holds an older version goes through `migrate`. */
  readonly version: number;
  readonly schema: z.ZodType<V>;
  /** The values that the document can omit. `fill` puts them under the stored value. */
  readonly defaults: unknown;
  readonly editor: EditorHints;
  /** The upcasters by the version that they read: `migrate[1]` changes a version 1 value into version 2. */
  readonly migrate: Readonly<Record<number, ComponentUpcaster>>;
  readonly site: ComponentSite;
}

export interface ComponentInput<V> {
  readonly id: string;
  readonly version?: number;
  readonly schema: z.ZodType<V>;
  readonly defaults?: unknown;
  readonly editor: EditorHints;
  readonly migrate?: Readonly<Record<number, ComponentUpcaster>>;
  readonly site?: ComponentSite;
}

/** Make a component definition. The function checks the ID and the chain of upcasters. */
export function defineComponent<V>(input: ComponentInput<V>): ComponentDefinition<V> {
  const version = input.version ?? 1;
  if (!COMPONENT_ID_PATTERN.test(input.id)) throw new Error(`"${input.id}" is not a component ID`);
  if (!Number.isInteger(version) || version < 1) throw new Error(`${input.id}: the version must be 1 or more`);
  const migrate = input.migrate ?? {};
  for (let from = 1; from < version; from += 1) {
    if (typeof migrate[from] !== "function") throw new Error(`${input.id}: no upcaster from version ${String(from)}`);
  }
  return {
    id: input.id,
    version,
    schema: input.schema,
    defaults: input.defaults ?? {},
    editor: input.editor,
    migrate,
    site: input.site ?? "component",
  };
}
