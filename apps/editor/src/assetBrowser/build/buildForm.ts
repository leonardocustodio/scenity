// SPDX-License-Identifier: Apache-2.0
/**
 * The build settings form of the asset build panel: the texture codec of each role and the number of levels of detail
 * of one asset (`build` of the asset record). An empty choice keeps the setting of
 * the project. Pure functions, no DOM.
 */
import type { AssetBuildInfo, AssetBuildSettings } from "../assetTypes";

/** The texture roles of a model and their codecs (`textureCodecsSchema` of `@scenity/scene`). */
export const CODEC_ROLES = ["color", "normal", "data", "environment"] as const;
export type CodecRole = (typeof CODEC_ROLES)[number];
export const CODECS: Readonly<Record<CodecRole, readonly string[]>> = {
  color: ["etc1s", "uastc"],
  normal: ["etc1s", "uastc"],
  data: ["etc1s", "uastc"],
  environment: ["rgbe"],
};

/** The texts of the form: one codec for each role ("" keeps the project setting) and the levels ("" likewise). */
export interface BuildFormTexts {
  readonly codecs: Readonly<Record<CodecRole, string>>;
  readonly lods: string;
}

/** The texts of the settings of an asset. */
export function formTexts(build: AssetBuildSettings | null): BuildFormTexts {
  const codecs = build?.codecs ?? {};
  return {
    codecs: {
      color: codecs.color ?? "",
      normal: codecs.normal ?? "",
      data: codecs.data ?? "",
      environment: codecs.environment ?? "",
    },
    lods: build?.lods === undefined ? "" : String(build.lods),
  };
}

/** The settings of the texts (null: no settings, so the record keeps none). Throws for a level count out of 1 to 8. */
export function formSettings(texts: BuildFormTexts): AssetBuildSettings | null {
  const codecs = Object.fromEntries(
    CODEC_ROLES.flatMap((role) => (texts.codecs[role] === "" ? [] : [[role, texts.codecs[role]]])),
  );
  const out: { codecs?: Record<string, string>; lods?: number } = {};
  if (Object.keys(codecs).length > 0) out.codecs = codecs;
  if (texts.lods.trim() !== "") {
    const lods = Number(texts.lods);
    if (!Number.isInteger(lods) || lods < 1 || lods > 8) throw new Error("lods");
    out.lods = lods;
  }
  return Object.keys(out).length === 0 ? null : out;
}

/** The count of the assets of each build state, in the order of the marks. */
export function stateCounts(
  assets: readonly AssetBuildInfo[],
): readonly (readonly [AssetBuildInfo["state"], number])[] {
  const order = ["failed", "stale", "unbuilt", "built"] as const;
  return order.map((state) => [state, assets.filter((asset) => asset.state === state).length] as const);
}
