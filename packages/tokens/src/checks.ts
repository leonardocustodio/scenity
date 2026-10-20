// SPDX-License-Identifier: Apache-2.0
/**
 * Accessibility checks of the token values. The build writes the results into the token reference
 * (dist/reference.json). The token tests fail on a result below the minimum, and the gallery shows the results on its
 * token page.
 */

import { apcaContrast, contrastRatio, oklabDistance, VISION_KINDS, type VisionKind } from "./color";

/** Text needs 4.5:1 (WCAG 1.4.3). Icons, borders, focus rings and traces need 3:1 (WCAG 1.4.11). */
export type PairKind = "text" | "non-text";

export interface ContrastPair {
  /** Token name of the foreground, for example color.text.primary. */
  readonly fg: string;
  /** Token name of the background. */
  readonly bg: string;
  readonly kind: PairKind;
  /** The themes that use the pair. No value means every theme. */
  readonly themes?: readonly string[];
  /** A higher minimum than the kind gives, for example 7:1 for vital numerals. */
  readonly minimum?: number;
}

export const MINIMUM: Readonly<Record<PairKind, number>> = { text: 4.5, "non-text": 3 };

/** The high-contrast variants meet WCAG 1.4.6 (7:1) for text and 4.5:1 for non-text parts. */
export const HIGH_CONTRAST_MINIMUM: Readonly<Record<PairKind, number>> = { text: 7, "non-text": 4.5 };

/** The surfaces of the text pairs. A plugin set checks its colors on them too. */
export const SURFACES: readonly string[] = [
  "color.surface.base",
  "color.surface.raised",
  "color.surface.sunken",
  "color.surface.overlay",
];
const STATUS = ["info", "positive", "caution", "attention", "negative", "neutral"];
/** The agent colours of the studio: one for each session. */
export const STUDIO_AGENTS: readonly string[] = [1, 2, 3, 4, 5, 6].map((n) => `color.studio.agent.${String(n)}`);
/** The studio marks that are not text: the selection and agents in the views, prefabs, the play frame and the axes. */
const STUDIO_MARKS: readonly string[] = [
  "color.studio.selection",
  "color.studio.play",
  "color.studio.prefab",
  ...STUDIO_AGENTS,
  "color.studio.axis.x",
  "color.studio.axis.y",
  "color.studio.axis.z",
];

function buildPairs(): ContrastPair[] {
  const pairs: ContrastPair[] = [];
  const textOnSurface = [
    "color.text.primary",
    "color.text.secondary",
    "color.text.link",
    "color.accent.text",
    ...STATUS.map((s) => `color.status.${s}`),
  ];
  for (const bg of SURFACES) {
    for (const fg of textOnSurface) pairs.push({ fg, bg, kind: "text" });
    for (const fg of ["color.border.strong", "color.focus.ring", "color.accent.brand"]) {
      pairs.push({ fg, bg, kind: "non-text" });
    }
  }
  pairs.push({ fg: "color.text.on-accent", bg: "color.accent.brand", kind: "text" });
  pairs.push({ fg: "color.text.on-accent", bg: "color.accent.brand-hover", kind: "text" });
  pairs.push({ fg: "color.focus.ring", bg: "color.focus.ring-inner", kind: "non-text" });
  for (const s of STATUS) {
    pairs.push({ fg: "color.text.primary", bg: `color.status.${s}-subtle`, kind: "text" });
    pairs.push({ fg: `color.status.${s}`, bg: `color.status.${s}-subtle`, kind: "text" });
  }
  // The studio marks are parts of the UI (outlines, dots, bars, axes) on every surface.
  for (const bg of SURFACES) {
    for (const fg of STUDIO_MARKS) pairs.push({ fg, bg, kind: "non-text" });
  }
  // In the light and dark themes, a device inset sets data-theme="navy", so device text uses the navy values.
  for (const fg of ["color.text.primary", "color.text.secondary", "color.border.strong", "color.focus.ring"]) {
    pairs.push({ fg, bg: "color.surface.device", kind: fg.includes("text") ? "text" : "non-text", themes: ["navy"] });
  }
  return pairs;
}

