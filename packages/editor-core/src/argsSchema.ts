// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of the arguments of a command. It has the same rules as `parseArgs` (command.ts). Thus a tool of an
 * agent, the search box and a form of arguments can check and describe the arguments with zod. The JSON schema of the
 * arguments goes into each listing of the registry.
 */
import { z } from "zod";
import type { ArgSpec } from "./command";

/** The zod schema of one argument. */
export function argSchema(spec: ArgSpec): z.ZodType {
  let schema: z.ZodType;
  switch (spec.type) {
    case "number": {
      let value = z.number();
      if (spec.integer === true) value = value.int();
      if (spec.min !== undefined) value = value.min(spec.min);
      if (spec.max !== undefined) value = value.max(spec.max);
      schema = spec.default === undefined ? value : value.default(spec.default);
      break;
    }
    case "string": {
      const [first, ...rest] = spec.values ?? [];
      const value = first === undefined ? z.string().trim().min(1) : z.enum([first, ...rest]);
      schema = spec.default === undefined ? value : value.default(spec.default);
      break;
    }
    case "boolean":
      schema = spec.default === undefined ? z.boolean() : z.boolean().default(spec.default);
      break;
  }
  const described = schema.describe(spec.description);
  return spec.optional === true && spec.default === undefined ? described.optional() : described;
}

/** The zod schema of the arguments of a command: an object with no other keys. */
export function argsSchema(specs: Readonly<Record<string, ArgSpec>>): z.ZodObject {
  return z.strictObject(Object.fromEntries(Object.entries(specs).map(([name, spec]) => [name, argSchema(spec)])));
}

const jsonSchemas = new WeakMap<object, Readonly<Record<string, unknown>>>();

/** The JSON schema of the arguments of a command (the input form: a default makes an argument optional). */
export function argsJsonSchema(specs: Readonly<Record<string, ArgSpec>>): Readonly<Record<string, unknown>> {
  const known = jsonSchemas.get(specs);
  if (known !== undefined) return known;
  const schema = z.toJSONSchema(argsSchema(specs), { io: "input" }) as Record<string, unknown>;
  jsonSchemas.set(specs, schema);
  return schema;
}
