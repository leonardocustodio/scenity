// SPDX-License-Identifier: Apache-2.0
/**
 * The tools that read the frame index: `lab_frame` and `lab_sheet` answer from the index of the host when the key of
 * the call is there. They render only on a miss.
 *
 * The key: the visible lab gives the input of a frame of its state (the bridge call `indexInput`, with the time and
 * the camera of the call), and `frameKey` of `@scenity/labs-platform` hashes it, as the readers and the queue do. A
 * call that changes the scene first (a take, an item, events, tunes, debug layers) does not use the index. A miss of
 * `lab_frame` keeps its picture in the index at its width (a 1280 px frame on demand).
 */
import { frameKey, isFrameKey, type FrameKeyInput } from "@scenity/labs-platform/frameKey";
import { metricsList, metricsRecord, type IndexMetric } from "@scenity/labs-platform/indexRead";
import { INDEX_MIMES, type IndexMime } from "@scenity/labs-platform/indexStore";
import { sheetPicture } from "@scenity/labs-platform/rasterBun";
import type { Capture } from "../protocol";
import type { SurfacePort, ToolContext, ToolIndex } from "./context";
import { call, imageContent, isObject, number, record, text, type ToolResult } from "./kit";

/** The fields of a call that change the scene before the frame: such a call does not use the index. */
export interface SceneChanges {
  readonly take?: unknown;
  readonly item?: unknown;
  readonly rec?: unknown;
  readonly tune?: unknown;
  readonly debug?: unknown;
}

/** True when a call changes the scene first. */
export function changesScene(input: SceneChanges): boolean {
  return [input.take, input.item, input.rec, input.tune, input.debug].some((value) => value !== undefined);
}

/** A frame input of the bridge (`indexInput`), or null for another value. */
export function frameInputOf(value: unknown): FrameKeyInput | null {
  if (!isObject(value)) return null;
  const { source, events, timeMs, tier, contentHash, renderer, tunes } = value;
  if (typeof source !== "string" || !Array.isArray(events) || typeof timeMs !== "number") return null;
  if (typeof tier !== "string" || !isFrameKey(contentHash) || !isObject(renderer) || typeof tunes !== "object") {
    return null;
  }
  return value as unknown as FrameKeyInput;
}

/** The input of a frame of the state of a lab frame at a time and a camera, or null (no index in the page). */
export async function portInputAt(port: SurfacePort, timeMs: number, camera?: string): Promise<FrameKeyInput | null> {
  try {
    const target = camera === undefined ? { t: timeMs } : { t: timeMs, camera };
    return frameInputOf(await call(port, "indexInput", [target]));
  } catch {
    // A lab page of an older checkout has no `indexInput`: no index.
    return null;
  }
}

/** The input of a frame of the visible lab state at a time and a camera, or null (no index in the page). */
export async function indexInputAt(ctx: ToolContext, timeMs: number, camera?: string): Promise<FrameKeyInput | null> {
  if (ctx.index === undefined) return null;
  return portInputAt(ctx.surface("visible"), timeMs, camera);
}

/** The metric values of a frame of the index in the shape of `measure` (the lines of `lab_frame`). */
export function metricValuesOf(record: Readonly<Record<string, number>> | null): IndexMetric[] {
  return metricsList(record);
}

/** Keep the picture of a `lab_frame` miss in the index (on demand); no error when it fails. */
export async function keepFrame(
  ctx: ToolContext,
  input: FrameKeyInput,
  shot: Capture,
  metrics: readonly unknown[],
): Promise<void> {
  if (ctx.index === undefined || !Object.hasOwn(INDEX_MIMES, shot.mime)) return;
  const values = metrics
    .map(record)
    .filter((item) => typeof item.metric === "string" && typeof item.value === "number")
    .map((item) => ({
      metric: item.metric as string,
      member: text(item.member),
      value: item.value as number,
      unit: text(item.unit) ?? "",
    }));
  try {
    await ctx.index.put({
      input,
      size: shot.width,
      mime: shot.mime,
      bytes: shot.bytes,
      metrics: metricsRecord(values),
    });
  } catch {
    // The index is a cache: a failed write changes no answer.
  }
}

