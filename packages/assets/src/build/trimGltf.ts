// SPDX-License-Identifier: Apache-2.0
/**
 * Make a GLTFLoader of three.js with only the glTF extensions that the built assets use. The script has two
 * configurations (TRIMS):
 *
 * - `room` (the default): the loader of the 3D room and its render workers, with the four extensions below.
 * - `generic`: the loader of the generic scene worker. It keeps the lights, the physical materials, unlit,
 *   WebP, AVIF, GPU instancing and Draco (GENERIC_GLTF_EXTENSIONS). It is a separate file, so the room loader and the
 *   room workers do not grow.
 *
 * The constructor of the stock GLTFLoader registers 18 extension plugins, and its parser makes the Draco and the unlit
 * extensions itself. Thus the bundler keeps all extension classes, and the material extensions keep
 * MeshPhysicalMaterial.
 * The built assets use four extensions only (GLTF_EXTENSIONS). This script writes a copy of GLTFLoader.js without the
 * other extension classes and their registrations:
 *
 * - it removes the plugins of the material extensions, the lights, GPU instancing, WebP, AVIF and KHR_meshopt;
 * - it removes the Draco and the unlit extensions from the parser;
 * - the parser gives an error for an extension in `extensionsUsed` that it cannot read. The stock loader ignores such
 *   an extension, and that gives a wrong frame. The asset check (checks.ts) stops such a file before the build.
 *   The data extensions (GLTF_DATA_EXTENSIONS) are not errors: both loaders keep their data in `userData`.
 *
 * The other code of the loader does not change, so a material of an asset is the same MeshStandardMaterial.
 *
 *   bun packages/assets/src/build/trimGltf.ts <target>           write the copy (the repo: packages/render/src/vendor/GLTFLoader.js)
 *   bun packages/assets/src/build/trimGltf.ts <target> --check   fail when the copy is not current (CI; a three.js update)
 *   bun packages/assets/src/build/trimGltf.ts <target> --loader generic [--check]
 *                                                     the generic copy (the repo: packages/render/src/vendor/GLTFLoaderGeneric.js)
 *
 * The package of the target resolves three.js, so the copy comes from the three.js version of that package.
 *
 * A part to remove or replace that is not in the source (a three.js update) stops the script. Then read the new source
 * and change the lists of this script.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";

/** The source file of three.js that the package of `target` resolves (the package of the copy has three.js). */
export function sourceOf(target: string): string {
  return createRequire(resolve(target)).resolve("three/examples/jsm/loaders/GLTFLoader.js");
}

/** The glTF extensions of the built assets: the trimmed loader has code for these and no other. */
export const GLTF_EXTENSIONS: readonly string[] = [
  "EXT_meshopt_compression",
  "KHR_mesh_quantization",
  "KHR_texture_basisu",
  "KHR_texture_transform",
];

/**
 * The glTF extensions with data only. The stock loader has no code for them: it keeps their data in `userData`, and the
 * trimmed loader does the same. KHR_materials_variants holds the material variants of a model (for example skin
 * variants). The asset build accepts them (checks.ts).
 */
export const GLTF_DATA_EXTENSIONS: readonly string[] = ["KHR_materials_variants"];

/** The extension classes that the trimmed loader keeps. The script removes all other classes with "Extension". */
const KEPT_CLASSES: ReadonlySet<string> = new Set([
  "GLTFTextureBasisUExtension",
  "GLTFMeshoptCompression",
  "GLTFBinaryExtension",
  "GLTFTextureTransformExtension",
  "GLTFMeshQuantizationExtension",
]);

/** The classes to remove: the extensions that the assets do not use. */
const REMOVED_CLASSES: readonly string[] = [
  "GLTFLightsExtension",
  "GLTFMaterialsUnlitExtension",
  "GLTFMaterialsEmissiveStrengthExtension",
  "GLTFMaterialsClearcoatExtension",
  "GLTFMaterialsDispersionExtension",
  "GLTFMaterialsIridescenceExtension",
  "GLTFMaterialsSheenExtension",
  "GLTFMaterialsTransmissionExtension",
  "GLTFMaterialsVolumeExtension",
  "GLTFMaterialsIorExtension",
  "GLTFMaterialsSpecularExtension",
  "GLTFMaterialsBumpExtension",
  "GLTFMaterialsAnisotropyExtension",
  "GLTFTextureWebPExtension",
  "GLTFTextureAVIFExtension",
  "GLTFMeshGpuInstancing",
  "GLTFDracoMeshCompressionExtension",
];