export const CONTRAST_PAIRS: readonly ContrastPair[] = buildPairs();

export interface DistinctPair {
  readonly a: string;
  readonly b: string;
  readonly why: string;
  /**
   * The vision kinds that the pair must pass. No value means every kind. A pair with another cue for a deficiency (a
   * name, a mark) gives a shorter list.
   */
  readonly kinds?: readonly VisionKind[];
}

/** Each agent colour against the other agents, the selection and the prefab mark, with normal vision. */
function studioDistinctPairs(): DistinctPair[] {
  const pairs: DistinctPair[] = [];
  const why = "an agent mark next to another agent, the selection or a prefab (the session name is the second cue)";
  STUDIO_AGENTS.forEach((a, index) => {
    for (const b of [...STUDIO_AGENTS.slice(index + 1), "color.studio.selection", "color.studio.prefab"]) {
      pairs.push({ a, b, why, kinds: ["normal"] });
    }
  });
  return pairs;
}

/**
 * Colors that must look different, also to people with a color-vision deficiency. The engine colors have the studio
 * pairs only. A plugin set gives its pairs, for example the alarm priorities.
 */
export const DISTINCT_PAIRS: readonly DistinctPair[] = studioDistinctPairs();

/**
 * Minimum OKLab distance. About 0.02 is a just-noticeable difference. Normal vision needs 0.1. Each simulated
 * dichromacy needs 0.04. The check only reports achromatopsia, because shape and word separate the priorities.
 */
export const DISTINCT_MINIMUM: Readonly<Record<VisionKind, number | null>> = {
  normal: 0.1,
  protanopia: 0.04,
  deuteranopia: 0.04,
  tritanopia: 0.04,
  achromatopsia: null,
};

export interface ContrastResult extends ContrastPair {
  readonly variant: string;
  readonly fg_value: string;
  readonly bg_value: string;
  readonly ratio: number;
  /** APCA Lc as an extra design check. */
  readonly apca: number;
  readonly required: number;
  readonly pass: boolean;
}

export interface DistinctResult extends DistinctPair {
  readonly variant: string;
  readonly distance: Readonly<Record<VisionKind, number>>;
  readonly pass: boolean;
}

const round = (n: number, digits: number): number => Math.round(n * 10 ** digits) / 10 ** digits;

/** Check every contrast pair of one variant. `value` returns the hex text of a color token. */
export function checkContrast(
  variant: { readonly id: string; readonly theme: string; readonly contrast: string },
  value: (name: string) => string,
  pairs: readonly ContrastPair[] = CONTRAST_PAIRS,
): ContrastResult[] {
  const minimum = variant.contrast === "more" ? HIGH_CONTRAST_MINIMUM : MINIMUM;
  return pairs
    .filter((pair) => pair.themes === undefined || pair.themes.includes(variant.theme))
    .map((pair) => {
      const fg = value(pair.fg);
      const bg = value(pair.bg);
      const ratio = contrastRatio(fg, bg);
      const required = Math.max(minimum[pair.kind], pair.minimum ?? 0);
      return {
        ...pair,
        variant: variant.id,
        fg_value: fg,
        bg_value: bg,
        ratio: round(ratio, 2),
        apca: round(apcaContrast(fg, bg), 1),
        required,
        pass: ratio >= required,
      };
    });
}

/** Check every distinct pair of one variant. */
export function checkDistinct(
  variant: { readonly id: string },
  value: (name: string) => string,
  pairs: readonly DistinctPair[] = DISTINCT_PAIRS,
): DistinctResult[] {
  return pairs.map((pair) => {
    const distance = Object.fromEntries(
      VISION_KINDS.map((kind) => [kind, round(oklabDistance(value(pair.a), value(pair.b), kind), 3)]),
    ) as Record<VisionKind, number>;
    const pass = (pair.kinds ?? VISION_KINDS).every((kind) => {
      const min = DISTINCT_MINIMUM[kind];
      return min === null || distance[kind] >= min;
    });
    return { ...pair, variant: variant.id, distance, pass };
  });
}
