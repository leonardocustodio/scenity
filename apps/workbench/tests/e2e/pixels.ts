// SPDX-License-Identifier: Apache-2.0
/**
 * The picture comparison of the workbench end-to-end tests: the share of pixels over the tolerance of the gallery
 * (threshold 0.2, the YIQ distance of pixelmatch). A blank page of the browser decodes the pictures.
 */
import type { Page } from "@playwright/test";

/** The pixel tolerance of the gallery (apps/editor/playwright.gallery.config.ts). */
export const GALLERY_THRESHOLD = 0.2;
/** The largest share of pixels over the threshold. */
export const GALLERY_MAX_DIFF = 0.01;

/** Compare two pictures (base64 of PNG, WebP or JPEG). A different size gives the ratio 1. */
export async function diffRatio(page: Page, a: string, b: string): Promise<{ ratio: number; size: string }> {
  return page.evaluate(
    async ({ first, second, threshold }) => {
      const decode = async (base64: string): Promise<ImageData> => {
        const bytes = Uint8Array.from(atob(base64), (char) => char.charCodeAt(0));
        const bitmap = await createImageBitmap(new Blob([bytes]));
        const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
        const context = canvas.getContext("2d");
        if (context === null) throw new Error("no 2D context");
        context.drawImage(bitmap, 0, 0);
        return context.getImageData(0, 0, bitmap.width, bitmap.height);
      };
      const [one, two] = await Promise.all([decode(first), decode(second)]);
      const size = `${String(one.width)}x${String(one.height)} / ${String(two.width)}x${String(two.height)}`;
      if (one.width !== two.width || one.height !== two.height) return { ratio: 1, size };
      const max = 35215 * threshold * threshold;
      let over = 0;
      for (let index = 0; index < one.data.length; index += 4) {
        const [r1 = 0, g1 = 0, b1 = 0] = one.data.subarray(index, index + 3);
        const [r2 = 0, g2 = 0, b2 = 0] = two.data.subarray(index, index + 3);
        const y = (r1 - r2) * 0.29889531 + (g1 - g2) * 0.58662247 + (b1 - b2) * 0.11448223;
        const i = (r1 - r2) * 0.59597799 - (g1 - g2) * 0.2741761 - (b1 - b2) * 0.32180189;
        const q = (r1 - r2) * 0.21147017 - (g1 - g2) * 0.52261711 + (b1 - b2) * 0.31114694;
        if (0.5053 * y * y + 0.299 * i * i + 0.1957 * q * q > max) over += 1;
      }
      return { ratio: over / (one.width * one.height), size };
    },
    { first: a, second: b, threshold: GALLERY_THRESHOLD },
  );
}
