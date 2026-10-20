// SPDX-License-Identifier: Apache-2.0
/**
 * The two Blender paths of the model importers. Both give a GLB (Y up, metres, PNG images).
 *
 * - The normalize path (`blender/import_drop.py`): the meshes with the modifiers and the transforms applied, the
 *   unit of the file (or the scale of the settings), the images at most `maxTextureSize` px. It keeps the origin of
 *   the source; the model steps then move it.
 * - The recipe path (`blender/import_fbx_prop.py`, then `blender/export.py`): the settings become the spec of the
 *   recipe (materials, bake, parts, sockets and the other recipe keys). The textures of the recipe go into a work
 *   folder, not beside the source.
 *
 * Each path works in a temporary folder and removes it after the run.
 */
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { blenderScript } from "../blender/run";
import type { ImportContext } from "./registry";
import { decimateSpecs, RECIPE_KEYS, type ModelImportSettings } from "./settings";

/** The GLB of a Blender path and the report of the script. */
export interface BlenderModel {
  readonly glb: Uint8Array;
  readonly report: Readonly<Record<string, unknown>>;
  readonly warnings: readonly string[];
}

function withWorkFolder<T>(task: (work: string) => T): T {
  const work = mkdtempSync(join(tmpdir(), "scenity-import-"));
  try {
    return task(work);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

/** Run the normalize path for a source file. */
export function normalizeThroughBlender(context: ImportContext<ModelImportSettings>): BlenderModel {
  const { settings, source } = context;
  return withWorkFolder((work) => {
    const out = join(work, "blender.glb");
    const report = join(work, "blender.json");
    // Blender opens a .blend file before the script; the script imports the other formats.
    const open = extname(source).toLowerCase() === ".blend" ? [source] : [];
    const scale = typeof settings.scale === "number" ? String(settings.scale) : "auto";
    context.blender(
      [
        ...open,
        "--python",
        blenderScript("import_drop.py"),
        "--",
        ...["--in", source, "--out", out, "--report", report],
        ...["--origin", "source", "--scale", scale, "--max-image", String(settings.maxTextureSize)],
      ],
      [dirname(source), work],
    );
    const made = JSON.parse(readFileSync(report, "utf8")) as Record<string, unknown>;
    const warnings = Array.isArray(made.warnings) ? made.warnings.map(String) : [];
    return { glb: readFileSync(out), report: made, warnings };
  });
}

/**
 * The spec of the recipe (`PropImportSpec` of `blender/propImportSpec.ts`) for the settings. The model is the
 * absolute path of the source; the other paths stay relative to the folder of the source (the argument `--root`).
 */
export function recipeSpec(settings: ModelImportSettings, source: string): Record<string, unknown> {
  const spec: Record<string, unknown> = { format: "fbx-prop", model: source, maxTextureSize: settings.maxTextureSize };
  for (const key of RECIPE_KEYS) {
    if (settings[key] !== undefined) spec[key] = settings[key];
  }
  const decimate = decimateSpecs(settings);
  if (decimate.length > 0) spec.decimate = decimate;
  if (Array.isArray(settings.origin)) spec.origin = settings.origin;
  if (typeof settings.scale === "number") spec.scale = settings.scale;
  return spec;
}

/** Run the recipe path for a source file: the master of the recipe, then its export. */
export function recipeThroughBlender(context: ImportContext<ModelImportSettings>): BlenderModel {
  const { settings, source, id } = context;
  return withWorkFolder((work) => {
    const master = join(work, "master.blend");
    const out = join(work, "blender.glb");
    const spec = JSON.stringify(recipeSpec(settings, source));
    const mounts = [dirname(source), work];
    context.blender(
      [
        "--python",
        blenderScript("import_fbx_prop.py"),
        "--",
        ...["--asset", id, "--spec", spec, "--out", master],
        ...["--root", dirname(source), "--textures", join(work, "textures")],
      ],
      mounts,
    );
    const exportArgs = ["--asset", id, "--kind", "model", "--out", out];
    context.blender([master, "--python", blenderScript("export.py"), "--", ...exportArgs], mounts);
    return { glb: readFileSync(out), report: { recipe: Object.keys(spec).sort() }, warnings: [] };
  });
}
