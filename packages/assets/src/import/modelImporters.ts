// SPDX-License-Identifier: Apache-2.0
/**
 * The model importers. glTF and GLB go direct: glTF Transform reads the file, and the model steps apply the
 * settings. FBX, OBJ and .blend go through the pinned Blender (`blenderPaths.ts`). A glTF file with recipe settings
 * also goes through Blender, and so does a glTF file that glTF Transform does not read (for example Draco).
 *
 * Each model importer writes `model.glb`: one self-contained GLB with the images of the source.
 */
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { Logger, type Document } from "@gltf-transform/core";
import { gltfIO } from "../build/optimize";
import { applyModelSteps, modelReport } from "./modelSteps";
import { normalizeThroughBlender, recipeThroughBlender, type BlenderModel } from "./blenderPaths";
import { defineImporter, type ImportContext, type Importer, type ImporterResult } from "./registry";
import { modelImportSettingsSchema, needsRecipe, type ModelImportSettings } from "./settings";

/** The name of the main file of a model import. */
export const MODEL_FILE = "model.glb";

/** The kinds of a glTF import: glTF keeps skins and animations. */
const GLTF_KINDS = ["model", "skinned-model", "animation"] as const;
/** The kinds of a Blender import: the normalize path and the recipe make static meshes. */
const BLENDER_KINDS = ["model"] as const;

type ModelPath = "direct" | "normalize" | "recipe";

async function readDirect(source: string, warnings: string[]): Promise<Document | null> {
  try {
    return await (await gltfIO()).read(source);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    warnings.push(`glTF Transform does not read the file (${message}): Blender converts it`);
    return null;
  }
}

async function runModel(context: ImportContext<ModelImportSettings>, direct: boolean): Promise<ImporterResult> {
  const io = await gltfIO();
  const warnings: string[] = [];
  let made: BlenderModel | null = null;
  let path: ModelPath = "direct";
  let document: Document | null = null;
  if (needsRecipe(context.settings)) {
    path = "recipe";
    made = recipeThroughBlender(context);
  } else if (direct) {
    document = await readDirect(context.source, warnings);
  }
  if (document === null && made === null) {
    path = "normalize";
    made = normalizeThroughBlender(context);
  }
  if (made !== null) {
    warnings.push(...made.warnings);
    document = await io.readBinary(made.glb);
  }
  if (document === null) throw new Error("the model import made no document");
  document.setLogger(new Logger(Logger.Verbosity.WARN));
  await applyModelSteps(document, context.settings, { scale: path === "direct", decimate: path !== "recipe" });
  writeFileSync(join(context.outDir, MODEL_FILE), await io.writeBinary(document));
  const report = { path, ...modelReport(document), ...(made === null ? {} : { blender: made.report }) };
  return { files: [MODEL_FILE], warnings, report };
}

function modelImporter(name: string, extensions: readonly string[], direct: boolean): Importer {
  return defineImporter({
    name,
    version: 1,
    extensions,
    kinds: direct ? GLTF_KINDS : BLENDER_KINDS,
    schema: modelImportSettingsSchema,
    run: (context) => runModel(context, direct),
  });
}

/** The built-in model importers: gltf, glb (direct), fbx, obj and blend (Blender). */
export function modelImporters(): Importer[] {
  return [
    modelImporter("gltf", [".gltf"], true),
    modelImporter("glb", [".glb"], true),
    modelImporter("fbx", [".fbx"], false),
    modelImporter("obj", [".obj"], false),
    modelImporter("blend", [".blend"], false),
  ];
}
