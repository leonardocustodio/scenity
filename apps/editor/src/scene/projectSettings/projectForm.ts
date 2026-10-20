// SPDX-License-Identifier: Apache-2.0
/**
 * The form of the Project settings window from the JSON Schema of the project file (`documentJsonSchemas().project` of
 * `@scenity/scene`). Pure functions, no DOM.
 *
 * - `nodeOf`: the form node of a schema: a text, a number, a flag, a choice, a fixed value, an object of fields, a
 *   list, a map of names, a union of options, or JSON for a free value (the arguments of a rule).
 * - `checkValue`: the problems of a value against its node (required fields, patterns, lengths, limits).
 * - `searchHit`: true when a field or a field below it has the search words in its name or its description.
 * - `setIn`, `renameKey`, `emptyOf`, `optionOf`: the edits of the form on a copy of the project value.
 */

/** A node of the form. */
export type FormNode =
  | {
      readonly kind: "text";
      readonly pattern?: string;
      readonly minLength?: number;
      readonly maxLength?: number;
    }
  | {
      readonly kind: "number" | "integer";
      readonly minimum?: number;
      readonly maximum?: number;
      readonly above?: number;
    }
  | { readonly kind: "boolean" }
  | { readonly kind: "choice"; readonly choices: readonly string[] }
  | { readonly kind: "const"; readonly value: string | number | boolean }
  | { readonly kind: "object"; readonly fields: readonly FormField[] }
  | { readonly kind: "list"; readonly item: FormNode; readonly minItems?: number; readonly maxItems?: number }
  | { readonly kind: "map"; readonly value: FormNode; readonly keyPattern?: string }
  | { readonly kind: "union"; readonly options: readonly FormOption[] }
  | { readonly kind: "json" };

/** One field of an object node. */
export interface FormField {
  readonly name: string;
  readonly required: boolean;
  readonly description: string;
  readonly node: FormNode;
}

/** One option of a union: its label is the fixed `kind` of an object option, else the kind of its node. */
export interface FormOption {
  readonly label: string;
  readonly node: FormNode;
}

/** A problem of a value. `id` is a Fluent ID; `path` is the dotted path of the value. */
export interface FormProblem {
  readonly path: string;
  readonly id: string;
  readonly args: Readonly<Record<string, string | number>>;
}

type Schema = Readonly<Record<string, unknown>>;
type Json = unknown;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => isSchema(value);
const num = (value: unknown): number | undefined => (typeof value === "number" ? value : undefined);
const optional = <K extends string, V>(key: K, value: V | undefined): Partial<Record<K, V>> =>
  (value === undefined ? {} : { [key]: value }) as Partial<Record<K, V>>;

/** The node of a primitive schema, or null. */
function primitiveOf(schema: Schema): FormNode | null {
  if (schema.const !== undefined && ["string", "number", "boolean"].includes(typeof schema.const))
    return { kind: "const", value: schema.const as string | number | boolean };
  if (Array.isArray(schema.enum)) return { kind: "choice", choices: schema.enum.map(String) };
  if (schema.type === "boolean") return { kind: "boolean" };
  if (schema.type === "string")
    return {
      kind: "text",
      ...optional("pattern", typeof schema.pattern === "string" ? schema.pattern : undefined),
      ...optional("minLength", num(schema.minLength)),
      ...optional("maxLength", num(schema.maxLength)),
    };
  if (schema.type === "number" || schema.type === "integer")
    return {
      kind: schema.type,
      ...optional("minimum", num(schema.minimum)),
      ...optional("maximum", num(schema.maximum)),
      ...optional("above", num(schema.exclusiveMinimum)),
    };
  return null;
}

/** The label of a union option. */
function optionLabel(node: FormNode): string {
  if (node.kind !== "object") return node.kind;
  const kind = node.fields.find((field) => field.name === "kind")?.node;
  return kind?.kind === "const" ? String(kind.value) : "object";
}