/** The top-level functions to remove: only the removed classes use them. */
const REMOVED_FUNCTIONS: readonly string[] = ["getMaterialExtension"];

/** The registrations that stay: the class and the extension argument. */
const KEPT_REGISTRATIONS: ReadonlySet<string> = new Set([
  "GLTFTextureBasisUExtension",
  "GLTFMeshoptCompression EXT_MESHOPT_COMPRESSION",
]);
const REGISTRATIONS = 18;

/**
 * The glTF extensions of the generic loader: the extensions of the room loader, the lights, the physical materials,
 * unlit, WebP, AVIF, GPU instancing and Draco. A project with no plugin builds and loads with this list.
 * KHR_materials_dispersion and EXT_materials_bump are not in the list.
 */
export const GENERIC_GLTF_EXTENSIONS: readonly string[] = [
  ...GLTF_EXTENSIONS,
  "KHR_meshopt_compression",
  "KHR_lights_punctual",
  "KHR_materials_anisotropy",
  "KHR_materials_clearcoat",
  "KHR_materials_emissive_strength",
  "KHR_materials_ior",
  "KHR_materials_iridescence",
  "KHR_materials_sheen",
  "KHR_materials_specular",
  "KHR_materials_transmission",
  "KHR_materials_unlit",
  "KHR_materials_volume",
  "EXT_texture_webp",
  "EXT_texture_avif",
  "EXT_mesh_gpu_instancing",
  "KHR_draco_mesh_compression",
];

/** The classes that the generic loader removes: the extensions that are not in GENERIC_GLTF_EXTENSIONS. */
const GENERIC_REMOVED_CLASSES: readonly string[] = ["GLTFMaterialsDispersionExtension", "GLTFMaterialsBumpExtension"];

/** The extension classes that the generic loader keeps. */
const GENERIC_KEPT_CLASSES: ReadonlySet<string> = new Set([
  ...KEPT_CLASSES,
  ...REMOVED_CLASSES.filter((name) => !GENERIC_REMOVED_CLASSES.includes(name)),
]);

/** The registrations that the generic loader keeps. */
const GENERIC_KEPT_REGISTRATIONS: ReadonlySet<string> = new Set([
  "GLTFMaterialsClearcoatExtension",
  "GLTFTextureBasisUExtension",
  "GLTFTextureWebPExtension",
  "GLTFTextureAVIFExtension",
  "GLTFMaterialsSheenExtension",
  "GLTFMaterialsTransmissionExtension",
  "GLTFMaterialsVolumeExtension",
  "GLTFMaterialsIorExtension",
  "GLTFMaterialsEmissiveStrengthExtension",
  "GLTFMaterialsSpecularExtension",
  "GLTFMaterialsIridescenceExtension",
  "GLTFMaterialsAnisotropyExtension",
  "GLTFLightsExtension",
  "GLTFMeshoptCompression EXT_MESHOPT_COMPRESSION",
  "GLTFMeshoptCompression KHR_MESHOPT_COMPRESSION",
  "GLTFMeshGpuInstancing",
]);

interface Patch {
  readonly name: string;
  readonly find: string;
  readonly replace: string;
}

/** The parser code for an extension that no plugin reads: a warning in three.js, an error in a trimmed loader. */
const UNKNOWN_EXTENSION = [
  "\t\t\t\t\tdefault:\n\n",
  "\t\t\t\t\t\tif ( extensionsRequired.indexOf( extensionName ) >= 0 && plugins[ extensionName ] === undefined ) {\n\n",
  "\t\t\t\t\t\t\tconsole.warn( 'THREE.GLTFLoader: Unknown extension \"' + extensionName + '\".' );\n\n",
  "\t\t\t\t\t\t}\n",
].join("");

