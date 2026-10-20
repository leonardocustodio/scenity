// SPDX-License-Identifier: Apache-2.0
/**
 * The widget model of the inspector. Each field of a component gets a widget from its editor hint (`FieldWidget` of
 * `@scenity/scene/components`) and from the JSON Schema of the component. A hint gives the kind and the label. The
 * schema gives the limits, the items and the fields that the hint does not name. A field with no hint, or with a
 * `custom` hint, gets the widget of its schema. Thus a component of a plugin shows in the inspector with no editor
 * code. No Vue import, no DOM.
 */
import type { FieldHint, FieldWidget } from "@scenity/scene/components";

/** The limits of a number: from the schema, or from the hint. */
export interface NumberLimits {
  readonly min?: number;
  readonly max?: number;
  readonly step: number;
  readonly unit?: string;
  readonly integer: boolean;
  /** True when the value must be above `min` (an exclusive minimum of the schema). */
  readonly above?: boolean;
}

/** The widget of one value. */
export type WidgetModel =
  | ({ readonly kind: "number" } & NumberLimits)
  | ({ readonly kind: "vector"; readonly size: number } & NumberLimits)
  /** A unit quaternion `[x, y, z, w]` that the editor shows as Euler angles in degrees (order XYZ). */
  | { readonly kind: "quaternion" }
  /** `#rrggbb` or `[r, g, b]` (0 to 255). The widget writes the form of the current value, else `#rrggbb`. */
  | { readonly kind: "colour" }
  | { readonly kind: "enum"; readonly options: readonly string[] }
  | { readonly kind: "boolean" }
  | { readonly kind: "string"; readonly multiline: boolean }
  /** `asset:<id>`. The picker shows the assets of the kind (all assets with no kind). */
  | { readonly kind: "assetRef"; readonly assetKind?: string }
  /** `entity:<id>` or `entity:<id>#<sub>`. The picker shows the entities of the scene and their sockets. */
  | { readonly kind: "entityRef" }
  /** A list of keys (an object with a time and a value) or a line of points (vectors). */
  | { readonly kind: "curve"; readonly form: "keys"; readonly time: string; readonly value: string }
  | { readonly kind: "curve"; readonly form: "points"; readonly size: number }
  /** `itemCustom` is the name of the custom widget of an item (`materialOverride`: a pick of a part). */
  | {
      readonly kind: "list";
      readonly item: WidgetModel;
      readonly min?: number;
      readonly max?: number;
      readonly itemCustom?: string;
    }
  | { readonly kind: "map"; readonly item: WidgetModel; readonly itemCustom?: string }
  | { readonly kind: "object"; readonly fields: readonly FieldModel[] }
  /** One of some forms (a point or an entity, a kind of fog). The widget finds the form of the value. */
  | { readonly kind: "choice"; readonly options: readonly WidgetModel[] }
  /** A value that no other widget fits: the widget edits its JSON text. */
  | { readonly kind: "json" };

/** One field of an object: its key, its label, its group in the inspector and its widget. */
export interface FieldModel {
  readonly key: string;
  readonly label: string;
  readonly group?: string;
  /** True when the schema needs the field (no default can fill it). */
  readonly required: boolean;
  readonly widget: WidgetModel;
  /** The name of the custom widget of the hint. The editor shows it when it has one, else it shows `widget`. */
  readonly custom?: string;
}

/** A JSON Schema node. */
export type SchemaNode = Readonly<Record<string, unknown>>;

/** The deepest nest of a schema that the model follows. A deeper part gets a JSON widget. */
const MAX_DEPTH = 8;
/** A limit above this value is no real limit of an editor (zod writes the safe integer range). */
const NO_LIMIT = 1e12;
const COLOUR_PATTERN = "^#[0-9a-fA-F]{6}$";

function node(value: unknown): SchemaNode | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as SchemaNode) : undefined;
}

function nodes(value: unknown): SchemaNode[] {
  return Array.isArray(value) ? value.map(node).filter((item): item is SchemaNode => item !== undefined) : [];
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) && Math.abs(value) < NO_LIMIT ? value : undefined;
}

