// SPDX-License-Identifier: Apache-2.0
/**
 * A small validator for the subset of JSON Schema (draft 2020-12) that `z.toJSONSchema` writes for the documents.
 * A keyword out of the subset is an error, so the test cannot pass by a keyword that it does not check.
 */
type Schema = Record<string, unknown> | boolean;

const KNOWN = new Set([
  "$schema",
  "$id",
  "$ref",
  "$defs",
  "title",
  "description",
  "type",
  "properties",
  "required",
  "additionalProperties",
  "propertyNames",
  "prefixItems",
  "items",
  "minItems",
  "maxItems",
  "enum",
  "const",
  "anyOf",
  "oneOf",
  "allOf",
  "pattern",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "exclusiveMaximum",
  "minLength",
  "maxLength",
  "format",
  "default",
]);

function typeOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  if (typeof value === "number") return Number.isInteger(value) ? "integer" : "number";
  return typeof value;
}

function typeMatches(type: string, value: unknown): boolean {
  const actual = typeOf(value);
  return type === actual || (type === "number" && actual === "integer");
}

class Validator {
  readonly errors: string[] = [];

  constructor(private readonly defs: Record<string, Schema>) {}

  check(schema: Schema, node: unknown, path: string): void {
    if (schema === true) return;
    if (schema === false) {
      this.fail(path, "no value is allowed");
      return;
    }
    for (const key of Object.keys(schema)) if (!KNOWN.has(key)) throw new Error(`keyword ${key} is not in the subset`);
    if (typeof schema.$ref === "string") {
      const target = this.defs[schema.$ref.replace("#/$defs/", "")];
      if (target === undefined) throw new Error(`no $def for ${schema.$ref}`);
      this.check(target, node, path);
    }
    if (typeof schema.type === "string" && !typeMatches(schema.type, node)) {
      this.fail(path, `not a ${schema.type}`);
      return;
    }
    if ("const" in schema && JSON.stringify(schema.const) !== JSON.stringify(node)) {
      this.fail(path, "not the const");
      return;
    }
    if (Array.isArray(schema.enum) && !schema.enum.includes(node)) {
      this.fail(path, "not in the enum");
      return;
    }
    this.unions(schema, node, path);
    if (typeof node === "string") this.string(schema, node, path);
    if (typeof node === "number") this.number(schema, node, path);
    if (Array.isArray(node)) this.array(schema, node, path);
    else if (typeof node === "object" && node !== null) this.object(schema, node as Record<string, unknown>, path);
  }

  private fail(path: string, message: string): void {
    this.errors.push(`${path || "/"}: ${message}`);
  }

  private passes(schema: Schema, node: unknown, path: string): boolean {
    const before = this.errors.length;
    this.check(schema, node, path);
    const ok = this.errors.length === before;
    this.errors.length = before;
    return ok;
  }

  private unions(schema: Record<string, unknown>, node: unknown, path: string): void {
    const anyOf = Array.isArray(schema.anyOf) ? (schema.anyOf as Schema[]) : undefined;
    if (anyOf !== undefined && !anyOf.some((item) => this.passes(item, node, path))) this.fail(path, "no anyOf branch");
    const oneOf = Array.isArray(schema.oneOf) ? (schema.oneOf as Schema[]) : undefined;
    if (oneOf !== undefined && oneOf.filter((item) => this.passes(item, node, path)).length !== 1) {
      this.fail(path, "not exactly one oneOf branch");
    }
    if (Array.isArray(schema.allOf)) for (const item of schema.allOf as Schema[]) this.check(item, node, path);
  }

  private string(schema: Record<string, unknown>, node: string, path: string): void {
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern, "u").test(node)) {
      this.fail(path, `no match of ${schema.pattern}`);
    }
    if (typeof schema.minLength === "number" && node.length < schema.minLength) this.fail(path, "too short");
    if (typeof schema.maxLength === "number" && node.length > schema.maxLength) this.fail(path, "too long");
  }

  private number(schema: Record<string, unknown>, node: number, path: string): void {
    if (typeof schema.minimum === "number" && node < schema.minimum) this.fail(path, "below the minimum");
    if (typeof schema.maximum === "number" && node > schema.maximum) this.fail(path, "above the maximum");
    if (typeof schema.exclusiveMinimum === "number" && node <= schema.exclusiveMinimum) this.fail(path, "too small");
    if (typeof schema.exclusiveMaximum === "number" && node >= schema.exclusiveMaximum) this.fail(path, "too large");
  }

  private array(schema: Record<string, unknown>, node: unknown[], path: string): void {
    if (typeof schema.minItems === "number" && node.length < schema.minItems) this.fail(path, "too few items");
    if (typeof schema.maxItems === "number" && node.length > schema.maxItems) this.fail(path, "too many items");
    const prefix = Array.isArray(schema.prefixItems) ? (schema.prefixItems as Schema[]) : [];
    node.forEach((item, index) => {
      const itemSchema = prefix[index] ?? (schema.items as Schema | undefined);
      if (itemSchema !== undefined) this.check(itemSchema, item, `${path}/${String(index)}`);
    });
  }

  private object(schema: Record<string, unknown>, node: Record<string, unknown>, path: string): void {
    const properties = (schema.properties ?? {}) as Record<string, Schema>;
    for (const key of (schema.required ?? []) as string[]) if (!(key in node)) this.fail(path, `no ${key}`);
    for (const [key, item] of Object.entries(node)) {
      if (schema.propertyNames !== undefined) this.check(schema.propertyNames as Schema, key, `${path}/${key}`);
      const own = properties[key] ?? (schema.additionalProperties as Schema | undefined);
      if (own !== undefined) this.check(own, item, `${path}/${key}`);
    }
  }
}

/** The errors of a value against a schema (an empty list when the value is valid). */
export function validate(root: Record<string, unknown>, value: unknown): string[] {
  const validator = new Validator((root.$defs ?? {}) as Record<string, Schema>);
  validator.check(root, value, "");
  return validator.errors;
}
