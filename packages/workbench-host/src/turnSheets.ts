// SPDX-License-Identifier: Apache-2.0
/**
 * The sheets of a turn: a one-row contact sheet of the turn window before the edits and one after them. They come from
 * the shadow frame, so the clock of the owner's frame does not move. The panel shows the two rows one over the other:
 * the motion before and after, next to the single before and after pictures.
 *
 * The window is the window of the open item of the content browser, else ±2 s round the time of the turn start. The
 * bridge call `sheet` (apps/editor/src/core/bridge/workbenchSheet.ts) composes the sheet in the page with the layout of
 * `labs sheet`: four times give one row.
 */
import { isCaptureMime, type Capture, type TurnWindow } from "./protocol";
import type { SurfacePort } from "./tools/context";
import { call, captureOf, FRAME_TIMEOUT_MS, labUrlFacts, number, record, text } from "./tools/kit";

/** The half width of the window round the time of the turn (ms). */
export const TURN_SPAN_MS = 2_000;
/** The count of cells of a turn sheet: one row of `labs sheet` (four times per row). */
export const TURN_SHEET_CELLS = 4;
/** The largest width of a turn sheet (px). */
export const TURN_SHEET_WIDTH = 1280;

/** `count` times from `from` to `to`, both ends included, rounded to whole ms. */
export function spread(from: number, to: number, count = TURN_SHEET_CELLS): number[] {
  if (count <= 1 || to <= from) return [Math.round(from)];
  return Array.from({ length: count }, (_value, index) => Math.round(from + ((to - from) * index) / (count - 1)));
}

/** The named camera of a URL state for a sheet, or null for a free view. */
export function sheetCamera(url: string | null): string | null {
  const camera = labUrlFacts(url).camera;
  return camera.startsWith("view ") ? null : camera;
}

/** The window of the open item of a frame (the lab API `item`), or null. */
async function itemWindow(port: SurfacePort): Promise<{ from: number; to: number } | null> {
  const scene = record(record(await call(port, "item")).scene);
  const window = record(scene.window);
  const from = number(window.from);
  const to = number(window.to);
  return from === null || to === null || to <= from ? null : { from, to };
}

/**
 * The window of the sheets of a turn: the item window of the shadow frame (it has the URL state of the visible
 * frame), else ±TURN_SPAN_MS round the time of the URL state (or the clock of the shadow).
 */
export async function turnWindow(port: SurfacePort, url: string | null): Promise<TurnWindow> {
  const camera = sheetCamera(url);
  const facts = labUrlFacts(url);
  const item = facts.item === null ? null : await itemWindow(port).catch(() => null);
  if (item !== null) return { ...item, times: spread(item.from, item.to), camera, source: "item" };
  const at = facts.t ?? number(await call(port, "time").catch(() => null)) ?? 0;
  const from = Math.max(0, Math.round(at - TURN_SPAN_MS));
  const to = Math.round(at + TURN_SPAN_MS);
  return { from, to, times: spread(from, to), camera, source: "time" };
}

/** One sheet of the window from a frame (the shadow): the bridge call `sheet`. */
export async function turnSheet(port: SurfacePort, window: TurnWindow): Promise<Capture> {
  const args = {
    times: [...window.times],
    maxWidth: TURN_SHEET_WIDTH,
    ...(window.camera === null ? {} : { cameras: [window.camera] }),
  };
  const sheet = record(await call(port, "sheet", [args], FRAME_TIMEOUT_MS * 2));
  if (!isCaptureMime(sheet.mime)) {
    throw new Error(`sheet: the frame gave a picture of the type ${String(text(sheet.mime))}.`);
  }
  // The bytes of the binary frame.
  return captureOf({ ...sheet, simMs: null });
}
