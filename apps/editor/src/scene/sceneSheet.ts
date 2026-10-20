// SPDX-License-Identifier: Apache-2.0
/**
 * The contact sheet of the scene page: the bridge call `sheet` of the tool `scene_sheet`. A cell is the view of a
 * document camera at a time of the page clock (a scene with a sequence). For each time and camera, the page takes the
 * camera preview of the dev core at that time. Then it composes one picture with the layout of the lab sheet
 * (core/bridge/sheetCompose.ts). The clock of the page does not change.
 */
import { cellWidth, composeSheet, MAX_CELLS, sheetColumns } from "../core/bridge/sheetCompose";
import { encodeCanvas, type PagePicture } from "./scenePicture";

/** The checked arguments of `sheet` on the scene page. */
export interface SceneSheetArgs {
  /** The times of the rows (ms); empty: the current time of the page. */
  readonly times: readonly number[];
  /** The document cameras of the columns; empty: the camera of the page. */
  readonly cameras: readonly string[];
  readonly cell: number;
  readonly maxWidth: number;
  readonly quality: number;
}

/** The result of `sheet` on the scene page. */
export interface SceneSheetResult extends PagePicture {
  /** The time of each cell (ms), or null for a scene with no sequence. */
  readonly simMs: readonly (number | null)[];
  readonly cameras: readonly string[];
  readonly take: null;
  readonly lanes: null;
}

/** The parts of the page that the sheet uses. */
export interface SheetPagePort {
  /** A picture of a document camera (null: the camera of the page) at a width (px), or null. */
  preview(camera: string | null, width: number, at?: number | null): Promise<ImageBitmap | null>;
  /** The current document camera of the page, or null. */
  camera(): string | null;
}

function numbers(value: unknown, name: string): number[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== "number" || !Number.isFinite(item) || item < 0)) {
    throw new Error(`sheet: \`${name}\` must be a list of numbers of at least 0.`);
  }
  return value.map((item: number) => Math.round(item));
}

/** Read and check the arguments of `sheet`. */
export function sceneSheetArgs(value: unknown): SceneSheetArgs {
  const args = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const times = numbers(args.times, "times");
  const cameras = Array.isArray(args.cameras) ? args.cameras.map(String).filter((name) => name !== "") : [];
  if (Math.max(1, times.length) * Math.max(1, cameras.length) > MAX_CELLS) {
    throw new Error(`sheet: at most ${String(MAX_CELLS)} cells (times × cameras).`);
  }
  const quality = args.quality === undefined ? 0.92 : Number(args.quality);
  if (!(quality >= 0 && quality <= 1)) throw new Error("sheet: the quality must be a number from 0 to 1.");
  return {
    times,
    cameras,
    cell: args.cell === undefined ? 400 : Number(args.cell),
    maxWidth: args.maxWidth === undefined ? 1600 : Number(args.maxWidth),
    quality,
  };
}

/** The label of a cell: the time (with a sequence) and the camera. */
function labelOf(time: number | null, camera: string | null): string {
  const view = camera ?? "page camera";
  return time === null ? view : `${String(time)} ms · ${view}`;
}

/**
 * Compose the sheet of the page. A time needs a sequence. Each picture takes its time from the core (a preview
 * at that time), so the clock of the page and its view do not change.
 */
export async function sceneSheet(port: SheetPagePort, raw: unknown): Promise<SceneSheetResult> {
  const args = sceneSheetArgs(raw);
  const api = globalThis.__scenity;
  if (api === undefined) throw new Error("sheet: the scene page API is not ready.");
  const time = api.time === undefined || api.seek === undefined ? undefined : () => api.time?.() ?? 0;
  if (args.times.length > 0 && time === undefined) {
    throw new Error("sheet: the scene has no sequence, so the sheet takes no times; give cameras only.");
  }
  const times: readonly (number | null)[] = args.times.length === 0 ? [time?.() ?? null] : args.times;
  const cameras: readonly (string | null)[] = args.cameras.length === 0 ? [port.camera()] : args.cameras;
  const columns = sheetColumns(times.length, cameras.length);
  const width = cellWidth(columns, args.cell, args.maxWidth);
  const cells: { bitmap: ImageBitmap; label: string }[] = [];
  const simMs: (number | null)[] = [];
  for (const at of times) {
    for (const camera of cameras) {
      const bitmap = await port.preview(camera, width, args.times.length > 0 ? at : null);
      if (bitmap === null) throw new Error(`sheet: no picture of the camera "${camera ?? "page camera"}".`);
      cells.push({ bitmap, label: labelOf(at, camera) });
      simMs.push(at);
    }
  }
  const picture = await encodeCanvas(composeSheet(cells, columns, width, null), args.quality);
  for (const cell of cells) cell.bitmap.close();
  return { ...picture, simMs, cameras: cameras.map((camera) => camera ?? "page camera"), take: null, lanes: null };
}
