// SPDX-License-Identifier: Apache-2.0
/**
 * The JSON Schema of one component: the editor reads it at run time to make the widgets of the inspector.
 * zod 4 makes it from the schema of the definition (`z.toJSONSchema`, the input form). A part that JSON Schema
 * cannot give (a transform, a custom check) becomes an empty schema, and the inspector shows a JSON field for it.
 * The function keeps each result, so a second call for the same definition costs nothing.
 */
import { z } from "zod";
import type { ComponentDefinition } from "./define";

/** A JSON Schema object (draft 2020-12). */
export type JsonSchemaObject = Readonly<Record<string, unknown>>;

const made = new WeakMap<ComponentDefinition, JsonSchemaObject>();

/** The JSON Schema of the value of a component (draft 2020-12, the input form). */
export function componentJsonSchema(definition: ComponentDefinition): JsonSchemaObject {
  const known = made.get(definition);
  if (known !== undefined) return known;
  let schema: JsonSchemaObject;
  try {
    schema = z.toJSONSchema(definition.schema, {
      io: "input",
      target: "draft-2020-12",
      unrepresentable: "any",
    });
  } catch {
    // A schema with a cycle that zod cannot write: the inspector shows the value as JSON.
    schema = {};
  }
  made.set(definition, schema);
  return schema;
}
