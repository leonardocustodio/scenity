// SPDX-License-Identifier: Apache-2.0
/**
 * The tool `lab_sheet`: a contact sheet over a window of the take, from the shadow frame. Thus the clock of the
 * owner's frame does not move. The bridge call `sheet` (apps/editor/src/core/bridge/workbenchSheet.ts) seeks, draws
 * and captures each cell. It makes one picture in the page, with the layout of `bun run labs sheet`. The tool gives
 * that one picture and the clip lanes of the window.
 */
import { z } from "zod";
import { isCaptureMime } from "../protocol";
import type { SurfacePort } from "./context";
import {
  call,
  defineTool,
  FRAME_TIMEOUT_MS,
  imageContent,
  list,
  number,
  pictureBytes,
  record,
  text,
  type ToolResult,
} from "./kit";
import { MAX_IMAGE_WIDTH } from "./frame";
import { sheetFromIndex } from "./indexTools";

/** The most cells of a sheet (workbenchSheet.ts `MAX_CELLS`). */
export const MAX_SHEET_CELLS = 64;
/** The widest sheet: the width of `labs sheet` (1600 px). The default stays MAX_IMAGE_WIDTH. */
export const MAX_SHEET_WIDTH = 1600;

/** The times of a window: from `from` to `to` in steps of `step` (the range of `labs sheet`). */
export function sheetTimes(from: number, to: number, step: number): number[] {
  if (!(step > 0) || to < from) throw new Error("lab_sheet: the window must go forward with a step above 0.");
  const times: number[] = [];
  for (let at = from; at <= to + 0.5; at += step) times.push(Math.round(at));
  return times;
}

/** The step of an item window: about 16 frames. */
export function itemStep(from: number, to: number): number {
  return Math.max(20, Math.round((to - from) / 15));
}

/** The clip lanes of the sheet result as text: one line per member, at most 6 parts each. */
export function laneLines(lanes: unknown): string[] {
  const data = record(lanes);
  const rows = list(data.rows).map(record);
  if (rows.length === 0) return ["Lanes: none (panel events after the take, or a view track)."];
  return [
    `Lanes ${String(number(data.from) ?? "?")}–${String(number(data.to) ?? "?")} ms:`,
    ...rows.map((row) => {
      const parts = list(row.parts).map(record);
      const shown = parts
        .slice(0, 6)
        .map((part) => `${text(part.label) ?? "?"} ${String(number(part.from))}–${String(number(part.to))}`);
      return `  ${text(row.member) ?? "?"}: ${shown.join(", ")}${parts.length > 6 ? ", …" : ""}`;
    }),
  ];
}

/** The window of the open item of the shadow (`item` call), or null. */
async function itemWindow(port: SurfacePort): Promise<{ from: number; to: number; camera: string | null } | null> {
  const scene = record(record(await call(port, "item")).scene);
  const window = record(scene.window);
  const from = number(window.from);
  const to = number(window.to);
  if (from === null || to === null) return null;
  return { from, to, camera: text(scene.camera) };
}

const sheetInput = z.object({
  from: z.number().int().min(0).optional().describe("The first time of the window in ms (default: the item window)."),
  to: z.number().int().min(0).optional().describe("The last time of the window in ms (default: the item window)."),
  step: z.number().int().min(10).optional().describe("The step in ms (default 250; 16 frames for an item window)."),
  cameras: z
    .array(z.string())
    .max(4)
    .optional()
    .describe("Named cameras, one column each (default: the camera of the frame or of the item)."),
  item: z.string().optional().describe("Open an item of the content browser first: its take, events and window."),
  width: z
    .number()
    .int()
    .min(320)
    .max(MAX_SHEET_WIDTH)
    .optional()
    .describe(
      `The largest width of the sheet in px (default ${String(MAX_IMAGE_WIDTH)}; 1600 is the labs sheet size).`,
    ),
  panes: z
    .boolean()
    .optional()
    .describe(
      "One column per pane of the split screen of the lab (`panes` in the URL), from one render per time; " +
        "`cameras` then does not apply.",
    ),
  onion: z
    .boolean()
    .optional()
    .describe(
      "The onion skin in each cell (faint copies of the members before and after each time, blue and " +
        "orange). Default: no onion skin.",
    ),
});

export const labSheet = defineTool({
  name: "lab_sheet",
  description:
    "A contact sheet of a window of the take, from a hidden shadow frame (the owner's frame does not move): one " +
    "picture with a cell per time (and per camera), the labels and the clip lanes, as `bun run labs sheet` draws it. " +
    "Give from and to (ms), or an item of the content browser for its window.",
  input: sheetInput,
  alwaysLoad: false,
  async handler(input, ctx): Promise<ToolResult> {
    const port = ctx.surface("shadow");
    let cameras = input.cameras;
    let window = input.from !== undefined && input.to !== undefined ? { from: input.from, to: input.to } : null;
    let step = input.step ?? 250;
    if (input.item !== undefined) {
      const opened = await call(port, "open", [input.item, { play: false }]);
      if (opened === false) throw new Error(`open: the item "${input.item}" has no scene in the lab.`);
      const scene = await itemWindow(port);
      if (window === null && scene !== null) {
        window = { from: scene.from, to: scene.to };
        step = input.step ?? itemStep(scene.from, scene.to);
      }
      if (cameras === undefined && scene?.camera !== null && scene?.camera !== undefined) cameras = [scene.camera];
    }
    if (window === null) throw new Error("lab_sheet: give from and to, or an item with a window.");
    const times = sheetTimes(window.from, window.to, step);
    if (times.length * (cameras?.length ?? 1) > MAX_SHEET_CELLS) {
      throw new Error(`lab_sheet: at most ${String(MAX_SHEET_CELLS)} cells (times × cameras); use a larger step.`);
    }
    // The current scene (no item) comes from the frame index: no shadow frame, no seek, no render on a hit.
    // The frame index has no onion skin and no panes.
    const fromIndex = input.item === undefined && input.panes !== true && input.onion !== true;
    const indexed = fromIndex ? await sheetFromIndex(ctx, times, cameras, input.width ?? MAX_IMAGE_WIDTH) : null;
    if (indexed !== null) return indexed.result;
    const args = {
      times,
      maxWidth: input.width ?? MAX_IMAGE_WIDTH,
      ...(cameras === undefined ? {} : { cameras }),
      ...(input.panes === true ? { panes: true } : {}),
      ...(input.onion === true ? { onion: true } : {}),
    };
    const sheet = record(await call(port, "sheet", [args], FRAME_TIMEOUT_MS * 4));
    // The bytes of the binary frame. Base64 occurs only in the tool result.
    const bytes = pictureBytes(sheet);
    const mime = isCaptureMime(sheet.mime) ? sheet.mime : "image/webp";
    if (bytes === null) throw new Error("sheet: the shadow frame gave no picture.");
    const shown = list(sheet.cameras).map(text).join(", ");
    const lines = [
      `Sheet of take ${text(sheet.take) ?? "?"} · ${String(times.length)} times ${String(times[0])}–${String(times.at(-1))} ms (step ${String(step)}) · cameras ${shown} · shadow frame`,
      `Picture: ${String(number(sheet.width))}×${String(number(sheet.height))} ${mime}.`,
      ...laneLines(sheet.lanes),
    ];
    return { content: [{ type: "text", text: lines.join("\n") }, imageContent({ bytes, mime })] };
  },
});
