// SPDX-License-Identifier: Apache-2.0
/**
 * The material importer: a material document `*.material.json` of `@scenity/scene` (`scenity.material/1`).
 * An import reads the document with the reader of the documents and writes it again with the canonical writer into
 * the output folder. A bad document fails the import with the JSON Pointer of each error. The report has the type of
 * the material and its texture references; the build checks that each texture reference names a texture asset
 * (build/material.ts).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { formatErrors, materialTextureRefs, readDocument, writeDocument, type MaterialDocument } from "@scenity/scene";
import { defineImporter, type Importer } from "./registry";
import { materialImportSettingsSchema } from "./settings";

/** The name of the main file of a material import. */
export const MATERIAL_FILE = "material.json";

/** The suffix of a material document. */
export const MATERIAL_SUFFIX = ".material.json";

/** The material document in a text, or an error with the JSON Pointer of each problem. */
export function readMaterial(text: string, name: string): MaterialDocument {
  const read = readDocument(text, "material");
  if (!read.ok) throw new Error(`${name}: ${formatErrors(read.errors).replaceAll("\n", "; ")}`);
  return read.doc;
}

/** The built-in material importer. */
export function materialImporter(): Importer {
  return defineImporter({
    name: "material",
    version: 1,
    extensions: [MATERIAL_SUFFIX],
    kinds: ["material"],
    schema: materialImportSettingsSchema,
    run: (context) => {
      const doc = readMaterial(readFileSync(context.source, "utf8"), basename(context.source));
      writeFileSync(join(context.outDir, MATERIAL_FILE), writeDocument(doc));
      const report = { type: doc.type, textures: materialTextureRefs(doc) };
      return Promise.resolve({ files: [MATERIAL_FILE], warnings: [], report });
    },
  });
}