/** The form node of a schema. `defs` are the `$defs` of the root; a reference to itself gives a JSON node. */
export function nodeOf(schema: unknown, defs: Schema = {}, seen: ReadonlySet<string> = new Set()): FormNode {
  if (!isSchema(schema)) return { kind: "json" };
  if (typeof schema.$ref === "string") {
    const name = schema.$ref.replace("#/$defs/", "");
    return seen.has(name) ? { kind: "json" } : nodeOf(defs[name], defs, new Set([...seen, name]));
  }
  const options = (Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : []).filter(
    isSchema,
  );
  if (options.length > 0) {
    // A union with null is a free JSON value.
    if (options.some((option) => option.type === "null")) return { kind: "json" };
    const nodes = options.map((option) => nodeOf(option, defs, seen));
    return { kind: "union", options: nodes.map((node) => ({ label: optionLabel(node), node })) };
  }
  const primitive = primitiveOf(schema);
  if (primitive !== null) return primitive;
  if (schema.type === "array")
    return {
      kind: "list",
      item: nodeOf(schema.items, defs, seen),
      ...optional("minItems", num(schema.minItems)),
      ...optional("maxItems", num(schema.maxItems)),
    };
  if (schema.type === "object" && isSchema(schema.properties)) {
    const required = Array.isArray(schema.required) ? schema.required : [];
    const fields = Object.entries(schema.properties).map(([name, value]) => ({
      name,
      required: required.includes(name),
      description: isSchema(value) && typeof value.description === "string" ? value.description : "",
      node: nodeOf(value, defs, seen),
    }));
    return { kind: "object", fields };
  }
  if (schema.type === "object" && isSchema(schema.additionalProperties)) {
    const names = isSchema(schema.propertyNames) ? schema.propertyNames.pattern : undefined;
    return {
      kind: "map",
      value: nodeOf(schema.additionalProperties, defs, seen),
      ...optional("keyPattern", typeof names === "string" ? names : undefined),
    };
  }
  return { kind: "json" };
}

/** The form node of the root of the project schema. */
export function projectNode(schema: unknown): FormNode {
  return nodeOf(schema, isSchema(schema) && isSchema(schema.$defs) ? schema.$defs : {});
}

/** True when a value has the shape of a node (for the choice of a union option). */
export function fits(node: FormNode, value: Json): boolean {
  switch (node.kind) {
    case "text":
      return typeof value === "string";
    case "number":
    case "integer":
      return typeof value === "number";
    case "boolean":
      return typeof value === "boolean";
    case "choice":
      return typeof value === "string" && node.choices.includes(value);
    case "const":
      return value === node.value;
    case "list":
      return Array.isArray(value);
    case "map":
      return isRecord(value);
    case "object": {
      if (!isRecord(value)) return false;
      const kind = node.fields.find((field) => field.name === "kind")?.node;
      return kind?.kind !== "const" || value.kind === kind.value;
    }
    case "union":
      return node.options.some((option) => fits(option.node, value));
    case "json":
      return true;
  }
}

/** The index of the option of a union that a value fits (the first option when none fits). */
export function optionOf(node: Extract<FormNode, { kind: "union" }>, value: Json): number {
  return Math.max(
    0,
    node.options.findIndex((option) => fits(option.node, value)),
  );
}

/** A new value for a node: the empty value of its kind, with each required field of an object. */
export function emptyOf(node: FormNode): Json {
  switch (node.kind) {
    case "text":
      return "";
    case "number":
    case "integer":
      return node.minimum ?? (node.above === undefined ? 0 : node.above + 1);
    case "boolean":
      return false;
    case "choice":
      return node.choices[0] ?? "";
    case "const":
      return node.value;
    case "list":
      return [];
    case "map":
      return {};
    case "object":
      return Object.fromEntries(
        node.fields.filter((field) => field.required).map((field) => [field.name, emptyOf(field.node)]),
      );
    case "union":
      return node.options[0] === undefined ? null : emptyOf(node.options[0].node);
    case "json":
      return null;
  }
}

/** One step of a path: a field or map name, or a list index. */
export type PathStep = string | number;

/** The dotted text of a path ("build.budgets.player.gzipKB", "scenes[2]"). */
export function pathText(path: readonly PathStep[]): string {
  return path
    .map((step, index) => (typeof step === "number" ? `[${String(step)}]` : index === 0 ? step : `.${step}`))
    .join("");
}

/** A copy of `root` with `value` at `path`; undefined removes the field (or the list item). */
export function setIn(root: Json, path: readonly PathStep[], value: Json): Json {
  const [step, ...rest] = path;
  if (step === undefined) return value;
  if (typeof step === "number") {
    const list = Array.isArray(root) ? [...(root as Json[])] : [];
    if (rest.length === 0 && value === undefined) list.splice(step, 1);
    else list[step] = setIn(list[step], rest, value);
    return list;
  }
  const object: Record<string, Json> = isRecord(root) ? root : {};
  const next = setIn(object[step], rest, value);
  const entries = Object.entries(object).filter(([key]) => key !== step);
  if (next === undefined) return Object.fromEntries(entries);
  // A new value keeps the place of the field.
  return Object.fromEntries(
    step in object
      ? Object.entries(object).map(([key, item]) => [key, key === step ? next : item])
      : [...entries, [step, next]],
  );
}

