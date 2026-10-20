// SPDX-License-Identifier: Apache-2.0
/**
 * The settings of the asset build: the levels of detail, the texture codec of each role, the budgets of each
 * asset kind and tier, the output folder and the generator text. A project gives them in `build.assets` and
 * `quality.budgets` of `scenity.project.json`. This module fills the defaults. An asset record can change the codecs
 * and the number of levels of its asset (`build` of the record).
 *
 * The defaults: two levels (`high` and `low`), ETC1S for colours and data, UASTC for normal maps, and the largest
 * texture edges of each role.
 */
import {
  buildSchema,
  formatErrors,
  qualitySchema,
  zodErrors,
  type AssetBuildConfig,
  type LodConfig,
  type ProjectDocument,
  type TextureCodecsConfig,
} from "@scenity/scene";
import { z } from "zod";
import type { TierBudget } from "./checks";

/** The texture roles of a model. The role sets the colour space and the codec of a texture. */
export type TextureRole = "color" | "normal" | "data";
export const TEXTURE_ROLES: readonly TextureRole[] = ["color", "normal", "data"];
/** The KTX2 codecs: Basis ETC1S or UASTC. */
export type TextureCodec = "etc1s" | "uastc";

/** The texture codec of each role, and the codec of an environment map. */
export interface TextureCodecs {
  readonly color: TextureCodec;
  readonly normal: TextureCodec;
  readonly data: TextureCodec;
  readonly environment: "rgbe";
}

/** One level of detail with all its values. */
export interface LodLevel<T extends string = string> {
  /** The quality tier: the file of the level is `<id>.<tier>.glb`. */
  readonly tier: T;
  /** The part of the source triangles that the level keeps (1: no simplification). */
  readonly ratio: number;
  /** The scale of the texture edges against the source (1: the source size). */
  readonly textureScale: number;
  /** The largest texture edge in px for each role. */
  readonly maxTextureSize: Readonly<Record<TextureRole, number>>;
}

/** The default tiers of a built model: the full model and its LOD1. */
export type ModelTier = "high" | "low";

/**
 * The largest edge of each role on the first level. A normal map is smaller than the color texture. A UASTC normal map
 * of 1024 px took 0.85 MB of the 1.5 MB of a character. At the size of a member on the screen, 512 px shows the same.
 * Each next level has half of these edges.
 */
export const BASE_TEXTURE_SIZE: Readonly<Record<TextureRole, number>> = { color: 2048, normal: 512, data: 1024 };

export const HIGH_LOD: LodLevel<"high"> = {
  tier: "high",
  ratio: 1,
  textureScale: 1,
  maxTextureSize: BASE_TEXTURE_SIZE,
};
export const LOW_LOD: LodLevel<"low"> = {
  tier: "low",
  ratio: 0.5,
  textureScale: 0.5,
  maxTextureSize: { color: 1024, normal: 256, data: 512 },
};
/** The default levels: the full model and a LOD1 with half the triangles and half the texture size. */
export const DEFAULT_LODS: readonly LodLevel<ModelTier>[] = [HIGH_LOD, LOW_LOD];

export const DEFAULT_CODECS: TextureCodecs = { color: "etc1s", normal: "uastc", data: "etc1s", environment: "rgbe" };
/** The default output folder of a project, relative to the project folder. A scan of the asset roots skips it. */
export const DEFAULT_OUTPUT = "build";
/**
 * The default generator string of a built file (the version of glTF Transform is not in the bytes). A project can give
 * its own text.
 */
export const GENERATOR = "Scenity @scenity/assets";

/** The budgets by an asset kind and then by a tier. */
export type KindBudgets = Readonly<Record<string, Readonly<Record<string, TierBudget>>>>;

/** All settings of a build, with the defaults filled. */
export interface BuildSettings {
  readonly lods: readonly LodLevel[];
  readonly codecs: TextureCodecs;
  readonly budgets: KindBudgets;
  readonly output: string;
  readonly generator: string;
  /** More glTF extensions that the loader of the project reads. */
  readonly extensions: readonly string[];
}

/** The level of detail at an index from its config: a missing value gets the default of that index. */
export function resolveLod(config: LodConfig, index: number): LodLevel {
  const scale = 0.5 ** index;
  const sizes = config.maxTextureSize ?? {};
  const maxTextureSize = Object.fromEntries(
    TEXTURE_ROLES.map((role) => [role, sizes[role] ?? Math.max(1, Math.floor(BASE_TEXTURE_SIZE[role] * scale))]),
  ) as Record<TextureRole, number>;
  return {
    tier: config.tier,
    ratio: config.ratio ?? scale,
    textureScale: config.textureScale ?? scale,
    maxTextureSize,
  };
}

/** The codecs of a config over a base (the project codecs over the defaults, or the record codecs over the project). */
export function resolveCodecs(
  config: TextureCodecsConfig | undefined,
  base: TextureCodecs = DEFAULT_CODECS,
): TextureCodecs {
  return {
    color: config?.color ?? base.color,
    normal: config?.normal ?? base.normal,
    data: config?.data ?? base.data,
    environment: config?.environment ?? base.environment,
  };
}

/** The budgets of `quality.budgets`: each kind with a budget for at least one tier (the group `scene` too). */
function resolveBudgets(project: Pick<ProjectDocument, "quality">): KindBudgets {
  const out: Record<string, Record<string, TierBudget>> = {};
  for (const [kind, tiers] of Object.entries(project.quality?.budgets ?? {})) {
    out[kind] = {};
    for (const [tier, budget] of Object.entries(tiers)) {
      out[kind][tier] = {
        ...(budget.triangles === undefined ? {} : { triangles: budget.triangles }),
        ...(budget.bytes === undefined ? {} : { bytes: budget.bytes }),
        ...(budget.maxTextureSize === undefined ? {} : { maxTextureSize: budget.maxTextureSize }),
      };
    }
  }
  return out;
}

/** The build settings of a project document (or of a part of one) with the defaults. */
export function resolveBuildSettings(project: Pick<ProjectDocument, "build" | "quality">): BuildSettings {
  const config: AssetBuildConfig = project.build?.assets ?? {};
  return {
    lods: config.lods === undefined ? DEFAULT_LODS : config.lods.map(resolveLod),
    codecs: resolveCodecs(config.codecs),
    budgets: resolveBudgets(project),
    output: config.output ?? DEFAULT_OUTPUT,
    generator: config.generator ?? GENERATOR,
    extensions: config.extensions ?? [],
  };
}

/** The part of a project document that the build reads. */
export type BuildConfig = Pick<ProjectDocument, "build" | "quality">;

const buildConfigSchema = z.strictObject({ quality: qualitySchema.optional(), build: buildSchema.optional() });

/**
 * Check the build part of a project document and resolve it. A content set with no project file (for example the
 * content of a plugin) gives its settings in this form. Throws for a bad value.
 */
export function parseBuildSettings(config: unknown): BuildSettings {
  const parsed = buildConfigSchema.safeParse(config);
  if (!parsed.success) throw new Error(`bad build settings:\n${formatErrors(zodErrors(parsed.error))}`);
  return resolveBuildSettings(parsed.data);
}
