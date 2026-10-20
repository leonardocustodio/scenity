// SPDX-License-Identifier: Apache-2.0
/**
 * A region of the Scene view for the agent. The person drags a box over the view: Escape cancels, and a click with no
 * box takes the full view. The page crops a picture of the view to that box. The picture is the `@view` preview of the
 * dev core: the camera that draws, with no dev layer.
 */
import { t } from "../../texts";

/** A region of an element as shares of its size (0 to 1). */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The whole element. */
export const WHOLE: Region = { x: 0, y: 0, width: 1, height: 1 };
/** The smallest box (CSS pixels): a smaller drag takes the whole view. */
const MIN_BOX_PX = 6;

/** The box of a drag from one point to another in an element box, as shares. A short drag gives the full box. */
export function regionOf(box: DOMRect, from: { x: number; y: number }, to: { x: number; y: number }): Region {
  const left = Math.max(box.left, Math.min(from.x, to.x));
  const top = Math.max(box.top, Math.min(from.y, to.y));
  const right = Math.min(box.right, Math.max(from.x, to.x));
  const bottom = Math.min(box.bottom, Math.max(from.y, to.y));
  if (right - left < MIN_BOX_PX || bottom - top < MIN_BOX_PX) return WHOLE;
  return {
    x: (left - box.left) / box.width,
    y: (top - box.top) / box.height,
    width: (right - left) / box.width,
    height: (bottom - top) / box.height,
  };
}

/** Let the person drag a box over an element. Return the region, or null after Escape. */
export function pickRegion(target: HTMLElement): Promise<Region | null> {
  const box = target.getBoundingClientRect();
  const layer = document.createElement("div");
  layer.className = "agent-region-layer";
  layer.dataset.testid = "agent-region";
  layer.setAttribute("role", "application");
  layer.setAttribute("aria-label", t("agent-region-hint"));
  layer.tabIndex = -1;
  Object.assign(layer.style, {
    left: `${String(box.left)}px`,
    top: `${String(box.top)}px`,
    width: `${String(box.width)}px`,
    height: `${String(box.height)}px`,
  });
  const frame = document.createElement("div");
  frame.className = "agent-region-box";
  const hint = document.createElement("p");
  hint.className = "agent-region-hint";
  hint.textContent = t("agent-region-hint");
  layer.append(frame, hint);
  document.body.append(layer);
  layer.focus();
  return new Promise((resolve) => {
    let start: { x: number; y: number } | null = null;
    const done = (region: Region | null): void => {
      layer.remove();
      resolve(region);
    };
    layer.addEventListener("keydown", (event) => {
      if (event.key === "Escape") done(null);
    });
    layer.addEventListener("pointerdown", (event) => {
      start = { x: event.clientX, y: event.clientY };
      layer.setPointerCapture(event.pointerId);
    });
    layer.addEventListener("pointermove", (event) => {
      if (start === null) return;
      const region = regionOf(box, start, { x: event.clientX, y: event.clientY });
      Object.assign(frame.style, {
        left: `${String(region.x * 100)}%`,
        top: `${String(region.y * 100)}%`,
        width: `${String(region.width * 100)}%`,
        height: `${String(region.height * 100)}%`,
      });
    });
    layer.addEventListener("pointerup", (event) => {
      done(start === null ? WHOLE : regionOf(box, start, { x: event.clientX, y: event.clientY }));
    });
  });
}

/** The picture of a region of a bitmap, as WebP (or PNG where the browser has no WebP encoder). */
export async function cropPicture(bitmap: ImageBitmap, region: Region): Promise<Blob> {
  const x = Math.round(region.x * bitmap.width);
  const y = Math.round(region.y * bitmap.height);
  const width = Math.max(1, Math.round(region.width * bitmap.width));
  const height = Math.max(1, Math.round(region.height * bitmap.height));
  const canvas = new OffscreenCanvas(width, height);
  canvas.getContext("2d")?.drawImage(bitmap, x, y, width, height, 0, 0, width, height);
  const webp = await canvas.convertToBlob({ type: "image/webp", quality: 0.85 });
  return webp.type === "image/webp" ? webp : canvas.convertToBlob({ type: "image/png" });
}