/** A copy of a map with the key `from` named `to`, in the same place. */
export function renameKey(map: Json, from: string, to: string): Json {
  if (!isRecord(map) || from === to || to in map) return map;
  return Object.fromEntries(Object.entries(map).map(([key, value]) => [key === from ? to : key, value]));
}

/** The problems of a primitive value. */
function primitiveProblems(node: FormNode, value: Json, path: string): FormProblem[] {
  const problem = (id: string, args: FormProblem["args"] = {}): FormProblem[] => [{ path, id, args }];
  if (node.kind === "text") {
    if (typeof value !== "string") return problem("project-check-type");
    if (node.minLength !== undefined && value.length < node.minLength)
      return problem("project-check-min-length", { min: node.minLength });
    if (node.maxLength !== undefined && value.length > node.maxLength)
      return problem("project-check-max-length", { max: node.maxLength });
    if (node.pattern !== undefined && !new RegExp(node.pattern, "u").test(value))
      return problem("project-check-pattern", { pattern: node.pattern });
    return [];
  }
  if (node.kind === "number" || node.kind === "integer") {
    if (typeof value !== "number" || !Number.isFinite(value)) return problem("project-check-type");
    if (node.kind === "integer" && !Number.isInteger(value)) return problem("project-check-integer");
    if (node.minimum !== undefined && value < node.minimum)
      return problem("project-check-minimum", { min: node.minimum });
    if (node.above !== undefined && value <= node.above) return problem("project-check-above", { min: node.above });
    if (node.maximum !== undefined && value > node.maximum)
      return problem("project-check-maximum", { max: node.maximum });
    return [];
  }
  if (node.kind === "boolean") return typeof value === "boolean" ? [] : problem("project-check-type");
  if (node.kind === "choice" || node.kind === "const") return fits(node, value) ? [] : problem("project-check-choice");
  return [];
}

/** The problems of a value against its node, with the dotted path of each. */
export function checkValue(node: FormNode, value: Json, path: readonly PathStep[] = []): FormProblem[] {
  const at = pathText(path);
  if (node.kind === "object") {
    if (!isRecord(value)) return [{ path: at, id: "project-check-type", args: {} }];
    return node.fields.flatMap((field) => {
      const item = value[field.name];
      if (item === undefined)
        return field.required
          ? [{ path: pathText([...path, field.name]), id: "project-check-required", args: {} }]
          : [];
      return checkValue(field.node, item, [...path, field.name]);
    });
  }
  if (node.kind === "list") {
    if (!Array.isArray(value)) return [{ path: at, id: "project-check-type", args: {} }];
    const count: FormProblem[] =
      node.minItems !== undefined && value.length < node.minItems
        ? [{ path: at, id: "project-check-min-items", args: { min: node.minItems } }]
        : node.maxItems !== undefined && value.length > node.maxItems
          ? [{ path: at, id: "project-check-max-items", args: { max: node.maxItems } }]
          : [];
    return [...count, ...value.flatMap((item, index) => checkValue(node.item, item, [...path, index]))];
  }
  if (node.kind === "map") {
    if (!isRecord(value)) return [{ path: at, id: "project-check-type", args: {} }];
    return Object.entries(value).flatMap(([key, item]) => [
      ...(node.keyPattern !== undefined && !new RegExp(node.keyPattern, "u").test(key)
        ? [{ path: pathText([...path, key]), id: "project-check-key", args: { pattern: node.keyPattern } }]
        : []),
      ...checkValue(node.value, item, [...path, key]),
    ]);
  }
  if (node.kind === "union") {
    const option = node.options.find((item) => fits(item.node, value));
    return option === undefined
      ? [{ path: at, id: "project-check-type", args: {} }]
      : checkValue(option.node, value, path);
  }
  if (node.kind === "json") return [];
  return primitiveProblems(node, value, at);
}

/** The field names and descriptions of a node and the nodes below it. */
function wordsOf(node: FormNode): string[] {
  if (node.kind === "object")
    return node.fields.flatMap((field) => [field.name, field.description, ...wordsOf(field.node)]);
  if (node.kind === "list") return wordsOf(node.item);
  if (node.kind === "map") return wordsOf(node.value);
  if (node.kind === "union") return node.options.flatMap((option) => [option.label, ...wordsOf(option.node)]);
  return [];
}

/** The hit of a search on a field: "self" (the field matches), "inside" (a field below it matches) or null. */
export function searchHit(
  field: Pick<FormField, "name" | "description" | "node">,
  query: string,
): "self" | "inside" | null {
  const words = query.trim().toLowerCase();
  if (words === "") return "self";
  const matches = (text: string): boolean => text.toLowerCase().includes(words);
  if (matches(field.name) || matches(field.description)) return "self";
  return wordsOf(field.node).some(matches) ? "inside" : null;
}
