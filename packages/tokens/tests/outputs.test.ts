// SPDX-License-Identifier: Apache-2.0
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "../config/build";
import { THEME_NAMES, VARIANTS } from "../config/variants";
import {
  cssVar,
  THEME_VARIANTS,
  themeVariant,
  TOKEN_INFO,
  tokenNumber,
  tokenValue,
  TOKENS_VERSION,
  type TokenName,
} from "../src/index";

const DIST = join(import.meta.dir, "../dist");
// The outputs carry the version of package.json, and a release changes it.
const VERSION = (JSON.parse(readFileSync(join(import.meta.dir, "../package.json"), "utf8")) as { version: string })
  .version;
let fresh = "";
let written: string[] = [];

beforeAll(async () => {
  fresh = await mkdtemp(join(tmpdir(), "sc-tokens-"));
  written = await build(fresh);
});

afterAll(async () => {
  await rm(fresh, { recursive: true, force: true });
});

const read = (path: string): Promise<string> => readFile(join(fresh, path), "utf8");

describe("build outputs", () => {
  test("the build writes every output, and dist/ is up to date with the sources", async () => {
    expect(written.sort()).toEqual(
      [
        "android/Tokens.kt",
        "android/colors.xml",
        "android/dimens.xml",
        "reference.json",
        "tailwind.css",
        "tokens.css",
        "tokens.ts",
        "unreal/tokens.csv",
      ].sort(),
    );
    for (const path of written) {
      expect(await read(path), `dist/${path} is stale: run bun run build`).toBe(
        await readFile(join(DIST, path), "utf8"),
      );
    }
  });

  test("tokens.css has a block for every theme and every high-contrast variant", async () => {
    const css = await read("tokens.css");
    expect(css).toContain(":root {");
    expect(css).toContain(':root,\n[data-theme="light"] {');
    for (const theme of THEME_NAMES) {
      expect(css).toContain(`[data-theme="${theme}"]`);
      expect(css).toContain(
        `[data-theme="${theme}"][data-contrast="more"],\n[data-contrast="more"] [data-theme="${theme}"] {`,
      );
    }
    expect(css).toContain("color-scheme: dark;");
    expect(css).toContain("color-scheme: light;");
    // Each standard theme block defines every semantic color.
    const navy = /\[data-theme="navy"\] \{([^}]*)\}/.exec(css)?.[1] ?? "";
    for (const name of [
      "surface-base",
      "surface-raised",
      "surface-device",
      "text-primary",
      "status-info",
      "focus-ring",
    ]) {
      expect(navy).toContain(`--sc-color-${name}:`);
    }
    // Primitive colors are not CSS variables. The alarm colors are tokens of a plugin.
    expect(css).not.toContain("--sc-color-ink-");
    expect(css).not.toContain("--sc-color-alarm-");
  });

  test("tailwind.css maps the semantic tokens to Tailwind 4 utilities", async () => {
    const css = await read("tailwind.css");
    expect(css).toContain("@theme inline {");
    expect(css).toContain("--color-*: initial;");
    expect(css).toContain("--color-surface-raised: var(--sc-color-surface-raised);");
    expect(css).toContain("--color-status-info: var(--sc-color-status-info);");
    expect(css).toContain("--text-body: var(--sc-type-body-size);");
    expect(css).toContain("--text-body--line-height: var(--sc-type-body-line-height);");
    expect(css).toContain("--radius-card: var(--sc-radius-card);");
    expect(css).toContain("--spacing-target-touch: var(--sc-size-target-touch);");
    expect(css).toContain("--transition-duration-base: var(--sc-duration-base);");
    // Media queries cannot read variables: breakpoints are literal.
    expect(css).toContain("--breakpoint-md: 56.25rem;");
    expect(css).toContain("@custom-variant theme-navy");
    expect(css).toContain("@custom-variant reduce-motion");
  });

  test("tokens.ts gives typed values for canvas code", () => {
    expect(TOKENS_VERSION).toBe(VERSION);
    expect(THEME_VARIANTS).toEqual(VARIANTS.map((v) => v.id) as never);
    expect(themeVariant("navy")).toBe("navy");
    expect(themeVariant("navy", "more")).toBe("navy-high-contrast");
    expect(tokenValue("navy", "color.status.info")).toBe("#5fb0ff");
    expect(tokenValue("navy-high-contrast", "color.text.primary")).toBe("#ffffff");
    expect(tokenValue("light", "color.surface.base")).toBe("#fbfbfc");
    expect(tokenNumber("navy", "duration.base")).toBe(200);
    expect(tokenNumber("navy", "size.target.touch")).toBe(44);
    expect(tokenNumber("navy", "duration.slow")).toBe(300);
    expect(() => tokenNumber("navy", "color.status.info")).toThrow();
    expect(cssVar("color.surface.raised")).toBe("--sc-color-surface-raised");
    expect(() => tokenValue("navy", "no.such.token" as TokenName)).toThrow();
    expect(TOKEN_INFO["color.surface.base"].themed).toBe(true);
    expect(TOKEN_INFO["space.4"].themed).toBe(false);
  });

  test("Android resources are well formed and hold every theme variant", async () => {
    const colors = await read("android/colors.xml");
    expect(colors.startsWith('<?xml version="1.0" encoding="utf-8"?>')).toBe(true);
    const entries = [...colors.matchAll(/<color name="([a-z0-9_]+)">(#[0-9A-F]{8})<\/color>/g)];
    expect(entries.length).toBe(colors.split("<color ").length - 1);
    for (const v of VARIANTS) {
      expect(colors).toContain(`name="sc_${v.id.replace(/-/g, "_")}_color_surface_base"`);
    }
    expect(colors).toContain('<color name="sc_navy_color_status_info">#FF5FB0FF</color>');
    const dimens = await read("android/dimens.xml");
    expect(dimens).toContain('<dimen name="sc_space_4">16dp</dimen>');
    expect(dimens).toContain('<dimen name="sc_type_body_size">16sp</dimen>');
    expect(dimens).toMatch(/<dimen name="sc_navy_radius_card">8dp<\/dimen>/);
  });

  test("the Compose object has one object per theme variant", async () => {
    const kt = await read("android/Tokens.kt");
    expect(kt).toContain("package org.scenity.tokens");
    expect(kt).toContain(`const val VERSION: String = "${VERSION}"`);
    for (const name of ["Shared", "Navy", "NavyHighContrast", "Light", "LightHighContrast", "Dark"]) {
      expect(kt).toContain(`object ${name} {`);
    }
    expect(kt).toContain("val ColorStatusInfo = Color(0xFF5FB0FF)");
    expect(kt).toContain("val DurationBase = 200L");
  });

  test("the Unreal CSV has unique row names, four token columns and the package version", async () => {
    const csv = (await read("unreal/tokens.csv")).trimEnd().split("\n");
    expect(csv[0]).toBe("Key,Name,Type,Theme,Value,Version");
    const keys = new Set<string>();
    for (const line of csv.slice(1)) {
      const fields = [...line.matchAll(/("([^"]|"")*"|[^,]*)(,|$)/g)].map((m) => m[1] ?? "").slice(0, 6);
      expect(fields).toHaveLength(6);
      expect(fields[5]).toBe(VERSION);
      expect(keys.has(fields[0] ?? "")).toBe(false);
      keys.add(fields[0] ?? "");
    }
    expect(csv).toContain(`navy/color.status.info,color.status.info,color,navy,#5fb0ffff,${VERSION}`);
  });

  test("the token reference lists every token with its values and the check results", async () => {
    const reference = JSON.parse(await read("reference.json")) as {
      version: string;
      variants: { id: string }[];
      tokens: { name: string; values: Record<string, string> }[];
      contrast: unknown[];
      distinct: unknown[];
    };
    expect(reference.version).toBe(VERSION);
    expect(reference.variants.map((v) => v.id)).toEqual(VARIANTS.map((v) => v.id));
    const surface = reference.tokens.find((t) => t.name === "color.surface.base");
    expect(Object.keys(surface?.values ?? {})).toHaveLength(VARIANTS.length);
    expect(reference.contrast.length).toBeGreaterThan(380);
    // The distinct pairs of the engine are the agent colours of the studio, each with normal vision. The alarm
    // priorities are tokens of a plugin.
    const distinct = reference.distinct as { a: string; pass: boolean }[];
    expect(distinct.length).toBeGreaterThan(0);
    expect(distinct.every((pair) => pair.a.startsWith("color.studio.agent.") && pair.pass)).toBe(true);
  });
});
