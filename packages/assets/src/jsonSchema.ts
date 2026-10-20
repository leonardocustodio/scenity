// SPDX-License-Identifier: Apache-2.0
/**
 * The JSON Schema export of the asset record, of the import settings and of the approval record.
 * `scripts/json-schema.ts` writes the files into the `schema` folder; a test checks that each file is current.
 */
import { canonicalJson } from "@scenity/scene";
import { z } from "zod";
import {
  audioImportSettingsSchema,
  environmentImportSettingsSchema,
  materialImportSettingsSchema,
  modelImportSettingsSchema,
  textureImportSettingsSchema,
} from "./import/settings";
import { ASSET_RECORD_FORMAT, assetRecordSchema } from "./record";
import type { ImporterRegistry } from "./import/registry";
import { APPROVAL_FORMAT, approvalRecordSchema } from "./release/approval";

/** The name of the schema file in the `schema` folder of the package. */
export const ASSET_SCHEMA_FILE = "asset.schema.json";
/** The name of the schema file of the approval record. */
export const APPROVAL_SCHEMA_FILE = "approval.schema.json";

function jsonSchemaOf(schema: z.ZodType, file: string, title: string): Record<string, unknown> {
  const json = z.toJSONSchema(schema, { io: "input", target: "draft-2020-12" }) as Record<string, unknown>;
  return { ...json, $id: `https://scenity.dev/schema/${file}`, title };
}

/** The JSON Schema of the asset record. */
export function assetRecordJsonSchema(): Record<string, unknown> {
  return jsonSchemaOf(assetRecordSchema, ASSET_SCHEMA_FILE, ASSET_RECORD_FORMAT);
}

/** The text of the schema file, in the form of the canonical writer. */
export function assetRecordJsonSchemaText(): string {
  return canonicalJson(assetRecordJsonSchema());
}

/** The schema files of the import settings: the file name, the title and the schema. */
const SETTINGS_SCHEMAS: readonly (readonly [string, string, z.ZodType])[] = [
  [
    "model-import.schema.json",
    "The settings of a model importer (gltf, glb, fbx, obj, blend)",
    modelImportSettingsSchema,
  ],
  [
    "texture-import.schema.json",
    "The settings of a texture importer (png, jpeg, webp, avif)",
    textureImportSettingsSchema,
  ],
  ["environment-import.schema.json", "The settings of an environment importer (hdr)", environmentImportSettingsSchema],
  ["audio-import.schema.json", "The settings of a sound importer (wav, ogg, mp3)", audioImportSettingsSchema],
  ["material-import.schema.json", "The settings of the material importer (material)", materialImportSettingsSchema],
];

/** Each schema file of the package: the file name and its text, in the form of the canonical writer. */
export function jsonSchemaFiles(): { readonly file: string; readonly text: string }[] {
  return [
    { file: ASSET_SCHEMA_FILE, text: assetRecordJsonSchemaText() },
    {
      file: APPROVAL_SCHEMA_FILE,
      text: canonicalJson(jsonSchemaOf(approvalRecordSchema, APPROVAL_SCHEMA_FILE, APPROVAL_FORMAT)),
    },
    ...SETTINGS_SCHEMAS.map(([file, title, schema]) => ({
      file,
      text: canonicalJson(jsonSchemaOf(schema, file, title)),
    })),
  ];
}

/** The settings form of an importer: its name, extensions and kinds, and the JSON Schema of its settings. */
export interface ImporterForm {
  readonly name: string;
  readonly extensions: readonly string[];
  readonly kinds: readonly string[];
  readonly schema: Record<string, unknown>;
}

/** The settings forms of the importers of a registry. The import dialog of the editor makes its form from them. */
export function importerForms(registry: ImporterRegistry): ImporterForm[] {
  return registry.list().map((importer) => ({
    name: importer.name,
    extensions: [...importer.extensions],
    kinds: [...importer.kinds],
    schema: z.toJSONSchema(importer.schema, { io: "input", target: "draft-2020-12" }),
  }));
}
