// SPDX-License-Identifier: Apache-2.0
/**
 * Helpers of the end-to-end and gallery tests of the editor: a pixel comparison of two frames and the check for an
 * empty canvas. The screenshots of the room are in
 * the editor face of its plugin.
 */
import type { BrowserContext } from "@playwright/test";

export interface FrameDiff {
  readonly width: number;
  readonly height: number;
  /** Pixels with any channel difference. */
  readonly differ: number;
  /** Pixels with any channel difference in the rows above `topRows` (diffFrames). */
  readonly differTop: number;
  /** Pixels with a channel difference over `threshold` (8-bit levels). */
  readonly over: number;
  readonly maxDelta: number;
  /** A copy of the first frame with the pixels of `over` in red, as a PNG (base64). */
  readonly map: string;
}

/**
 * Compare two PNG screenshots pixel by pixel. The browser decodes them in a blank page of the context (the app
 * page has a CSP; a blank page has none).
 */
export async function diffFrames(
  context: BrowserContext,
  a: Buffer,
  b: Buffer,
  threshold = 16,
  topRows = Number.POSITIVE_INFINITY,
): Promise<FrameDiff> {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ({ first, second, limit, rows }) => {
        const decode = async (base64: string): Promise<ImageData> => {
          const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
          const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
          const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
          const context2d = canvas.getContext("2d");
          if (context2d === null) throw new Error("no 2D context");
          context2d.drawImage(bitmap, 0, 0);
          return context2d.getImageData(0, 0, bitmap.width, bitmap.height);
        };
        const [one, two] = await Promise.all([decode(first), decode(second)]);
        if (one.width !== two.width || one.height !== two.height) {
          return { width: one.width, height: one.height, differ: -1, differTop: -1, over: -1, maxDelta: 255, map: "" };
        }
        const map = new ImageData(new Uint8ClampedArray(one.data), one.width, one.height);
        let differ = 0;
        let differTop = 0;
        const topEnd = Math.min(rows, one.height) * one.width * 4;
        let over = 0;
        let maxDelta = 0;
        for (let index = 0; index < one.data.length; index += 4) {
          let delta = 0;
          for (let channel = 0; channel < 3; channel += 1) {
            delta = Math.max(delta, Math.abs((one.data[index + channel] ?? 0) - (two.data[index + channel] ?? 0)));
          }
          if (delta > 0) differ += 1;
          if (delta > 0 && index < topEnd) differTop += 1;
          if (delta > limit) {
            over += 1;
            map.data.set([255, 0, 0, 255], index);
          }
          maxDelta = Math.max(maxDelta, delta);
        }
        const canvas = new OffscreenCanvas(one.width, one.height);
        canvas.getContext("2d")?.putImageData(map, 0, 0);
        const blob = await canvas.convertToBlob({ type: "image/png" });
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let text = "";
        for (const byte of bytes) text += String.fromCharCode(byte);
        return { width: one.width, height: one.height, differ, differTop, over, maxDelta, map: btoa(text) };
      },
      { first: a.toString("base64"), second: b.toString("base64"), limit: threshold, rows: topRows },
    );
  } finally {
    await page.close();
  }
}

/**
 * True when a screenshot of the scene shows no room: the brightness of its pixels spans less than `range` levels
 * (the dark vignette over an empty canvas). A room has light walls and a dark floor edge.
 */
export async function blankFrame(context: BrowserContext, png: Buffer, range = 40): Promise<boolean> {
  const page = await context.newPage();
  try {
    return await page.evaluate(
      async ({ data, limit }) => {
        const bytes = Uint8Array.from(atob(data), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/png" }));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context2d = canvas.getContext("2d");
        if (context2d === null) return false;
        context2d.drawImage(bitmap, 0, 0);
        const pixels = context2d.getImageData(0, 0, bitmap.width, bitmap.height).data;
        let low = 255;
        let high = 0;
        for (let index = 0; index < pixels.length; index += 4 * 7) {
          const level = ((pixels[index] ?? 0) + (pixels[index + 1] ?? 0) + (pixels[index + 2] ?? 0)) / 3;
          low = Math.min(low, level);
          high = Math.max(high, level);
        }
        return high - low < limit;
      },
      { data: png.toString("base64"), limit: range },
    );
  } finally {
    await page.close();
  }
}