/** The replacement of UNKNOWN_EXTENSION: an error for an extension with no plugin and no data only. */
function unknownExtension(comment: string, message: string): string {
  return [
    "\t\t\t\t\tdefault:\n\n",
    `\t\t\t\t\t\t// ${comment}\n`,
    `\t\t\t\t\t\tif ( plugins[ extensionName ] === undefined && ${JSON.stringify(GLTF_DATA_EXTENSIONS).replaceAll('"', "'")}.indexOf( extensionName ) < 0 ) {\n\n`,
    `\t\t\t\t\t\t\tif ( onError ) onError( new Error( 'THREE.GLTFLoader: ${message} "' + extensionName + '".' ) );\n`,
    "\t\t\t\t\t\t\treturn;\n\n",
    "\t\t\t\t\t\t}\n",
  ].join("");
}

/** The imports of the utilities: the copy is not in the folder of three.js. */
const IMPORT_PATCHES: readonly Patch[] = [
  {
    name: "BufferGeometryUtils import",
    find: "from '../utils/BufferGeometryUtils.js';",
    replace: "from 'three/examples/jsm/utils/BufferGeometryUtils.js';",
  },
  {
    name: "SkeletonUtils import",
    find: "from '../utils/SkeletonUtils.js';",
    replace: "from 'three/examples/jsm/utils/SkeletonUtils.js';",
  },
];

/** The patches of the room loader. */
const PATCHES: readonly Patch[] = [
  {
    name: "parser extensions",
    find: [
      "\t\t\t\t\tcase EXTENSIONS.KHR_MATERIALS_UNLIT:\n",
      "\t\t\t\t\t\textensions[ extensionName ] = new GLTFMaterialsUnlitExtension();\n",
      "\t\t\t\t\t\tbreak;\n\n",
      "\t\t\t\t\tcase EXTENSIONS.KHR_DRACO_MESH_COMPRESSION:\n",
      "\t\t\t\t\t\textensions[ extensionName ] = new GLTFDracoMeshCompressionExtension( json, this.dracoLoader );\n",
      "\t\t\t\t\t\tbreak;\n\n",
    ].join(""),
    replace: "",
  },
  {
    name: "unknown extension",
    find: UNKNOWN_EXTENSION,
    replace: unknownExtension(
      "The 3D room reads its extensions only: another extension is an error, not a wrong frame.",
      "the 3D room does not read the extension",
    ),
  },
  {
    name: "unlit material",
    find: [
      "\t\tif ( materialExtensions[ EXTENSIONS.KHR_MATERIALS_UNLIT ] ) {\n\n",
      "\t\t\tconst kmuExtension = extensions[ EXTENSIONS.KHR_MATERIALS_UNLIT ];\n",
      "\t\t\tmaterialType = kmuExtension.getMaterialType();\n",
      "\t\t\tpending.push( kmuExtension.extendParams( materialParams, materialDef, parser ) );\n\n",
      "\t\t} else {\n",
    ].join(""),
    replace: "\t\t{ // The trimmed loader has no KHR_materials_unlit.\n",
  },
  {
    name: "Draco primitive",
    find: [
      "\t\tfunction createDracoPrimitive( primitive ) {\n\n",
      "\t\t\treturn extensions[ EXTENSIONS.KHR_DRACO_MESH_COMPRESSION ]\n",
      "\t\t\t\t.decodePrimitive( primitive, parser )\n",
      "\t\t\t\t.then( function ( geometry ) {\n\n",
      "\t\t\t\t\treturn addPrimitiveAttributes( geometry, primitive, parser );\n\n",
      "\t\t\t\t} );\n\n",
      "\t\t}\n\n",
    ].join(""),
    replace: "",
  },
  {
    name: "Draco geometry",
    find: [
      "\t\t\t\tif ( primitive.extensions && primitive.extensions[ EXTENSIONS.KHR_DRACO_MESH_COMPRESSION ] ) {\n\n",
      "\t\t\t\t\t// Use DRACO geometry if available\n",
      "\t\t\t\t\tgeometryPromise = createDracoPrimitive( primitive );\n\n",
      "\t\t\t\t} else {\n\n",
      "\t\t\t\t\t// Otherwise create a new geometry\n",
      "\t\t\t\t\tgeometryPromise = addPrimitiveAttributes( new BufferGeometry(), primitive, parser );\n\n",
      "\t\t\t\t}\n",
    ].join(""),
    replace: [
      "\t\t\t\t// The trimmed loader has no KHR_draco_mesh_compression.\n",
      "\t\t\t\tgeometryPromise = addPrimitiveAttributes( new BufferGeometry(), primitive, parser );\n",
    ].join(""),
  },
  ...IMPORT_PATCHES,
];

