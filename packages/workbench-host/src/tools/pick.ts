// SPDX-License-Identifier: Apache-2.0
/**
 * The point-and-ask tools:
 *
 * - `lab_pick`: what is under a point of the lab frame (CSS pixels of the scene), or without a point the item that the
 *   owner selected: the item, the bone, the hit point, the near work points and the files behind it.
 * - `lab_marks`: the marks that the owner drew on a stopped frame: one picture (the frame with the marks over it), kept
 *   in the picture store of the host by ID, the mask of the marks (the shapes in the pixels of the picture) and the
 *   item under each mark.
 */
import { z } from "zod";
import { isCaptureMime } from "../protocol";
import { withoutDenied } from "../denylist";
import type { ToolContext } from "./context";
import { whereInput } from "./frame";
import {
  call,
  defineTool,
  FRAME_TIMEOUT_MS,
  imageContent,
  number,
  pictureBytes,
  portOf,
  record,
  text,
  textResult,
} from "./kit";
import type { ToolResult } from "./kit";
import { pickedBlock, pickedFileLines } from "./picked";

/** The lines of a pick result of the lab (`pick` of the lab API). */
export function pickLines(checkout: string, value: unknown): string[] {
  const result = record(value);
  const kind = text(result.kind);
  const id = text(result.id);
  if (kind === null || id === null) return ["Nothing under the point."];
  const bone = text(result.bone);
  const point = Array.isArray(result.point) ? result.point.map((item) => Number(Number(item).toFixed(3))) : [];
  const near = Array.isArray(result.near)
    ? result.near
        .map(record)
        .map((item) => `${text(item.name) ?? "?"} (${((number(item.distance) ?? 0) * 100).toFixed(1)} cm)`)
    : [];
  const lines = [
    `Picked: ${kind} ${id}${bone === null ? "" : `, bone ${bone}`} (object ${text(result.object) ?? "?"})`,
    `  hit point: ${point.join(", ")}; distance ${(number(result.distance) ?? 0).toFixed(2)} m`,
  ];
  if (near.length > 0) lines.push(`  near: ${near.join(", ")}`);
  const files = pickedFileLines(checkout, { kind, id });
  return [...lines, ...files.slice(files[0]?.endsWith(":") === true ? 1 : 0)];
}

export const labPick = defineTool({
  name: "lab_pick",
  description:
    "What is under a point of the lab frame (x, y in CSS pixels of the scene from its top left corner): the item " +
    "(a prop, a device, a member with the bone, …), the hit point, the near work points and the files behind it. " +
    "Without x and y: the item that the owner selected (the picked block of the packet).",
  input: z.object({
    x: z.number().min(0).optional().describe("The point across the scene (CSS pixels)."),
    y: z.number().min(0).optional().describe("The point down the scene (CSS pixels)."),
    pane: z.number().int().min(0).max(3).optional().describe("The pane of the split screen (default 0)."),
    where: whereInput,
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = portOf(ctx, input.where);
    if (input.x === undefined || input.y === undefined) {
      const picked = await call(port, "picked");
      const lines = pickedBlock(ctx.checkout, picked);
      return textResult(withoutDenied(lines.length === 0 ? ["The owner has no selection. Give x and y."] : lines));
    }
    const result = await call(port, "pick", [input.x, input.y, input.pane ?? 0]);
    return textResult(withoutDenied(pickLines(ctx.checkout, result)));
  },
});

/** The words of the mask: each shape in the pixels of the picture. */
function maskText(mask: unknown): string {
  if (!Array.isArray(mask)) return "";
  return mask
    .map(record)
    .map((shape, index) =>
      shape.kind === "circle"
        ? `${String(index + 1)}: circle at ${String(Math.round(number(shape.x) ?? 0))}, ${String(Math.round(number(shape.y) ?? 0))} r ${String(Math.round(number(shape.r) ?? 0))}`
        : `${String(index + 1)}: arrow ${String(Math.round(number(shape.x) ?? 0))}, ${String(Math.round(number(shape.y) ?? 0))} → ${String(Math.round(number(shape.toX) ?? 0))}, ${String(Math.round(number(shape.toY) ?? 0))}`,
    )
    .join("; ");
}

/** The result of `lab_marks` from the answer of the lab (`marks`). */
export function marksResult(ctx: Pick<ToolContext, "pictures">, value: unknown): ToolResult {
  if (value === null || value === undefined)
    return textResult("The owner drew no marks (the Mark button of the card).");
  const item = record(value);
  const bytes = pictureBytes(item);
  const mime = item.mime;
  if (bytes === null || !isCaptureMime(mime)) return textResult("The marks gave no picture.");
  const id = ctx.pictures?.put(bytes, mime) ?? null;
  const lines = [
    `Marks picture${id === null ? "" : ` ${id}`}: ${String(number(item.width) ?? 0)}×${String(number(item.height) ?? 0)} at ${String(number(item.simMs) ?? "?")} ms.`,
    `Mask (pixels of the picture): ${maskText(item.mask)}`,
    text(item.description) ?? "",
  ];
  return { content: [{ type: "text", text: lines.join("\n") }, imageContent({ bytes, mime })] };
}

export const labMarks = defineTool({
  name: "lab_marks",
  description:
    "The marks (circles, arrows) that the owner drew on the stopped lab frame: one picture of the frame with the marks, " +
    "its ID in the picture store, the mask of the marks and the item under each mark.",
  input: z.object({
    width: z.number().int().min(160).max(1600).optional().describe("The width of the picture (default 1280)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const value = await call(ctx.surface("visible"), "marks", [input.width ?? 1280], FRAME_TIMEOUT_MS);
    return marksResult(ctx, value);
  },
});
