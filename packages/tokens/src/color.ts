// SPDX-License-Identifier: Apache-2.0
/**
 * Color math of the token package: WCAG 2.2 contrast, APCA lightness
 * contrast, color-vision simulation and OKLab distance. The token build, the token tests and the token
 * reference page of the gallery use these functions. The functions use sRGB hex text as input.
 */

export interface Rgba {
  /** Red, green and blue in the range 0 to 1 (gamma-encoded sRGB). */
  readonly r: number;
  readonly g: number;
  readonly b: number;
  /** Opacity in the range 0 to 1. */
  readonly a: number;
}

export type VisionKind = "normal" | "protanopia" | "deuteranopia" | "tritanopia" | "achromatopsia";

export const VISION_KINDS: readonly VisionKind[] = [
  "normal",
  "protanopia",
  "deuteranopia",
  "tritanopia",
  "achromatopsia",
];

const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i;

/** Parse sRGB hex text (#rgb, #rgba, #rrggbb or #rrggbbaa). Throw an error for other text. */
export function parseHex(hex: string): Rgba {
  const match = HEX.exec(hex.trim());
  if (match?.[1] === undefined) throw new Error(`not an sRGB hex color: ${hex}`);
  let digits = match[1];
  if (digits.length <= 4) digits = digits.replace(/./g, (d) => d + d);
  const channel = (i: number): number => parseInt(digits.slice(i * 2, i * 2 + 2), 16) / 255;
  return { r: channel(0), g: channel(1), b: channel(2), a: digits.length === 8 ? channel(3) : 1 };
}

/** Write a color as lowercase hex text. The text has an alpha pair only when the color is not opaque. */
export function toHex(color: Rgba): string {
  const pair = (v: number): string =>
    Math.round(Math.min(1, Math.max(0, v)) * 255)
      .toString(16)
      .padStart(2, "0");
  const rgb = `#${pair(color.r)}${pair(color.g)}${pair(color.b)}`;
  return color.a >= 1 ? rgb : `${rgb}${pair(color.a)}`;
}

/** Put a color with opacity over an opaque background (source-over in gamma-encoded sRGB, as browsers do). */
export function composite(fg: Rgba, bg: Rgba): Rgba {
  const a = fg.a;
  return { r: fg.r * a + bg.r * (1 - a), g: fg.g * a + bg.g * (1 - a), b: fg.b * a + bg.b * (1 - a), a: 1 };
}

function toLinear(v: number): number {
  return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function toGamma(v: number): number {
  const c = Math.min(1, Math.max(0, v));
  return c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055;
}

/** WCAG 2.2 relative luminance of an opaque color. */
export function relativeLuminance(color: Rgba): number {
  return 0.2126 * toLinear(color.r) + 0.7152 * toLinear(color.g) + 0.0722 * toLinear(color.b);
}

/** WCAG 2.2 contrast ratio (1 to 21). The function first puts a foreground with opacity over the background. */
export function contrastRatio(fg: string | Rgba, bg: string | Rgba): number {
  const back = typeof bg === "string" ? parseHex(bg) : bg;
  const front = composite(typeof fg === "string" ? parseHex(fg) : fg, back);
  const l1 = relativeLuminance(front);
  const l2 = relativeLuminance(back);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
}

/**
 * APCA lightness contrast Lc (APCA-W3 0.1.9 constants). The sign shows the polarity: positive for dark
 * text on a light background. The checks use |Lc| as an extra design check, not as the compliance measure.
 */
export function apcaContrast(text: string | Rgba, bg: string | Rgba): number {
  const back = typeof bg === "string" ? parseHex(bg) : bg;
  const front = composite(typeof text === "string" ? parseHex(text) : text, back);
  const screenY = (c: Rgba): number => {
    const y = 0.2126729 * c.r ** 2.4 + 0.7151522 * c.g ** 2.4 + 0.072175 * c.b ** 2.4;
    return y > 0.022 ? y : y + (0.022 - y) ** 1.414;
  };
  const yText = screenY(front);
  const yBg = screenY(back);
  if (Math.abs(yBg - yText) < 0.0005) return 0;
  if (yBg > yText) {
    const sapc = (yBg ** 0.56 - yText ** 0.57) * 1.14;
    return sapc < 0.1 ? 0 : (sapc - 0.027) * 100;
  }
  const sapc = (yBg ** 0.65 - yText ** 0.62) * 1.14;
  return sapc > -0.1 ? 0 : (sapc + 0.027) * 100;
}

type Matrix = readonly [
  readonly [number, number, number],
  readonly [number, number, number],
  readonly [number, number, number],
];

// Machado, Oliveira and Fernandes (2009), severity 1.0, applied to linear sRGB.
const CVD: Record<"protanopia" | "deuteranopia" | "tritanopia", Matrix> = {
  protanopia: [
    [0.152286, 1.052583, -0.204868],
    [0.114503, 0.786281, 0.099216],
    [-0.003882, -0.048116, 1.051998],
  ],
  deuteranopia: [
    [0.367322, 0.860646, -0.227968],
    [0.280085, 0.672501, 0.047413],
    [-0.01182, 0.04294, 0.968881],
  ],
  tritanopia: [
    [1.255528, -0.076749, -0.178779],
    [-0.078411, 0.930809, 0.147602],
    [0.004733, 0.691367, 0.3039],
  ],
};

/** Simulate how a person with a full color-vision deficiency sees an opaque color. */
export function simulateVision(color: Rgba, kind: VisionKind): Rgba {
  if (kind === "normal") return color;
  const lin = [toLinear(color.r), toLinear(color.g), toLinear(color.b)] as const;
  if (kind === "achromatopsia") {
    const y = toGamma(0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]);
    return { r: y, g: y, b: y, a: color.a };
  }
  const m = CVD[kind];
  const row = (i: 0 | 1 | 2): number => toGamma(m[i][0] * lin[0] + m[i][1] * lin[1] + m[i][2] * lin[2]);
  return { r: row(0), g: row(1), b: row(2), a: color.a };
}

/** OKLab coordinates (Ottosson 2020) of an opaque color. */
export function toOklab(color: Rgba): readonly [number, number, number] {
  const r = toLinear(color.r);
  const g = toLinear(color.g);
  const b = toLinear(color.b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

/** Euclidean distance in OKLab. About 0.02 is a just-noticeable difference. */
export function oklabDistance(a: string | Rgba, b: string | Rgba, kind: VisionKind = "normal"): number {
  const pa = toOklab(simulateVision(typeof a === "string" ? parseHex(a) : a, kind));
  const pb = toOklab(simulateVision(typeof b === "string" ? parseHex(b) : b, kind));
  return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
}
