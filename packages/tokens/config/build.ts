// SPDX-License-Identifier: Apache-2.0
/**
 * The Style Dictionary 5 build of the Scenity tokens.
 *
 * Style Dictionary reads the DTCG 2025.10 sources of each theme variant, resolves the references and
 * changes each value into CSS text (transform "sc/css"). The formats of config/formats.ts then write one
 * file per output for all variants into dist/. Run it with `bun run build` in this package.
 *
 * A token set is the engine sources and, for a project, the sources of a plugin (a folder under plugins/).
 * The plugin sources can refer to the engine tokens. The build of a plugin set writes
 * only the plugin tokens into tokens.css and tailwind.css, because the app loads the engine files too.
 *
 * The build supports this DTCG subset: the types of config/values.ts, srgb colors with a hex fallback, dimensions in
 * px or rem, durations in ms or s, and references in curly braces. The build does not support $root, $extends,
 * $deprecated, JSON pointer references and resolver files, because Style Dictionary 5.5.5 does not read them.
 */

import { existsSync } from "node:fs";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import StyleDictionary from "style-dictionary";
import type { TransformedToken } from "style-dictionary/types";
import {
  checkContrast,
  checkDistinct,
  CONTRAST_PAIRS,
  DISTINCT_PAIRS,
  type ContrastPair,
  type DistinctPair,
} from "../src/checks";
import {
  formatCss,
  formatReference,
  formatTailwind,
  formatTypeScript,
  type BuildModel,
  type Tier,
  type TokenRecord,
} from "./formats";
import { formatAndroidColors, formatAndroidDimens, formatCompose, formatUnrealCsv } from "./formatsNative";
import { cssValue, TOKEN_TYPES, type TokenType } from "./values";
import { SHARED_FILES, VARIANTS, type Variant } from "./variants";

export { DEFAULT_THEME, THEME_NAMES, VARIANTS, type Variant } from "./variants";
export type { BuildModel, TokenRecord } from "./formats";

const PACKAGE_DIR = join(dirname(fileURLToPath(import.meta.url)), "..");
const EXTENSION = "org.scenity";

/** The sources of one build and the pairs of its accessibility checks. */
export interface TokenSet {
  /** The folder with the package.json of the outputs: its name and version go into each output. */
  readonly packageDir: string;
  /** The source folders. The first folder is the engine; the build writes the CSS of the last folder only. */
  readonly roots: readonly string[];
  readonly contrast: readonly ContrastPair[];
  readonly distinct: readonly DistinctPair[];
}

/** The engine tokens of @scenity/tokens. */
export const ENGINE_SET: TokenSet = {
  packageDir: PACKAGE_DIR,
  roots: [join(PACKAGE_DIR, "src")],
  contrast: CONTRAST_PAIRS,
  distinct: DISTINCT_PAIRS,
};

/** A plugin set: the engine sources and the sources of the plugin, with the checks of both. */
export function pluginSet(
  packageDir: string,
  checks: { contrast: readonly ContrastPair[]; distinct: readonly DistinctPair[] },
): TokenSet {
  return {
    packageDir,
    roots: [...ENGINE_SET.roots, join(packageDir, "src")],
    contrast: [...ENGINE_SET.contrast, ...checks.contrast],
    distinct: [...ENGINE_SET.distinct, ...checks.distinct],
  };
}

function ownExtension(token: TransformedToken): Record<string, unknown> {
  const extensions: unknown = token.$extensions;
  if (typeof extensions !== "object" || extensions === null) return {};
  const own = (extensions as Record<string, unknown>)[EXTENSION];
  return typeof own === "object" && own !== null ? (own as Record<string, unknown>) : {};
}

/** The source folder of a file, and the tier from its folder under the source folder. */
function placeOf(filePath: string, roots: readonly string[]): { root: number; tier: Tier } {
  const root = roots.findIndex((folder) => !relative(folder, filePath).startsWith(".."));
  const parts = relative(roots[root] ?? "", filePath).split(sep);
  const tier = parts[0] === "primitives" ? "primitive" : parts[0] === "components" ? "component" : "semantic";
  return { root, tier };
}

function isTokenType(type: unknown): type is TokenType {
  return typeof type === "string" && (TOKEN_TYPES as readonly string[]).includes(type);
}

/** The files of each source folder: the shared globs, and the theme files that exist in the folder. */
function filesOf(roots: readonly string[], shared: readonly string[], themed: readonly string[]): string[] {
  return roots.flatMap((root) => [
    ...shared.map((file) => join(root, file)),
    ...themed.map((file) => join(root, file)).filter((file) => existsSync(file)),
  ]);
}

