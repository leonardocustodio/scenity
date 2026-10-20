// SPDX-License-Identifier: Apache-2.0
/**
 * The settings form of an importer from the JSON Schema of its settings (`importerForms` of
 * `@scenity/assets`). Each top field of the schema is a field of the form: a number, a flag, a choice of a list, a
 * text, a text that accepts a word or a number ("auto" or a scale), or JSON for a field of more parts (a decimate spec,
 * a list of parts). The settings of an import hold only the fields that the person changed. The importer gives its
 * defaults to the other fields. Pure functions, no DOM.
 */

/** The kind of input of a field. */
export type SettingKind = "number" | "integer" | "boolean" | "choice" | "text" | "word-or-number" | "json";

/** One field of the form. */
export interface SettingField {
  readonly name: string;
  readonly kind: SettingKind;
  /** The values of a choice, or the words of a word-or-number field. */
  readonly choices: readonly string[];
  /** The default of the schema as the text of the input (a flag: "true" or "false"). */
  readonly fallback: string;
  readonly description: string;
  /** True for a field of more parts (the form shows it under "More"). */
  readonly advanced: boolean;
}

type Schema = Readonly<Record<string, unknown>>;

const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The words of a list of options (`const` or `enum`), and true when one option accepts a number. */
function optionsOf(options: readonly Schema[]): { words: string[]; number: boolean; other: boolean } {
  const words: string[] = [];
  let number = false;
  let other = false;
  for (const option of options) {
    if (typeof option.const === "string") words.push(option.const);
    else if (Array.isArray(option.enum))
      words.push(...option.enum.filter((item): item is string => typeof item === "string"));
    else if (option.type === "number" || option.type === "integer") number = true;
    else other = true;
  }
  return { words, number, other };
}

/** The kind and the choices of a property schema. */
function kindOf(schema: Schema): { kind: SettingKind; choices: string[] } {
  if (Array.isArray(schema.enum)) return { kind: "choice", choices: schema.enum.map(String) };
  if (schema.type === "boolean") return { kind: "boolean", choices: [] };
  if (schema.type === "number") return { kind: "number", choices: [] };
  if (schema.type === "integer") return { kind: "integer", choices: [] };
  if (schema.type === "string") return { kind: "text", choices: [] };
  const options = (Array.isArray(schema.anyOf) ? schema.anyOf : Array.isArray(schema.oneOf) ? schema.oneOf : []).filter(
    isSchema,
  );
  if (options.length > 0) {
    const { words, number, other } = optionsOf(options);
    if (!other && number && words.length > 0) return { kind: "word-or-number", choices: words };
    if (!other && !number && words.length > 0) return { kind: "choice", choices: words };
  }
  return { kind: "json", choices: [] };
}

/** The text of a default value for an input. */
function fallbackText(value: unknown): string {
  if (value === undefined) return "";
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The fields of the settings schema of an importer, in the order of the schema. */
export function settingFields(schema: unknown): SettingField[] {
  const properties = isSchema(schema) && isSchema(schema.properties) ? schema.properties : {};
  return Object.entries(properties).flatMap(([name, value]): SettingField[] => {
    if (!isSchema(value)) return [];
    const { kind, choices } = kindOf(value);
    return [
      {
        name,
        kind,
        choices,
        fallback: fallbackText(value.default),
        description: typeof value.description === "string" ? value.description : "",
        advanced: kind === "json",
      },
    ];
  });
}

/**
 * The settings of the inputs: each field whose text differs from its default, as its value. A JSON field that does
 * not read, or a number that is not a number, throws an Error with the name of the field.
 */
export function settingsValue(
  fields: readonly SettingField[],
  texts: Readonly<Record<string, string>>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const field of fields) {
    const text = (texts[field.name] ?? field.fallback).trim();
    if (text === field.fallback || text === "") continue;
    if (field.kind === "boolean") out[field.name] = text === "true";
    else if (field.kind === "number" || field.kind === "integer") {
      const value = Number(text);
      if (!Number.isFinite(value)) throw new Error(field.name);
      out[field.name] = value;
    } else if (field.kind === "word-or-number") out[field.name] = field.choices.includes(text) ? text : Number(text);
    else if (field.kind === "json") {
      try {
        out[field.name] = JSON.parse(text) as unknown;
      } catch {
        throw new Error(field.name);
      }
    } else out[field.name] = text;
  }
  return out;
}

/** The form of the importer of a file name: the first form whose extensions end the name. */
export function formFor<F extends { readonly extensions: readonly string[] }>(
  forms: readonly F[],
  file: string,
): F | undefined {
  const name = file.toLowerCase();
  return forms.find((form) => form.extensions.some((extension) => name.endsWith(extension)));
}