/** The cells of a sheet from the index: every time × camera at one size, or null on any miss. */
async function sheetCells(
  index: ToolIndex,
  base: FrameKeyInput,
  times: readonly number[],
  cameras: readonly (string | null)[],
  size: number,
): Promise<{ bytes: Uint8Array; label: string; aspect: number }[] | null> {
  const cells = [];
  for (const at of times) {
    for (const camera of cameras) {
      const input: FrameKeyInput = { ...base, timeMs: at, view: camera ?? base.view };
      const hit = await index.get(frameKey(input), size);
      if (hit === null) return null;
      const label = `${String(at)} ms${cameras.length > 1 && camera !== null ? ` · ${camera}` : ""}`;
      cells.push({ bytes: hit.bytes, label, aspect: 16 / 10 });
    }
  }
  return cells;
}

/** The sizes of the index from small to large; a sheet takes the smallest one at least as wide as its cells. */
const SHEET_SIZES = [160, 640, 1280] as const;

/** A sheet of the index: the picture, the input of the frame at time 0 and the time it took (ms). */
export interface IndexSheet {
  /** A JPEG picture. */
  readonly bytes: Uint8Array;
  readonly width: number;
  readonly height: number;
  readonly base: FrameKeyInput;
  readonly ms: number;
}

/**
 * A sheet of the times × cameras of the state of a lab frame (the visible lab, or the shadow frame of the picker) from
 * the index, or null on any miss.
 */
export async function indexSheetOf(
  index: ToolIndex,
  port: SurfacePort,
  times: readonly number[],
  cameras: readonly string[] | undefined,
  maxWidth: number,
): Promise<IndexSheet | null> {
  const start = performance.now();
  const base = times.length === 0 ? null : await portInputAt(port, 0);
  if (base === null) return null;
  const columnsOf = cameras !== undefined && cameras.length > 1 ? cameras.length : Math.min(times.length, 4);
  const cellWidth = Math.max(64, Math.floor((maxWidth - 4) / columnsOf) - 4);
  const size = SHEET_SIZES.find((item) => item >= cellWidth) ?? 1280;
  const cells = await sheetCells(index, base, times, cameras ?? [null], size);
  if (cells === null) return null;
  const sheet = await sheetPicture(cells, columnsOf, cellWidth, "jpeg");
  return { bytes: sheet.bytes, width: sheet.width, height: sheet.height, base, ms: performance.now() - start };
}

/** A sheet of the index: one picture of the times × cameras, or null on a miss. */
export async function sheetFromIndex(
  ctx: ToolContext,
  times: readonly number[],
  cameras: readonly string[] | undefined,
  maxWidth: number,
): Promise<{ readonly result: ToolResult; readonly ms: number } | null> {
  if (ctx.index === undefined) return null;
  const sheet = await indexSheetOf(ctx.index, ctx.surface("visible"), times, cameras, maxWidth);
  if (sheet === null) return null;
  const { base, ms } = sheet;
  const shown = cameras?.join(", ") ?? (typeof base.view === "string" ? base.view : "the view of the frame");
  const lines = [
    `Sheet of ${base.source} · ${String(times.length)} times ${String(times[0])}–${String(times.at(-1))} ms · cameras ${shown} · from the frame index (${ms.toFixed(0)} ms)`,
    `Picture: ${String(sheet.width)}×${String(sheet.height)} image/jpeg.`,
    "Lanes: not in the index.",
  ];
  return {
    result: {
      content: [{ type: "text", text: lines.join("\n") }, imageContent({ bytes: sheet.bytes, mime: "image/jpeg" })],
    },
    ms,
  };
}

/** The lines and the picture of a `lab_frame` hit, or null on a miss. */
export async function frameFromIndex(
  ctx: ToolContext,
  input: FrameKeyInput | null,
  width: number,
): Promise<{
  readonly simMs: number;
  readonly bytes: Uint8Array;
  readonly mime: IndexMime;
  readonly metrics: IndexMetric[];
} | null> {
  if (ctx.index === undefined || input === null) return null;
  const hit = await ctx.index.get(frameKey(input), width);
  if (hit === null) return null;
  return {
    simMs: number(hit.frame.timeMs) ?? input.timeMs,
    bytes: hit.bytes,
    mime: hit.frame.mime,
    metrics: metricValuesOf(hit.frame.metrics),
  };
}
