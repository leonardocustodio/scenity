// SPDX-License-Identifier: Apache-2.0
/**
 * The marks of point and ask: circles and arrows that the owner draws on a stopped frame. The shapes keep their
 * positions as fractions of the scene (0 to 1), so a picture of each size can show them. The workbench tool
 * `lab_marks` reads one picture (the frame with the marks on it) and the mask of the marks (the shapes in the pixels
 * of the picture). It also reads the item under each mark (a pick at the circle centre or the arrow head).
 */
import type { PickResult } from "@scenity/runtime-dev";
import { encodePicture } from "../bridge/workbenchCapture";
import type { ViewHandle } from "../useLabStats";

export type MarkKind = "circle" | "arrow";

/** A mark: a circle from its centre to a point of its edge, or an arrow from its tail to its head (fractions 0-1). */
export interface Mark {
  readonly kind: MarkKind;
  readonly from: readonly [number, number];
  readonly to: readonly [number, number];
}

/** A mark in the pixels of a picture (the mask of `lab_marks`). */
export type MaskShape =
  | { readonly kind: "circle"; readonly x: number; readonly y: number; readonly r: number }
  | { readonly kind: "arrow"; readonly x: number; readonly y: number; readonly toX: number; readonly toY: number };

/** The picture of the marks: the bytes for the bridge (moved, not copied), the mask and the description. */
export interface MarksPicture {
  readonly simMs: number | null;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  readonly bytes: ArrayBuffer;
  readonly mask: readonly MaskShape[];
  readonly description: string;
}

/** The colour and the width of the marks (CSS pixels of a 1280 px picture). */
export const MARK_COLOR = "#ff3b30";
const MARK_WIDTH = 4;

/** The point of a mark that a pick reads: the centre of a circle, the head of an arrow. */
export function markAnchor(mark: Mark): readonly [number, number] {
  return mark.kind === "circle" ? mark.from : mark.to;
}

/** The marks in the pixels of a picture. */
export function maskOf(marks: readonly Mark[], width: number, height: number): MaskShape[] {
  return marks.map((mark) => {
    const [x, y] = [mark.from[0] * width, mark.from[1] * height];
    const [toX, toY] = [mark.to[0] * width, mark.to[1] * height];
    return mark.kind === "circle"
      ? { kind: "circle", x, y, r: Math.hypot(toX - x, toY - y) }
      : { kind: "arrow", x, y, toX, toY };
  });
}

/** Draw the marks on a 2D context of a picture. */
export function drawMarks(context: OffscreenCanvasRenderingContext2D, mask: readonly MaskShape[], scale: number): void {
  context.strokeStyle = MARK_COLOR;
  context.lineWidth = MARK_WIDTH * scale;
  context.lineCap = "round";
  for (const shape of mask) {
    context.beginPath();
    if (shape.kind === "circle") {
      context.arc(shape.x, shape.y, Math.max(2, shape.r), 0, Math.PI * 2);
    } else {
      const angle = Math.atan2(shape.toY - shape.y, shape.toX - shape.x);
      const head = 18 * scale;
      context.moveTo(shape.x, shape.y);
      context.lineTo(shape.toX, shape.toY);
      context.moveTo(shape.toX - head * Math.cos(angle - 0.45), shape.toY - head * Math.sin(angle - 0.45));
      context.lineTo(shape.toX, shape.toY);
      context.lineTo(shape.toX - head * Math.cos(angle + 0.45), shape.toY - head * Math.sin(angle + 0.45));
    }
    context.stroke();
  }
}

/** The description of the marks: each mark, its position, and the item under it. */
export function describeMarks(marks: readonly Mark[], picks: readonly (PickResult | null)[]): string {
  if (marks.length === 0) return "No marks.";
  return marks
    .map((mark, index) => {
      const [x, y] = markAnchor(mark).map((share) => Math.round(share * 100));
      const pick = picks[index] ?? null;
      const what =
        pick === null
          ? "nothing under it"
          : `${pick.kind} ${pick.id}${pick.bone === null ? "" : ` (bone ${pick.bone})`}${
              pick.near.length === 0 ? "" : `, near ${pick.near.map((near) => near.name).join(", ")}`
            }`;
      const shape = mark.kind === "circle" ? "a circle round" : "an arrow that points at";
      return `Mark ${String(index + 1)}: ${shape} ${String(x)} % across, ${String(y)} % down: ${what}.`;
    })
    .join("\n");
}

/**
 * The picture of the marks: the current frame of the scene (a capture, without the selection outline) with the marks
 * on it, and the item under each mark. `size` is the CSS size of the scene, for the picks.
 */
export async function marksPicture(
  view: ViewHandle | null,
  marks: readonly Mark[],
  size: { readonly width: number; readonly height: number },
  width = 1280,
): Promise<MarksPicture> {
  if (view === null) throw new Error("marks: the lab has no 3D view now.");
  const shot = await view.capture(width);
  const bitmap = shot?.bitmap ?? null;
  if (bitmap === null) throw new Error("marks: the scene gave no picture.");
  const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("marks: the page has no 2D context.");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();
  const mask = maskOf(marks, canvas.width, canvas.height);
  drawMarks(context, mask, canvas.width / 1280);
  const picks = await Promise.all(
    marks.map((mark) => {
      const [x, y] = markAnchor(mark);
      return view.pick?.(x * size.width, y * size.height) ?? Promise.resolve(null);
    }),
  );
  const blob = await encodePicture((type, quality) => canvas.convertToBlob({ type, quality }), 0.9);
  return {
    simMs: shot?.simMs ?? null,
    width: canvas.width,
    height: canvas.height,
    mime: blob.type === "" ? "image/webp" : blob.type,
    bytes: await blob.arrayBuffer(),
    mask,
    description: describeMarks(marks, picks),
  };
}