/** Resolve and transform the tokens of one variant. */
async function variantTokens(variant: Variant, roots: readonly string[]): Promise<TransformedToken[]> {
  const highContrast = variant.override_files.length > 0;
  const sd = new StyleDictionary({
    usesDtcg: true,
    // Files in "source" replace values of files in "include" without a collision warning.
    include: filesOf(roots, SHARED_FILES, highContrast ? variant.theme_files : []),
    source: filesOf(roots, [], highContrast ? variant.override_files : variant.theme_files),
    log: { verbosity: "silent", warnings: "error", errors: { brokenReferences: "throw" } },
    hooks: {
      transforms: {
        "sc/name": { type: "name", transform: (token) => token.path.join(".") },
        "sc/css": {
          type: "value",
          transitive: true,
          transform: (token) => {
            const unit = ownExtension(token).unit;
            return cssValue(token.$type, token.$value, typeof unit === "string" ? unit : undefined);
          },
        },
      },
    },
    platforms: { scenity: { transforms: ["sc/name", "sc/css"] } },
  });
  const dictionary = await sd.getPlatformTokens("scenity");
  return dictionary.allTokens;
}

type MutableRecord = Omit<TokenRecord, "values"> & { values: Record<string, string> };

/** The record of a token, without values. */
function recordOf(token: TransformedToken, type: TokenType, roots: readonly string[]): MutableRecord {
  const description: unknown = token.$description;
  const extension = ownExtension(token);
  const place = placeOf(token.filePath, roots);
  return {
    name: token.name,
    path: token.path,
    type,
    tier: place.tier,
    description: typeof description === "string" ? description : null,
    guarded: extension.guarded === true,
    extension,
    base: place.root < roots.length - 1,
    values: {},
  };
}

/** Build the model of all variants: one record per token with the value of each variant. */
export async function buildModel(set: TokenSet = ENGINE_SET): Promise<BuildModel> {
  const pkg = JSON.parse(await readFile(join(set.packageDir, "package.json"), "utf8")) as {
    name: string;
    version: string;
  };
  const records = new Map<string, MutableRecord>();
  for (const variant of VARIANTS) {
    for (const token of await variantTokens(variant, set.roots)) {
      const type: unknown = token.$type;
      if (!isTokenType(type)) throw new Error(`token ${token.name} has an unsupported type: ${String(type)}`);
      let record = records.get(token.name);
      if (record === undefined) {
        record = recordOf(token, type, set.roots);
        records.set(token.name, record);
      } else if (record.type !== type) {
        throw new Error(`token ${token.name} changes its type in variant ${variant.id}`);
      }
      record.values[variant.id] = String(token.$value);
    }
  }
  const tokens = [...records.values()].sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const token of tokens) {
    const missing = VARIANTS.filter((v) => token.values[v.id] === undefined).map((v) => v.id);
    if (missing.length > 0) throw new Error(`token ${token.name} has no value in ${missing.join(", ")}`);
  }
  return { name: pkg.name, version: pkg.version, extends: set.roots.length > 1, variants: VARIANTS, tokens };
}

/** The contrast and distinctness checks of every variant (src/checks.ts). */
export function runChecks(
  model: BuildModel,
  set: Pick<TokenSet, "contrast" | "distinct"> = ENGINE_SET,
): {
  contrast: ReturnType<typeof checkContrast>;
  distinct: ReturnType<typeof checkDistinct>;
} {
  const byName = new Map(model.tokens.map((t) => [t.name, t]));
  const contrast = [];
  const distinct = [];
  for (const variant of model.variants) {
    const value = (name: string): string => {
      const v = byName.get(name)?.values[variant.id];
      if (v === undefined) throw new Error(`check names an unknown token: ${name}`);
      return v;
    };
    contrast.push(...checkContrast(variant, value, set.contrast));
    distinct.push(...checkDistinct(variant, value, set.distinct));
  }
  return { contrast, distinct };
}

/** Write every output of a token set into outDir. Return the written paths, relative to outDir. */
export async function build(outDir: string = join(PACKAGE_DIR, "dist"), set: TokenSet = ENGINE_SET): Promise<string[]> {
  const model = await buildModel(set);
  const { contrast, distinct } = runChecks(model, set);
  const outputs: [string, string][] = [
    ["tokens.css", formatCss(model)],
    ["tailwind.css", formatTailwind(model)],
    ["tokens.ts", formatTypeScript(model)],
    ["reference.json", formatReference(model, contrast, distinct)],
    ["android/colors.xml", formatAndroidColors(model)],
    ["android/dimens.xml", formatAndroidDimens(model)],
    ["android/Tokens.kt", formatCompose(model)],
    ["unreal/tokens.csv", formatUnrealCsv(model)],
  ];
  await rm(outDir, { recursive: true, force: true });
  for (const [path, text] of outputs) {
    const file = join(outDir, path);
    await mkdir(dirname(file), { recursive: true });
    await writeFile(file, text);
  }
  const failures = contrast.filter((r) => !r.pass).length + distinct.filter((r) => !r.pass).length;
  if (failures > 0) console.warn(`tokens: ${String(failures)} accessibility checks fail (see dist/reference.json)`);
  return outputs.map(([path]) => path);
}

if (import.meta.main) {
  const written = await build();
  console.log(`tokens: wrote ${String(written.length)} files to dist/ (${VARIANTS.map((v) => v.id).join(", ")})`);
}