const HEADER = `// Generated by packages/assets/src/build/trimGltf.ts from three/examples/jsm/loaders/GLTFLoader.js (three.js, MIT).
// Do not edit. The loader reads only the glTF extensions of the 3D room assets: ${GLTF_EXTENSIONS.join(", ")}
// and keeps the data of ${GLTF_DATA_EXTENSIONS.join(", ")} in userData. Another extension
// in extensionsUsed is an error.
/* eslint-disable */
`;

/** Comment lines of at most 120 characters with the words of a list. */
function commentLines(words: readonly string[]): string {
  const lines: string[] = [];
  for (const word of words) {
    const last = lines.at(-1);
    if (last !== undefined && last.length + word.length < 116) lines[lines.length - 1] = `${last} ${word}`;
    else lines.push(`// ${word}`);
  }
  return lines.join("\n");
}

const GENERIC_HEADER = `// Generated by packages/assets/src/build/trimGltf.ts --loader generic from three/examples/jsm/loaders/GLTFLoader.js
// (three.js, MIT). Do not edit. The generic loader reads only these glTF extensions:
${commentLines(GENERIC_GLTF_EXTENSIONS.map((name) => `${name},`))}
// and keeps the data of ${GLTF_DATA_EXTENSIONS.join(", ")} in userData. Another extension in extensionsUsed is an error.
/* eslint-disable */
`;

/** One configuration of the trimmed loader: what it keeps, what it removes and the patches. */
export interface LoaderTrim {
  readonly name: string;
  readonly header: string;
  readonly keptClasses: ReadonlySet<string>;
  readonly removedClasses: readonly string[];
  readonly removedFunctions: readonly string[];
  readonly keptRegistrations: ReadonlySet<string>;
  readonly patches: readonly Patch[];
  /** Names that must not be in the output. */
  readonly gone: readonly string[];
}

/** The configurations: `room` for the 3D room and its workers, `generic` for the generic scene worker. */
export const TRIMS: Readonly<Record<"room" | "generic", LoaderTrim>> = {
  room: {
    name: "room",
    header: HEADER,
    keptClasses: KEPT_CLASSES,
    removedClasses: REMOVED_CLASSES,
    removedFunctions: REMOVED_FUNCTIONS,
    keptRegistrations: KEPT_REGISTRATIONS,
    patches: PATCHES,
    gone: [...REMOVED_CLASSES, ...REMOVED_FUNCTIONS, "MeshPhysicalMaterial"],
  },
  generic: {
    name: "generic",
    header: GENERIC_HEADER,
    keptClasses: GENERIC_KEPT_CLASSES,
    removedClasses: GENERIC_REMOVED_CLASSES,
    removedFunctions: [],
    keptRegistrations: GENERIC_KEPT_REGISTRATIONS,
    patches: [
      {
        name: "unknown extension",
        find: UNKNOWN_EXTENSION,
        replace: unknownExtension(
          "The generic loader reads its extensions only: another extension is an error, not a wrong frame.",
          "the generic loader does not read the extension",
        ),
      },
      ...IMPORT_PATCHES,
    ],
    gone: GENERIC_REMOVED_CLASSES,
  },
};

function replaceOnce(text: string, name: string, find: string, replace: string): string {
  const count = text.split(find).length - 1;
  if (count !== 1) throw new Error(`trim-gltf: ${name} found ${String(count)} times (expected 1)`);
  return text.replace(find, () => replace);
}

/** Remove the registrations of the plugins that the assets do not use. */
function trimRegistrations(text: string, kept: ReadonlySet<string>): string {
  const registration =
    /\t\tthis\.register\( function \( parser \) \{\n\n\t\t\treturn new (\w+)\( parser(?:, EXTENSIONS\.(\w+))? \);\n\n\t\t\} \);\n\n/g;
  let found = 0;
  const out = text.replace(registration, (whole, name: string, extension: string | undefined) => {
    found += 1;
    return kept.has(extension === undefined ? name : `${name} ${extension}`) ? whole : "";
  });
  if (found !== REGISTRATIONS) {
    throw new Error(`trim-gltf: ${String(found)} plugin registrations (expected ${String(REGISTRATIONS)})`);
  }
  return out;
}

