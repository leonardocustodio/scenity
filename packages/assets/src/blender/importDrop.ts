// SPDX-License-Identifier: Apache-2.0
/**
 * The import of a dropped file as a prop: the asset build of a prop for one file, outside the committed assets. The
 * workbench host runs it as a run of the Runs tab (the import job of a host plugin, `paths.importJob`). It writes into
 * `<state>/imports/<id>/`.
 *
 * 1. Normalize: an FBX, OBJ or Blender file goes through headless Blender 5.2. `import_drop.py` gives the meshes with
 *    the modifiers and the transforms applied, metres, the origin at the centre of the base, PNG images, and Y up. A
 *    glTF file goes directly to the next step when the build can read it (PNG or KTX2 textures, no Draco). Else it
 *    also goes through Blender. The glTF Transform `center` step puts the base centre at the origin.
 * 2. Simplify a model above the high triangle budget to 95 % of the budget (with a warning).
 * 3. Optimize as the build does (optimize.ts): the high and the low tier, KTX2 textures, meshopt compression.
 * 4. Check: the glTF validator on the plain high tier, and the triangle, byte and texture budgets of each tier. The
 *    caller gives the budgets (ImportOptions.budgets).
 *
 * The files: `normalized.glb` (the input of the build), `model.high.glb`, `model.low.glb` and `preview.glb` (the plain
 * high tier: PNG textures, no meshopt, so the lab page reads it with the plain GLTFLoader).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import type { Document } from "@gltf-transform/core";
import { center, getBounds, simplify, weld } from "@gltf-transform/functions";
import { validateBytes } from "gltf-validator";
import { MeshoptSimplifier } from "meshoptimizer";
import type { TierBudget } from "../build/checks";
import { gltfIO, modelStats, optimizeModel } from "../build/optimize";
import { HIGH_LOD, LOW_LOD, type ModelTier } from "../build/settings";
import { blenderScript, runBlender } from "./run";

/** The file types of a drop. */
export const DROP_FORMATS = [".glb", ".gltf", ".fbx", ".obj", ".blend"] as const;
export type DropFormat = (typeof DROP_FORMATS)[number];

/** The format of a file name, or null for a type that the import does not read. */
export function dropFormat(name: string): DropFormat | null {
  const ext = extname(name).toLowerCase();
  return (DROP_FORMATS as readonly string[]).includes(ext) ? (ext as DropFormat) : null;
}

/** The texture types that the build reads (optimize.ts encodes PNG; KTX2 stays). */
const BUILD_TEXTURES = new Set(["image/png", "image/ktx2"]);

/** The report of import_drop.py. */
export interface BlenderReport {
  readonly meshes: number;
  readonly triangles: number;
  /** The size in metres: x, the height, the depth. */
  readonly extent: readonly [number, number, number];
  readonly scale: number;
  readonly images: number;
  readonly warnings: readonly string[];
  readonly blender: string;
}

/** One tier of the result against its budget. */
export interface TierReport {
  readonly file: string;
  readonly bytes: number;
  readonly triangles: number;
  readonly maxTextureSize: number;
  readonly budget: { readonly triangles: number; readonly bytes: number; readonly maxTextureSize: number };
  readonly pass: boolean;
}

export interface ImportResult {
  readonly format: DropFormat;
  /** The report of Blender, or null for a glTF file that did not go through Blender. */
  readonly blender: BlenderReport | null;
  /** The triangles before and after the simplify step, or null when the model was in the budget. */
  readonly simplified: { readonly from: number; readonly to: number } | null;
  /** The size of the normalized model in metres: x, the height, the depth. */
  readonly extent: readonly [number, number, number];
  readonly tiers: Readonly<Record<ModelTier, TierReport>>;
  readonly preview: string;
  readonly validator: { readonly errors: readonly string[]; readonly warnings: number };
  readonly warnings: readonly string[];
  /** Every tier in its budget and no validator error. */
  readonly pass: boolean;
}

export interface ImportOptions {
  /** The dropped file (absolute path). A glTF file reads its other files next to it. */
  readonly input: string;
  /** The output folder (absolute path), for example `<state>/imports/<id>`. */
  readonly outDir: string;
  /** The budgets of each tier (the project gives them, for example the prop budget of its manifest). */
  readonly budgets: Readonly<Record<ModelTier, Required<TierBudget>>>;
  /** The generator string of the built files (default: GENERATOR of optimize.ts). */
  readonly generator?: string;
  /** Run Blender (a test can give another); default: runBlender of run.ts. */
  readonly blender?: (args: readonly string[], mounts: readonly string[]) => void;
}

/** True when the build reads the glTF file as it is: every texture PNG or KTX2. */
function buildReads(document: Document): boolean {
  return document
    .getRoot()
    .listTextures()
    .every((texture) => BUILD_TEXTURES.has(texture.getMimeType()));
}

