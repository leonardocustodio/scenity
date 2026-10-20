// SPDX-License-Identifier: Apache-2.0
/**
 * The en-US messages of the labels of the built-in components: the label of each component,
 * the name of each group and the label of each field, from the schemas of `@scenity/scene` and their editor hints
 * (`componentModel` of `@scenity/editor-core`). The editor shows these messages in the language of the page
 * (`apps/editor/src/scene/inspector/componentTexts.ts`). The translations are in the other locale folders.
 *
 * Run from the repo root:
 *     bun tools/component-texts.ts            # write apps/editor/src/i18n/en-US/components.ftl
 *     bun tools/component-texts.ts --check    # exit 1 when the file is not the same as the schemas
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { componentModel, type FieldModel } from "../packages/editor-core/src/index";
import { builtinRegistry } from "../packages/scene/src/index";
import { componentMessage, fieldMessage, groupMessage } from "../apps/editor/src/scene/inspector/componentTexts";

const ROOT = resolve(import.meta.dir, "..");
export const COMPONENT_TEXTS = join(ROOT, "apps/editor/src/i18n/en-US/components.ftl");

/** A Fluent value with no special characters at its start (a value cannot start with `[`, `*` or `.`). */
const value = (text: string): string => (/^[[*.{]/.test(text) ? `{ "${text.replace(/"/g, '\\"')}" }` : text);

function fieldLines(
  id: string,
  parent: readonly string[],
  fields: readonly FieldModel[],
  out: Map<string, string>,
): void {
  for (const field of fields) {
    if (field.key === "") continue;
    const path = [...parent, field.key];
    out.set(fieldMessage(id, path), field.label);
    if (field.group !== undefined) out.set(groupMessage(field.group), field.group);
    if (field.widget.kind === "object") fieldLines(id, path, field.widget.fields, out);
  }
}

/** The text of the file: one section for each component, in the order of the registry. */
export function componentTexts(): string {
  const groups = new Map<string, string>();
  const sections: string[] = [];
  for (const definition of builtinRegistry().list()) {
    const model = componentModel(definition);
    if (model.group !== undefined) groups.set(groupMessage(model.group), model.group);
    const lines = new Map<string, string>([[componentMessage(model.id), model.label]]);
    fieldLines(model.id, [], model.fields, lines);
    for (const [id, text] of [...lines]) if (id.startsWith("component-group-")) groups.set(id, text);
    const own = [...lines].filter(([id]) => !id.startsWith("component-group-"));
    sections.push(`## ${model.id}\n\n${own.map(([id, text]) => `${id} = ${value(text)}`).join("\n")}`);
  }
  const groupLines = [...groups].map(([id, text]) => `${id} = ${value(text)}`).join("\n");
  return [
    "# SPDX-License-Identifier: Apache-2.0",
    "",
    "### The labels of the built-in components, their groups and their fields. Do not edit:",
    "### `bun tools/component-texts.ts` writes this file from the schemas of @scenity/scene.",
    "",
    "## The groups",
    "",
    groupLines,
    "",
    ...sections.flatMap((section) => [section, ""]),
  ].join("\n");
}

if (import.meta.main) {
  const text = componentTexts();
  if (process.argv.includes("--check")) {
    const now = readFileSync(COMPONENT_TEXTS, "utf8");
    if (now !== text) {
      console.log("component-texts: components.ftl is not the same as the schemas; run bun tools/component-texts.ts");
      process.exit(1);
    }
    console.log("component-texts: up to date");
  } else {
    writeFileSync(COMPONENT_TEXTS, text);
    console.log(`component-texts: ${String(text.split("\n").filter((line) => line.includes(" = ")).length)} messages`);
  }
}
