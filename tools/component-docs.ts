// SPDX-License-Identifier: Apache-2.0
/**
 * The docs page of the built-in components: `docs/components.md`, one section for each
 * component of the registry of `@scenity/scene` (its ID, its label, its group, where a document keeps it) with a row for
 * each field (the name, the label of the editor, the kind of value, the description of the schema). The card of a
 * component in the inspector links to its section. `bun tools/component-docs.ts` writes the page. The test checks
 * that the page is current.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, componentJsonSchema } from "../packages/scene/src/index";

const ROOT = join(import.meta.dir, "..");
export const COMPONENT_DOCS = join(ROOT, "docs/components.md");

type Schema = Readonly<Record<string, unknown>>;
const isSchema = (value: unknown): value is Schema =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The kind of a field schema in words. */
function kindOf(schema: Schema): string {
  if (Array.isArray(schema.enum)) return `one of ${schema.enum.map((item) => `\`${String(item)}\``).join(", ")}`;
  if (schema.const !== undefined) return `\`${JSON.stringify(schema.const)}\``;
  const options = Array.isArray(schema.anyOf) ? schema.anyOf.filter(isSchema) : [];
  if (options.length > 0) return [...new Set(options.map(kindOf))].join(" or ");
  if (schema.type === "array") return isSchema(schema.items) ? `a list of ${kindOf(schema.items)}` : "a list";
  if (schema.type === "object") return "an object";
  if (schema.type === "integer") return "a whole number";
  return typeof schema.type === "string" ? `a ${schema.type}` : "a value";
}

/** The anchor of a component section: the GitHub slug of its heading. */
export function componentAnchor(id: string): string {
  return id
    .toLowerCase()
    .replace(/[^a-z0-9 -]/g, "")
    .replace(/ /g, "-");
}

const cell = (text: string): string => text.replace(/\|/g, "\\|").replace(/\n/g, " ");

/** The text of the page. */
export function componentDocs(): string {
  const lines = [
    "# The built-in components",
    "",
    "The components of `@scenity/scene` with their fields. `bun tools/component-docs.ts` writes this page from the",
    "registry; the inspector links the card of each component to its section. The format of the documents is in",
    "[formats.md](formats.md).",
  ];
  const definitions = [...builtinRegistry().list()].sort((a, b) => a.id.localeCompare(b.id));
  for (const definition of definitions) {
    const json: Schema = componentJsonSchema(definition);
    const properties = isSchema(json.properties) ? json.properties : {};
    const where =
      definition.site === "component"
        ? "the components of an entity"
        : definition.site === "entity"
          ? "a field of the entity"
          : "a field of the scene";
    lines.push(
      "",
      `## ${definition.id}`,
      "",
      `${definition.editor.label}${definition.editor.group === undefined ? "" : ` (${definition.editor.group})`}: ${where}.`,
    );
    const names = Object.keys(properties);
    if (names.length === 0) continue;
    lines.push("", "| Field | Label | Value | Description |", "| --- | --- | --- | --- |");
    for (const name of names) {
      const field = properties[name];
      const schema = isSchema(field) ? field : {};
      const hint = definition.editor.fields[name];
      const description = typeof schema.description === "string" ? schema.description : "";
      lines.push(`| \`${name}\` | ${cell(hint?.label ?? "")} | ${cell(kindOf(schema))} | ${cell(description)} |`);
    }
  }
  return `${lines.join("\n")}\n`;
}

/** True when the page on the disk is the page of the current registry. */
export function componentDocsCurrent(): boolean {
  try {
    return readFileSync(COMPONENT_DOCS, "utf8") === componentDocs();
  } catch {
    return false;
  }
}

if (import.meta.main) {
  writeFileSync(COMPONENT_DOCS, componentDocs());
  console.log(`component-docs: wrote ${COMPONENT_DOCS}`);
}