/** Read a glTF file for the build, or null when Blender must convert it first (other textures, Draco, …). */
async function readGltf(input: string): Promise<Document | null> {
  try {
    const document = await (await gltfIO()).read(input);
    return buildReads(document) ? document : null;
  } catch {
    return null;
  }
}

/** Normalize the dropped file through Blender; give the GLB bytes and the report. */
function throughBlender(options: ImportOptions, format: DropFormat): { glb: Uint8Array; report: BlenderReport } {
  const run = options.blender ?? runBlender;
  const out = join(options.outDir, "blender.glb");
  const report = join(options.outDir, "blender.json");
  // Blender opens a .blend file before the script. The script imports the other formats.
  const open = format === ".blend" ? [options.input] : [];
  const script = blenderScript("import_drop.py");
  run(
    [...open, "--python", script, "--", "--in", options.input, "--out", out, "--report", report],
    [dirname(options.input), options.outDir],
  );
  return { glb: readFileSync(out), report: JSON.parse(readFileSync(report, "utf8")) as BlenderReport };
}

/** Simplify a model above the high triangle budget to 95 % of the budget. */
async function fitBudget(document: Document, budget: number): Promise<{ from: number; to: number } | null> {
  const from = modelStats(document).triangles;
  if (from <= budget) return null;
  await document.transform(
    weld(),
    simplify({ simplifier: MeshoptSimplifier, ratio: (budget * 0.95) / from, error: 0.01, lockBorder: false }),
  );
  return { from, to: modelStats(document).triangles };
}

function tierReport(
  file: string,
  bytes: number,
  stats: ReturnType<typeof modelStats>,
  budget: Required<TierBudget>,
): TierReport {
  const pass =
    stats.triangles <= budget.triangles && bytes <= budget.bytes && stats.maxTextureSize <= budget.maxTextureSize;
  return { file, bytes, triangles: stats.triangles, maxTextureSize: stats.maxTextureSize, budget, pass };
}

async function validate(bytes: Uint8Array): Promise<{ errors: string[]; warnings: number }> {
  const report = (await validateBytes(bytes, { maxIssues: 50 })) as {
    issues: { numWarnings: number; messages: { code: string; message: string; severity: number }[] };
  };
  const errors = report.issues.messages
    .filter((issue) => issue.severity === 0)
    .map((issue) => `${issue.code}: ${issue.message}`);
  return { errors, warnings: report.issues.numWarnings };
}

/** The size of the model in metres (x, the height, the depth). */
function extentOf(document: Document): [number, number, number] {
  const scene = document.getRoot().getDefaultScene() ?? document.getRoot().listScenes()[0];
  if (scene === undefined) return [0, 0, 0];
  const { min, max } = getBounds(scene);
  const size = (axis: 0 | 1 | 2): number => Math.round((max[axis] - min[axis]) * 10_000) / 10_000;
  return [size(0), size(1), size(2)];
}

/** Import a dropped file into `outDir` (see the module comment). Throws for a format that the import does not read. */
export async function importDrop(options: ImportOptions): Promise<ImportResult> {
  const format = dropFormat(options.input);
  if (format === null) throw new Error(`${basename(options.input)}: the import reads ${DROP_FORMATS.join(", ")}`);
  mkdirSync(options.outDir, { recursive: true });
  const io = await gltfIO();
  const warnings: string[] = [];
  let blender: BlenderReport | null = null;
  let document = format === ".glb" || format === ".gltf" ? await readGltf(options.input) : null;
  if (document === null) {
    const made = throughBlender(options, format);
    blender = made.report;
    warnings.push(...made.report.warnings);
    document = await io.readBinary(made.glb);
  }
  await document.transform(center({ pivot: "below" }));
  const simplified = await fitBudget(document, options.budgets.high.triangles);
  if (simplified !== null) {
    warnings.push(`simplified from ${String(simplified.from)} to ${String(simplified.to)} triangles (prop budget)`);
  }
  const normalized = await io.writeBinary(document);
  writeFileSync(join(options.outDir, "normalized.glb"), normalized);
  const settings = options.generator === undefined ? {} : { generator: options.generator };
  const high = await optimizeModel(normalized, HIGH_LOD, settings);
  const low = await optimizeModel(normalized, LOW_LOD, { ...settings, triangles: options.budgets.low.triangles });
  writeFileSync(join(options.outDir, "model.high.glb"), high.glb);
  writeFileSync(join(options.outDir, "model.low.glb"), low.glb);
  writeFileSync(join(options.outDir, "preview.glb"), high.plain);
  const tiers = {
    high: tierReport("model.high.glb", high.glb.byteLength, high.stats, options.budgets.high),
    low: tierReport("model.low.glb", low.glb.byteLength, low.stats, options.budgets.low),
  };
  const validator = await validate(high.plain);
  const pass = tiers.high.pass && tiers.low.pass && validator.errors.length === 0;
  return {
    format,
    blender,
    simplified,
    extent: extentOf(document),
    tiers,
    preview: "preview.glb",
    validator,
    warnings,
    pass,
  };
}
