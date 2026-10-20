// SPDX-License-Identifier: Apache-2.0
/**
 * The outputs of the token build for native clients: the Android resources, the Compose object
 * and the Unreal CSV. config/formats.ts has the outputs for the web.
 */

import { HEADER, inCss, isThemed, type BuildModel, type TokenRecord } from "./formats";
import { numberValue } from "./values";

// ------------------------------------------------------------------------------------------ Android

function snake(parts: readonly string[]): string {
  return parts.join("_").replace(/-/g, "_");
}

function androidColor(css: string): string {
  // CSS #rrggbbaa to Android #AARRGGBB.
  const hex = css.replace("#", "");
  const alpha = hex.length === 8 ? hex.slice(6, 8) : "ff";
  return `#${(alpha + hex.slice(0, 6)).toUpperCase()}`;
}

/** A font size: a size of the font primitives or of a type role, or a token with the flag "font-size". */
function isFontSize(token: TokenRecord): boolean {
  return (
    (token.path[0] === "font" && token.path[1] === "size") ||
    (token.path[0] === "type" && (token.path[2] ?? "").startsWith("size")) ||
    token.extension["font-size"] === true
  );
}

export function formatAndroidColors(model: BuildModel): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<!-- ${HEADER(model)} -->`, "<resources>"];
  const colors = model.tokens.filter((t) => t.type === "color" && t.tier !== "primitive");
  for (const v of model.variants) {
    lines.push(`  <!-- ${v.id} -->`);
    for (const t of colors) {
      lines.push(`  <color name="sc_${snake([v.id])}_${snake(t.path)}">${androidColor(t.values[v.id] ?? "")}</color>`);
    }
  }
  lines.push("</resources>", "");
  return lines.join("\n");
}

export function formatAndroidDimens(model: BuildModel): string {
  const lines = ['<?xml version="1.0" encoding="utf-8"?>', `<!-- ${HEADER(model)} -->`, "<resources>"];
  const dims = model.tokens.filter((t) => t.type === "dimension" && inCss(t));
  const firstId = model.variants[0]?.id ?? "";
  const write = (prefix: string, t: TokenRecord, variantId: string): void => {
    const px = numberValue(t.values[variantId] ?? "") ?? 0;
    const unit = isFontSize(t) ? "sp" : "dp";
    lines.push(`  <dimen name="sc_${prefix}${snake(t.path)}">${String(px)}${unit}</dimen>`);
  };
  for (const t of dims.filter((t) => !isThemed(t, model.variants))) write("", t, firstId);
  for (const v of model.variants) {
    for (const t of dims.filter((t) => isThemed(t, model.variants))) write(`${snake([v.id])}_`, t, v.id);
  }
  lines.push("</resources>", "");
  return lines.join("\n");
}

function pascal(parts: readonly string[]): string {
  return parts
    .join("-")
    .split(/[-.]/)
    .map((p) => p.slice(0, 1).toUpperCase() + p.slice(1))
    .join("");
}

function kotlinValue(t: TokenRecord, css: string): string | null {
  const n = numberValue(css);
  switch (t.type) {
    case "color":
      return `Color(0x${androidColor(css).slice(1)})`;
    case "dimension":
      return n === null ? null : `${String(n)}.${isFontSize(t) ? "sp" : "dp"}`;
    case "duration":
      return n === null ? null : `${String(Math.round(n))}L`;
    case "fontWeight":
      return n === null ? null : `FontWeight(${String(n)})`;
    case "number":
      if (n === null) return null;
      return css.endsWith("em") ? `${String(n)}.em` : `${String(n)}f`;
    case "cubicBezier": {
      const nums = /cubic-bezier\(([^)]*)\)/.exec(css)?.[1];
      return nums === undefined
        ? null
        : `CubicBezierEasing(${nums
            .split(",")
            .map((x) => `${x.trim()}f`)
            .join(", ")})`;
    }
    case "fontFamily":
      return JSON.stringify(css);
    default:
      return null;
  }
}

export function formatCompose(model: BuildModel): string {
  const tokens = model.tokens.filter((t) => !(t.tier === "primitive" && t.type === "color"));
  const firstId = model.variants[0]?.id ?? "";
  const lines = [
    `// ${HEADER(model)}`,
    "package org.scenity.tokens",
    "",
    "import androidx.compose.animation.core.CubicBezierEasing",
    "import androidx.compose.ui.graphics.Color",
    "import androidx.compose.ui.text.font.FontWeight",
    "import androidx.compose.ui.unit.dp",
    "import androidx.compose.ui.unit.em",
    "import androidx.compose.ui.unit.sp",
    "",
    "/** Design tokens of Scenity for Jetpack Compose. Durations are in ms; dimensions in dp or sp. */",
    "object ScenityTokens {",
    `    const val VERSION: String = ${JSON.stringify(model.version)}`,
    "",
    "    /** Tokens with the same value in every theme variant. */",
    "    object Shared {",
  ];
  const property = (t: TokenRecord, css: string, indent: string): void => {
    const value = kotlinValue(t, css);
    if (value === null) return;
    lines.push(`${indent}val ${pascal(t.path)} = ${value}`);
  };
  for (const t of tokens.filter((t) => !isThemed(t, model.variants))) property(t, t.values[firstId] ?? "", "        ");
  lines.push("    }");
  for (const v of model.variants) {
    lines.push("", `    /** Theme variant ${v.id}. */`, `    object ${pascal([v.id])} {`);
    for (const t of tokens.filter((t) => isThemed(t, model.variants))) property(t, t.values[v.id] ?? "", "        ");
    lines.push("    }");
  }
  lines.push("}", "");
  return lines.join("\n");
}

// ------------------------------------------------------------------------------------------- Unreal

function csvField(text: string): string {
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function unrealValue(t: TokenRecord, css: string): string {
  if (t.type === "color") return css.length === 7 ? `${css}ff` : css;
  if (t.type === "dimension" || t.type === "duration") return String(numberValue(css) ?? css);
  if (t.type === "cubicBezier") return /cubic-bezier\(([^)]*)\)/.exec(css)?.[1]?.replace(/\s/g, "") ?? css;
  return css;
}

/**
 * Rows for a UMG DataTable. The first column is the unique row name. Colors are sRGB #RRGGBBAA, dimensions
 * are CSS px, durations are ms. The Version column records the package version in each row.
 */
export function formatUnrealCsv(model: BuildModel): string {
  const tokens = model.tokens.filter((t) => !(t.tier === "primitive" && t.type === "color"));
  const firstId = model.variants[0]?.id ?? "";
  const rows = ["Key,Name,Type,Theme,Value,Version"];
  const row = (t: TokenRecord, theme: string, css: string): void => {
    rows.push(
      [`${theme}/${t.name}`, t.name, t.type, theme, unrealValue(t, css), model.version].map(csvField).join(","),
    );
  };
  for (const t of tokens.filter((t) => !isThemed(t, model.variants))) row(t, "all", t.values[firstId] ?? "");
  for (const v of model.variants) {
    for (const t of tokens.filter((t) => isThemed(t, model.variants))) row(t, v.id, t.values[v.id] ?? "");
  }
  return `${rows.join("\n")}\n`;
}
