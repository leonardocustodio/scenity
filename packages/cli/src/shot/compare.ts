// SPDX-License-Identifier: Apache-2.0
/**
 * The picture comparison of `scenity shot --compare`. It applies the rule of `toHaveScreenshot` of the editor gallery
 * (apps/editor/playwright.gallery.config.ts): the pixelmatch count of Playwright 1.63 (its copy of pixelmatch 5, ISC
 * licence) with the threshold 0.2, and at most 0.2 % of the pixels over it. Pixelmatch does not count a pixel of an
 * antialiased edge. A picture of another size fails.
 */
import { decodePng, type Rgba } from "@scenity/assets/build";

export interface Tolerance {
  /** The YIQ colour distance of one pixel, from 0 to 1 (pixelmatch `threshold`). */
  readonly threshold: number;
  /** The largest share of pixels over the threshold. */
  readonly maxDiffPixelRatio: number;
}

/** The tolerance of the gallery: `expect.toHaveScreenshot` of apps/editor/playwright.gallery.config.ts. */
export const GALLERY_TOLERANCE: Tolerance = { threshold: 0.2, maxDiffPixelRatio: 0.002 };

export interface Comparison {
  readonly passed: boolean;
  /** The pixels over the threshold that are not on an antialiased edge. */
  readonly differ: number;
  /** The most pixels that can differ. */
  readonly limit: number;
  readonly size: { readonly width: number; readonly height: number };
  readonly baselineSize: { readonly width: number; readonly height: number };
}

type Pixels = Uint8Array | Uint8ClampedArray;

function blend(c: number, a: number): number {
  return 255 + (c - 255) * a;
}

function rgb2y(r: number, g: number, b: number): number {
  return r * 0.29889531 + g * 0.58662247 + b * 0.11448223;
}

function rgb2i(r: number, g: number, b: number): number {
  return r * 0.59597799 - g * 0.2741761 - b * 0.32180189;
}

function rgb2q(r: number, g: number, b: number): number {
  return r * 0.21147017 - g * 0.52261711 + b * 0.31114694;
}

/** The colour distance of two pixels; with `yOnly`, the signed brightness difference. */
function colorDelta(one: Pixels, two: Pixels, k: number, m: number, yOnly = false): number {
  let [r1, g1, b1, a1] = [one[k] ?? 0, one[k + 1] ?? 0, one[k + 2] ?? 0, one[k + 3] ?? 0];
  let [r2, g2, b2, a2] = [two[m] ?? 0, two[m + 1] ?? 0, two[m + 2] ?? 0, two[m + 3] ?? 0];
  if (a1 === a2 && r1 === r2 && g1 === g2 && b1 === b2) return 0;
  if (a1 < 255) {
    a1 /= 255;
    [r1, g1, b1] = [blend(r1, a1), blend(g1, a1), blend(b1, a1)];
  }
  if (a2 < 255) {
    a2 /= 255;
    [r2, g2, b2] = [blend(r2, a2), blend(g2, a2), blend(b2, a2)];
  }
  const y1 = rgb2y(r1, g1, b1);
  const y2 = rgb2y(r2, g2, b2);
  const y = y1 - y2;
  if (yOnly) return y;
  const i = rgb2i(r1, g1, b1) - rgb2i(r2, g2, b2);
  const q = rgb2q(r1, g1, b1) - rgb2q(r2, g2, b2);
  const delta = 0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q;
  return y1 > y2 ? -delta : delta;
}

/** The pixel box of 3 × 3 around a pixel, cut at the edges of the picture. */
function box(x: number, y: number, width: number, height: number) {
  const x0 = Math.max(x - 1, 0);
  const y0 = Math.max(y - 1, 0);
  const x2 = Math.min(x + 1, width - 1);
  const y2 = Math.min(y + 1, height - 1);
  return { x0, y0, x2, y2, edge: x === x0 || x === x2 || y === y0 || y === y2 ? 1 : 0 };
}

/** True when more than two neighbours of a pixel have its exact colour. */
function hasManySiblings(img: Pixels, x1: number, y1: number, width: number, height: number): boolean {
  const { x0, y0, x2, y2, edge } = box(x1, y1, width, height);
  const pos = (y1 * width + x1) * 4;
  let zeroes = edge;
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const other = (y * width + x) * 4;
      const same = [0, 1, 2, 3].every((c) => img[pos + c] === img[other + c]);
      if (same) zeroes++;
      if (zeroes > 2) return true;
    }
  }
  return false;
}

/** True when the pixel is on an antialiased edge of `img` (the rule of pixelmatch). */
function antialiased(img: Pixels, x1: number, y1: number, width: number, height: number, img2: Pixels): boolean {
  const { x0, y0, x2, y2, edge } = box(x1, y1, width, height);
  const pos = (y1 * width + x1) * 4;
  let zeroes = edge;
  let min = 0;
  let max = 0;
  let [minX, minY, maxX, maxY] = [0, 0, 0, 0];
  for (let x = x0; x <= x2; x++) {
    for (let y = y0; y <= y2; y++) {
      if (x === x1 && y === y1) continue;
      const delta = colorDelta(img, img, pos, (y * width + x) * 4, true);
      if (delta === 0) {
        zeroes++;
        if (zeroes > 2) return false;
      } else if (delta < min) {
        [min, minX, minY] = [delta, x, y];
      } else if (delta > max) {
        [max, maxX, maxY] = [delta, x, y];
      }
    }
  }
  if (min === 0 || max === 0) return false;
  return (
    (hasManySiblings(img, minX, minY, width, height) && hasManySiblings(img2, minX, minY, width, height)) ||
    (hasManySiblings(img, maxX, maxY, width, height) && hasManySiblings(img2, maxX, maxY, width, height))
  );
}

/** The count of pixels over the threshold and not on an antialiased edge (pixelmatch with `includeAA: false`). */
export function countDiffer(one: Pixels, two: Pixels, width: number, height: number, threshold: number): number {
  if (one.length !== width * height * 4 || two.length !== one.length) throw new Error("the picture sizes differ");
  const maxDelta = 35215 * threshold * threshold;
  let differ = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const pos = (y * width + x) * 4;
      if (Math.abs(colorDelta(one, two, pos, pos)) <= maxDelta) continue;
      if (antialiased(one, x, y, width, height, two) || antialiased(two, x, y, width, height, one)) continue;
      differ++;
    }
  }
  return differ;
}

/** Compare a picture with its baseline (8-bit RGBA). */
export function compareRgba(actual: Rgba, baseline: Rgba, tolerance: Tolerance = GALLERY_TOLERANCE): Comparison {
  const size = { width: actual.width, height: actual.height };
  const baselineSize = { width: baseline.width, height: baseline.height };
  const limit = baseline.width * baseline.height * tolerance.maxDiffPixelRatio;
  if (size.width !== baselineSize.width || size.height !== baselineSize.height) {
    return { passed: false, differ: size.width * size.height, limit, size, baselineSize };
  }
  const differ = countDiffer(baseline.data, actual.data, size.width, size.height, tolerance.threshold);
  return { passed: differ <= limit, differ, limit, size, baselineSize };
}

/** Compare two PNG files (their bytes). */
export function comparePng(actual: Uint8Array, baseline: Uint8Array, tolerance: Tolerance = GALLERY_TOLERANCE) {
  return compareRgba(decodePng(actual), decodePng(baseline), tolerance);
}
