// SPDX-License-Identifier: Apache-2.0
/**
 * The theme variants that the token build writes. Each variant is one Style
 * Dictionary run over the shared sources, the theme file and, for high contrast, the override file.
 */

export type ThemeName = "navy" | "light" | "dark";
export type Contrast = "standard" | "more";

export interface Variant {
  /** The variant ID: the theme name, with the suffix "-high-contrast" for the high-contrast variant. */
  readonly id: string;
  readonly theme: ThemeName;
  readonly contrast: Contrast;
  readonly scheme: "light" | "dark";
  /** Source files of the theme, relative to src/. */
  readonly theme_files: readonly string[];
  /** Override files of the variant, relative to src/. They replace values of the theme files. */
  readonly override_files: readonly string[];
}

export const THEME_NAMES: readonly ThemeName[] = ["navy", "light", "dark"];

/** The theme that applies when the root element has no data-theme attribute. */
export const DEFAULT_THEME: ThemeName = "light";

const SCHEME: Record<ThemeName, "light" | "dark"> = { navy: "dark", light: "light", dark: "dark" };

export const VARIANTS: readonly Variant[] = THEME_NAMES.flatMap((theme) => [
  {
    id: theme,
    theme,
    contrast: "standard" as const,
    scheme: SCHEME[theme],
    theme_files: [`themes/${theme}.tokens.json`],
    override_files: [],
  },
  {
    id: `${theme}-high-contrast`,
    theme,
    contrast: "more" as const,
    scheme: SCHEME[theme],
    theme_files: [`themes/${theme}.tokens.json`],
    override_files: [`themes/${theme}-high-contrast.tokens.json`],
  },
]);

/** Source files that every variant uses, relative to src/. */
export const SHARED_FILES = ["primitives/*.tokens.json", "themes/base.tokens.json", "components/*.tokens.json"];
