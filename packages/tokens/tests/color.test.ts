// SPDX-License-Identifier: Apache-2.0
import { describe, expect, test } from "bun:test";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { apcaContrast, composite, contrastRatio, oklabDistance, parseHex, simulateVision, toHex } from "../src/color";

describe("color math", () => {
  test("parses and writes hex text", () => {
    expect(parseHex("#fff")).toEqual({ r: 1, g: 1, b: 1, a: 1 });
    expect(toHex(parseHex("#0B1016"))).toBe("#0b1016");
    expect(toHex(parseHex("#00000099"))).toBe("#00000099");
    expect(() => parseHex("red")).toThrow();
  });

  test("gives the WCAG contrast ratio", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#ffffff", "#ffffff")).toBeCloseTo(1, 5);
    // Reference value of the WebAIM contrast checker.
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });

  test("puts a color with opacity over the background before the contrast check", () => {
    expect(toHex(composite(parseHex("#00000080"), parseHex("#ffffff")))).toBe("#7f7f7f");
    expect(contrastRatio("#00000000", "#ffffff")).toBeCloseTo(1, 5);
  });

  test("gives the APCA lightness contrast with its polarity", () => {
    expect(apcaContrast("#000000", "#ffffff")).toBeCloseTo(106.04, 1);
    expect(apcaContrast("#ffffff", "#000000")).toBeCloseTo(-107.88, 1);
    expect(apcaContrast("#777777", "#777777")).toBe(0);
  });

  test("simulates color-vision deficiencies", () => {
    const red = parseHex("#ff0000");
    const green = parseHex("#00ff00");
    expect(oklabDistance(red, green)).toBeGreaterThan(0.3);
    // Red and green move near to each other for protanopia and deuteranopia.
    expect(oklabDistance(red, green, "deuteranopia")).toBeLessThan(oklabDistance(red, green));
    const grey = simulateVision(parseHex("#336699"), "achromatopsia");
    expect(grey.r).toBeCloseTo(grey.g, 6);
    expect(grey.g).toBeCloseTo(grey.b, 6);
  });
});

describe("DTCG color sources", () => {
  test("the hex fallback of every structured color matches its components", async () => {
    const dir = join(import.meta.dir, "../src");
    const files = (await readdir(dir, { recursive: true })).filter((f) => f.endsWith(".tokens.json"));
    let count = 0;
    const visit = (node: unknown, path: string): void => {
      if (typeof node !== "object" || node === null) return;
      const token = node as Record<string, unknown>;
      const value = token.$value as { colorSpace?: string; components?: number[]; alpha?: number; hex?: string };
      if (token.$type === "color" && typeof value === "object" && value.components !== undefined) {
        expect(value.colorSpace, path).toBe("srgb");
        const [r = 0, g = 0, b = 0] = value.components;
        expect(toHex({ r, g, b, a: 1 }), path).toBe(value.hex ?? "");
        count += 1;
      }
      for (const [key, child] of Object.entries(token)) if (!key.startsWith("$")) visit(child, `${path}.${key}`);
    };
    for (const file of files) visit(await Bun.file(join(dir, file)).json(), file);
    expect(count).toBeGreaterThan(50);
  });
});