/** "castShadow" is "Cast shadow"; "shadow_bias" is "Shadow bias". */
export function fieldLabel(key: string): string {
  const words = key
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replaceAll("_", " ")
    .toLowerCase();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

/** The schema of a `$ref` in the `$defs` of the root, or the node itself. */
function deref(schema: SchemaNode, root: SchemaNode): SchemaNode {
  const ref = schema.$ref;
  if (typeof ref !== "string" || !ref.startsWith("#/$defs/")) return schema;
  return node(node(root.$defs)?.[ref.slice("#/$defs/".length)]) ?? {};
}

function typeOf(schema: SchemaNode): string | undefined {
  return typeof schema.type === "string" ? schema.type : undefined;
}

function limits(schema: SchemaNode, unit?: string): NumberLimits {
  const integer = typeOf(schema) === "integer";
  const min = num(schema.minimum) ?? num(schema.exclusiveMinimum);
  const max = num(schema.maximum) ?? num(schema.exclusiveMaximum);
  const above = num(schema.minimum) === undefined && num(schema.exclusiveMinimum) !== undefined;
  return {
    ...(min === undefined ? {} : { min }),
    ...(above ? { above } : {}),
    ...(max === undefined ? {} : { max }),
    step: integer ? 1 : 0.01,
    ...(unit === undefined ? {} : { unit }),
    integer,
  };
}

/** True for the colour schemas of `@scenity/scene` (`#rrggbb`, or the union with `[r, g, b]`). */
function isColour(schema: SchemaNode): boolean {
  if (schema.pattern === COLOUR_PATTERN) return true;
  const options = nodes(schema.anyOf);
  return options.length > 0 && options.some((option) => option.pattern === COLOUR_PATTERN);
}

/** The number parts of a tuple schema, or undefined when an item is not a number. */
function numberTuple(schema: SchemaNode, root: SchemaNode): SchemaNode[] | undefined {
  const items = nodes(schema.prefixItems).map((item) => deref(item, root));
  if (items.length === 0) return undefined;
  return items.every((item) => typeOf(item) === "number" || typeOf(item) === "integer") ? items : undefined;
}

/** The time key and the value key of a keyframe object (`{ t, value }`, `{ time, value }`), or undefined. */
function keyFields(schema: SchemaNode): { time: string; value: string } | undefined {
  const properties = node(schema.properties);
  if (properties === undefined) return undefined;
  const isNumber = (key: string) => {
    const type = typeOf(node(properties[key]) ?? {});
    return type === "number" || type === "integer";
  };
  const time = ["t", "time"].find(isNumber);
  const value = ["value", "v"].find(isNumber);
  return time === undefined || value === undefined ? undefined : { time, value };
}

function arrayWidget(schema: SchemaNode, root: SchemaNode, depth: number): WidgetModel {
  const tuple = numberTuple(schema, root);
  if (tuple !== undefined) {
    const first = tuple[0] ?? {};
    return { kind: "vector", size: tuple.length, ...limits(first) };
  }
  const item = node(schema.items);
  if (item === undefined) return { kind: "json" };
  const itemSchema = deref(item, root);
  const keys = keyFields(itemSchema);
  if (keys !== undefined) return { kind: "curve", form: "keys", ...keys };
  const min = num(schema.minItems);
  const max = num(schema.maxItems);
  return {
    kind: "list",
    item: widgetOfSchema(itemSchema, root, depth + 1),
    ...(min === undefined ? {} : { min }),
    ...(max === undefined ? {} : { max }),
  };
}

function stringWidget(schema: SchemaNode): WidgetModel {
  const pattern = typeof schema.pattern === "string" ? schema.pattern : "";
  if (pattern.startsWith("^asset:")) return { kind: "assetRef" };
  if (pattern.startsWith("^entity:")) return { kind: "entityRef" };
  return { kind: "string", multiline: false };
}

function choiceWidget(options: readonly SchemaNode[], root: SchemaNode, depth: number): WidgetModel {
  const real = options.filter((option) => typeOf(option) !== "null");
  if (real.length === 1 && real[0] !== undefined) return widgetOfSchema(real[0], root, depth);
  const enums = real.map((option) => option.const);
  if (real.length > 0 && enums.every((value) => typeof value === "string")) {
    return { kind: "enum", options: enums };
  }
  return { kind: "choice", options: real.map((option) => widgetOfSchema(option, root, depth + 1)) };
}

/** The widget of a JSON Schema node. `root` holds the `$defs` of the references. */
export function widgetOfSchema(schema: SchemaNode, root: SchemaNode = schema, depth = 0): WidgetModel {
  if (depth > MAX_DEPTH) return { kind: "json" };
  const own = deref(schema, root);
  if (isColour(own)) return { kind: "colour" };
  const options = nodes(own.anyOf ?? own.oneOf);
  if (options.length > 0) return choiceWidget(options, root, depth);
  if (Array.isArray(own.enum) && own.enum.every((value) => typeof value === "string")) {
    return { kind: "enum", options: own.enum };
  }
  if (typeof own.const === "string") return { kind: "enum", options: [own.const] };
  switch (typeOf(own)) {
    case "boolean":
      return { kind: "boolean" };
    case "number":
    case "integer":
      return { kind: "number", ...limits(own) };
    case "string":
      return stringWidget(own);
    case "array":
      return arrayWidget(own, root, depth);
    case "object":
      return objectWidget(own, root, depth);
    default:
      return { kind: "json" };
  }
}

/** The fields of an object schema, in the order of the hints first, then of the schema. */
export function objectFields(
  schema: SchemaNode,
  root: SchemaNode,
  hints: Readonly<Record<string, FieldHint>> = {},
  depth = 0,
): FieldModel[] {
  const properties = node(schema.properties) ?? {};
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const keys = [...Object.keys(hints).filter((key) => key in properties), ...Object.keys(properties)];
  return [...new Set(keys)].map((key) => {
    const hint = hints[key];
    const fieldSchema = deref(node(properties[key]) ?? {}, root);
    return {
      key,
      label: hint?.label ?? fieldLabel(key),
      ...(hint?.group === undefined ? {} : { group: hint.group }),
      required: required.has(key),
      widget: widgetOf(fieldSchema, root, hint?.widget, depth + 1),
      ...(hint?.widget.kind === "custom" ? { custom: hint.widget.name } : {}),
    };
  });
}

function objectWidget(schema: SchemaNode, root: SchemaNode, depth: number): WidgetModel {
  if (node(schema.properties) !== undefined) return { kind: "object", fields: objectFields(schema, root, {}, depth) };
  const item = node(schema.additionalProperties);
  if (item !== undefined) return { kind: "map", item: widgetOfSchema(item, root, depth + 1) };
  return { kind: "json" };
}

/** The item schema of a list or a map schema. */
function itemSchema(schema: SchemaNode, root: SchemaNode): SchemaNode {
  return deref(node(schema.items) ?? node(schema.additionalProperties) ?? {}, root);
}

/** The widget of a hint with the details of the schema. A `custom` hint (or none) gives the widget of the schema. */
export function widgetOf(schema: SchemaNode, root: SchemaNode, hint?: FieldWidget, depth = 0): WidgetModel {
  const fromSchema = widgetOfSchema(schema, root, depth);
  // `materialOverrides` is a map of the overrides of the parts. Its items are `materialOverride` items.
  if (hint?.kind === "custom" && hint.name === "materialOverrides" && fromSchema.kind === "map")
    return { ...fromSchema, itemCustom: "materialOverride" };
  if (hint === undefined || hint.kind === "custom") return fromSchema;
  const base = fromSchema.kind === "number" || fromSchema.kind === "vector" ? fromSchema : undefined;
  switch (hint.kind) {
    case "number":
      return {
        kind: "number",
        integer: base?.integer ?? false,
        step: hint.step ?? base?.step ?? 0.01,
        ...pick({ min: hint.min ?? base?.min, max: hint.max ?? base?.max, unit: hint.unit ?? base?.unit }),
      };
    case "vector3":
      return { kind: "vector", size: 3, integer: false, step: hint.step ?? 0.01, ...pick({ unit: hint.unit }) };
    case "enum":
      return { kind: "enum", options: hint.options };
    case "assetRef":
      return { kind: "assetRef", assetKind: hint.assetKind };
    case "string":
      return { kind: "string", multiline: hint.multiline === true };
    case "curve":
      return fromSchema.kind === "curve" ? fromSchema : curveOf(fromSchema);
    case "list":
    case "map":
      return {
        kind: hint.kind,
        item: widgetOf(itemSchema(schema, root), root, hint.item, depth + 1),
        ...(fromSchema.kind === "list" ? pick({ min: fromSchema.min, max: fromSchema.max }) : {}),
        ...(hint.item.kind === "custom" ? { itemCustom: hint.item.name } : {}),
      };
    default:
      return { kind: hint.kind };
  }
}

/** A curve of points from a list of vectors. Another list stays a list. */
function curveOf(widget: WidgetModel): WidgetModel {
  if (widget.kind === "list" && widget.item.kind === "vector") {
    return { kind: "curve", form: "points", size: widget.item.size };
  }
  return widget;
}

/** The entries of an object with a value (no undefined), for the optional fields of a model. */
function pick<T extends Record<string, unknown>>(values: T): { [K in keyof T]?: Exclude<T[K], undefined> } {
  const entries = Object.entries(values).filter(([, value]) => value !== undefined);
  return Object.fromEntries(entries) as { [K in keyof T]?: Exclude<T[K], undefined> };
}
