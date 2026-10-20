// SPDX-License-Identifier: Apache-2.0
/**
 * Value conversions of the token build. The Style Dictionary transform "sc/css" uses cssValue to change a
 * DTCG 2025.10 value into CSS text. The other outputs read the CSS text back with numberValue.
 */

import { toHex } from "../src/color";

/** The DTCG token types that the sources use (the subset of DTCG 2025.10 that the build supports). */
export const TOKEN_TYPES = [
  "color",
  "dimension",
  "duration",
  "cubicBezier",
  "fontFamily",
  "fontWeight",
  "number",
  "shadow",
] as const;
export type TokenType = (typeof TOKEN_TYPES)[number];

interface DtcgColor {
  colorSpace: string;
  components: (number | "none")[];
  alpha?: number | "none";
  hex?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isDtcgColor(value: unknown): value is DtcgColor {
  return isRecord(value) && typeof value.colorSpace === "string" && Array.isArray(value.components);
}

/** Change a color value into lowercase hex text. The function supports only the srgb color space. */
export function colorToCss(value: unknown): string {
  if (typeof value === "string") {
    if (!/^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(value)) throw new Error(`unsupported color text: ${value}`);
    return value.toLowerCase();
  }
  if (!isDtcgColor(value)) throw new Error(`not a DTCG color: ${JSON.stringify(value)}`);
  if (value.colorSpace !== "srgb") throw new Error(`only the srgb color space is supported, got ${value.colorSpace}`);
  const [r, g, b] = value.components.map((c) => (c === "none" ? 0 : c));
  if (r === undefined || g === undefined || b === undefined) throw new Error("a color needs three components");
  const a = value.alpha === undefined || value.alpha === "none" ? 1 : value.alpha;
  return toHex({ r, g, b, a });
}

function dimensionToCss(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.value === "number" && (value.unit === "px" || value.unit === "rem")) {
    return value.value === 0 ? "0" : `${String(value.value)}${value.unit}`;
  }
  throw new Error(`not a DTCG dimension: ${JSON.stringify(value)}`);
}

function durationToCss(value: unknown): string {
  if (typeof value === "string") return value;
  if (isRecord(value) && typeof value.value === "number" && (value.unit === "ms" || value.unit === "s")) {
    return `${String(value.unit === "s" ? value.value * 1000 : value.value)}ms`;
  }
  throw new Error(`not a DTCG duration: ${JSON.stringify(value)}`);
}

function fontFamilyToCss(value: unknown): string {
  const names = Array.isArray(value) ? value : [value];
  return names
    .map((name) => {
      if (typeof name !== "string") throw new Error(`not a font family: ${JSON.stringify(value)}`);
      // Generic family keywords and system names without spaces stay unquoted.
      return /^[a-z-]+$/i.test(name) ? name : `"${name}"`;
    })
    .join(", ");
}

function shadowToCss(value: unknown): string {
  const layers = Array.isArray(value) ? value : [value];
  return layers
    .map((layer) => {
      if (!isRecord(layer)) throw new Error(`not a DTCG shadow: ${JSON.stringify(value)}`);
      const parts = [layer.offsetX, layer.offsetY, layer.blur, layer.spread].map(dimensionToCss);
      const inset = layer.inset === true ? "inset " : "";
      return `${inset}${parts.join(" ")} ${colorToCss(layer.color)}`;
    })
    .join(", ");
}

/**
 * Change a DTCG value into CSS text. A value that is already text (a resolved reference to a token that the
 * transform changed before) stays as it is.
 */
export function cssValue(type: string | undefined, value: unknown, unit?: string): string {
  switch (type) {
    case "color":
      return colorToCss(value);
    case "dimension":
      return dimensionToCss(value);
    case "duration":
      return durationToCss(value);
    case "cubicBezier":
      if (typeof value === "string") return value;
      if (Array.isArray(value) && value.length === 4) return `cubic-bezier(${value.map(String).join(", ")})`;
      throw new Error(`not a cubic Bézier: ${JSON.stringify(value)}`);
    case "fontFamily":
      return typeof value === "string" && value.includes(",") ? value : fontFamilyToCss(value);
    case "fontWeight":
      return String(value);
    case "number":
      if (typeof value === "string") return value;
      if (typeof value !== "number") throw new Error(`not a number: ${JSON.stringify(value)}`);
      return unit === undefined ? String(value) : `${String(value)}${unit}`;
    case "shadow":
      return typeof value === "string" ? value : shadowToCss(value);
    default:
      throw new Error(`unsupported token type: ${String(type)}`);
  }
}

/**
 * Read the number of a CSS value: px for a dimension (1 rem is 16 px), ms for a duration, the plain number
 * for a number or a font weight, and the em number for letter spacing. Return null for other values.
 */
export function numberValue(css: string): number | null {
  const match = /^(-?\d+(?:\.\d+)?)(px|rem|ms|em)?$/.exec(css.trim());
  if (match?.[1] === undefined) return null;
  const n = Number(match[1]);
  return match[2] === "rem" ? n * 16 : n;
}