/** Remove a top-level declaration with the JSDoc comment before it and the blank lines after it. */
function removeDeclaration(text: string, head: string): string {
  const at = text.indexOf(`\n${head}`);
  if (at < 0 || text.slice(at + 1).includes(`\n${head}`)) {
    throw new Error(`trim-gltf: "${head}" is not in the source once`);
  }
  let start = at + 1;
  if (text.slice(0, at).endsWith(" */")) start = text.lastIndexOf("\n/**", at) + 1;
  const close = text.indexOf("\n}\n", at);
  if (close < 0) throw new Error(`trim-gltf: no end of "${head}"`);
  let end = close + 3;
  while (text[end] === "\n") end += 1;
  return text.slice(0, start) + text.slice(end);
}

/** Remove the names of the import from 'three' that the trimmed code does not use (MeshPhysicalMaterial, lights). */
function trimThreeImports(text: string): string {
  const block = /^import \{\n([^}]*)\} from 'three';\n/m.exec(text);
  if (block === null) throw new Error("trim-gltf: no import from 'three'");
  const body = text.slice(block.index + block[0].length);
  const names = block[1]
    ?.split(",")
    .map((name) => name.trim())
    .filter((name) => name.length > 0 && new RegExp(`\\b${name}\\b`).test(body));
  const kept = `import {\n${(names ?? []).map((name) => `\t${name}`).join(",\n")}\n} from 'three';\n`;
  return text.slice(0, block.index) + kept + body;
}

/** The trimmed loader source of a configuration. Throws when a part to remove or replace is not in the source. */
export function trimmedGltfLoader(source: string, trim: LoaderTrim = TRIMS.room): string {
  let text = trimRegistrations(source, trim.keptRegistrations);
  for (const patch of trim.patches) text = replaceOnce(text, patch.name, patch.find, patch.replace);
  for (const name of trim.removedClasses) text = removeDeclaration(text, `class ${name} {`);
  for (const name of trim.removedFunctions) text = removeDeclaration(text, `function ${name}(`);
  text = trimThreeImports(text);
  for (const name of trim.gone) {
    if (new RegExp(`\\b${name}\\b`).test(text)) throw new Error(`trim-gltf: the trimmed loader still has ${name}`);
  }
  const classes = [...text.matchAll(/^class (\w*Extension\w*|GLTFMesh\w*) /gm)].map((match) => match[1] ?? "");
  const unknown = classes.filter((name) => !trim.keptClasses.has(name));
  if (unknown.length > 0) throw new Error(`trim-gltf: extension classes not in the lists: ${unknown.join(", ")}`);
  return trim.header + text;
}

/**
 * Write the copy of a configuration at `target`, or with `check` only compare it. Returns false when the check finds
 * an old copy.
 */
export function writeCopy(target: string, check: boolean, trim: LoaderTrim = TRIMS.room): boolean {
  const wanted = trimmedGltfLoader(readFileSync(sourceOf(target), "utf8"), trim);
  if (check) {
    let current = "";
    try {
      current = readFileSync(target, "utf8");
    } catch {
      // A missing file is not current.
    }
    if (current === wanted) return true;
    const option = trim === TRIMS.room ? "" : ` --loader ${trim.name}`;
    console.error(`${target} is not current. Run: bun packages/assets/src/build/trimGltf.ts ${target}${option}`);
    return false;
  }
  writeFileSync(target, wanted);
  console.log(`trim-gltf: wrote ${target}`);
  return true;
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const at = args.indexOf("--loader");
  const name = at < 0 ? "room" : args[at + 1];
  const target = args.find((arg, index) => !arg.startsWith("--") && (at < 0 || index !== at + 1));
  if (target === undefined || (name !== "room" && name !== "generic")) {
    console.error("usage: bun packages/assets/src/build/trimGltf.ts <target file> [--loader room|generic] [--check]");
    process.exit(2);
  }
  if (!writeCopy(target, args.includes("--check"), TRIMS[name])) process.exit(1);
}
