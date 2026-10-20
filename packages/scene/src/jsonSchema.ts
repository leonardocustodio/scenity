// SPDX-License-Identifier: Apache-2.0
/**
 * The JSON Schema export of the documents. `scripts/json-schema.ts` writes the files to `schema/<kind>.schema.json`.
 * A test checks that the files are current.
 *
 * - The sequence schema has no check of the key times against the duration: the reader does that check.
 * - The material schema has no check of the fields of each material type: the reader does that check.
 * - The stream schema is the schema of one line of a `*.stream.jsonl` file: the header or a sample. The reader checks
 *   the order of the samples.
 * - The editor schemas are the editor settings (`scenity.editor/1`), the key map (`scenity.keymap/1`) and the notes.
 * - The input schema is the input recording (`scenity.input/1`). The reader checks the time order of its events.
 */
import { z } from "zod";
import { builtinRegistry } from "./components/index";
import { canonicalJson } from "./canonical";
import type { DocumentKind } from "./migrations";
import { overridesSchema, prefabSchemaFor, sceneSchemaFor } from "./schema/documents";
import { editorSettingsSchema, keymapDocumentSchema } from "./schema/editor";
import { notesDocumentSchema } from "./schema/notes";
import { materialDocumentSchema } from "./schema/material";
import { projectSchema } from "./schema/project";
import { rulesDocumentSchema } from "./schema/rules";
import { sequenceSchema } from "./schema/sequence";
import { INPUT_FORMAT, inputRecordingSchema } from "./schema/input";
import { STREAM_FORMAT, streamLineSchema } from "./schema/stream";

const ID_BASE = "https://scenity.dev/schema/";

/** The JSON Schema of each document kind, with the built-in components in the scene and prefab schemas. */
export function documentJsonSchemas(): Record<DocumentKind, Record<string, unknown>> {
  const registry = builtinRegistry();
  const schemas = {
    project: projectSchema,
    scene: sceneSchemaFor(registry),
    prefab: prefabSchemaFor(registry),
    overrides: overridesSchema,
    sequence: sequenceSchema,
    material: materialDocumentSchema,
    rules: rulesDocumentSchema,
  };
  const out = {} as Record<DocumentKind, Record<string, unknown>>;
  for (const [kind, schema] of Object.entries(schemas) as [DocumentKind, z.ZodType][]) {
    const json = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
    out[kind] = { ...json, $id: `${ID_BASE}${kind}.schema.json`, title: `scenity.${kind}/1` };
  }
  return out;
}

/** The JSON Schema of one line of a recorded state stream: the header line or a sample line. */
export function streamJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(streamLineSchema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
  return { ...json, $id: `${ID_BASE}stream.schema.json`, title: `${STREAM_FORMAT} (one line)` };
}

/** The JSON Schema of an input recording. */
export function inputJsonSchema(): Record<string, unknown> {
  const json = z.toJSONSchema(inputRecordingSchema, { io: "input", target: "draft-2020-12" }) as Record<
    string,
    unknown
  >;
  return { ...json, $id: `${ID_BASE}input.schema.json`, title: INPUT_FORMAT };
}

/**
 * The JSON Schemas of the editor documents: the editor settings (`scenity.editor/1`), the key map
 * (`scenity.keymap/1`) and the notes (`scenity.notes/1`). They are not document kinds of the reader of scenes
 * (`readDocument`). The editor reads them with `readEditorDocument`, so a player build holds no part of them.
 */
export function editorJsonSchemas(): Record<"editor" | "keymap" | "notes", Record<string, unknown>> {
  // The note document of a scene is a file of the editor too. The player never reads it.
  const schemas = { editor: editorSettingsSchema, keymap: keymapDocumentSchema, notes: notesDocumentSchema };
  const out = {} as Record<"editor" | "keymap" | "notes", Record<string, unknown>>;
  for (const [kind, schema] of Object.entries(schemas) as ["editor" | "keymap" | "notes", z.ZodType][]) {
    const json = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
    out[kind] = { ...json, $id: `${ID_BASE}${kind}.schema.json`, title: `scenity.${kind}/1` };
  }
  return out;
}

/** The text of each schema file by its file name, in the form of the canonical writer. */
export function jsonSchemaFiles(): Record<string, string> {
  const schemas: Record<string, Record<string, unknown>> = {
    ...documentJsonSchemas(),
    stream: streamJsonSchema(),
    input: inputJsonSchema(),
    ...editorJsonSchemas(),
  };
  return Object.fromEntries(
    Object.entries(schemas).map(([kind, schema]) => [`${kind}.schema.json`, canonicalJson(schema)]),
  );
}
