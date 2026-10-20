// SPDX-License-Identifier: Apache-2.0
/**
 * The `sheet` call of the workbench bridge: a contact sheet of a time window of the take, made in the page. The host
 * sends the call to the hidden shadow frame, so the clock of the visible frame does not move. For each time and each
 * camera, the call seeks the clock, waits for the frame and captures it. Then it composes one picture in an
 * OffscreenCanvas.
 *
 * The layout, the labels and the clip lanes are the same as those of `labs sheet` (the lab CLI of the plugin,
 * scripts/lab/shooter.ts `Shooter.sheet`). A change of the layout here needs the same change there.
 */
import { paneCount, parsePaneLayout, type PaneLayout } from "@scenity/runtime-dev";
import type { LabOnionApi } from "../editor/useOnion";
import { paneCells } from "../panes/paneSheet";
import { defaultCams, parseCams } from "../panes/paneUrl";
import type { Room3DLabApi } from "../useLabApi";
import type { ViewHandle } from "../useLabStats";
import type { Lanes } from "../lanes";
import { memberLabel, momentsOf, takeLanesIn, takeNamed } from "../sequence";
import { encodePicture } from "./workbenchCapture";
import { cellWidth, composeSheet, MAX_CELLS, sheetColumns, type SheetLanes } from "./sheetCompose";

export { cellWidth, composeSheet, MAX_CELLS, sheetColumns, type SheetLanes } from "./sheetCompose";

/** The arguments of `sheet` (one object). */
export interface SheetArgs {
  /** The times of the rows (ms), at most MAX_CELLS cells with the cameras. */
  readonly times: readonly number[];
  /** The named cameras: one column each. The default is the camera of the URL, else "overview". */
  readonly cameras?: readonly string[];
  /** The largest width of a cell (px). The default is 400, as `labs sheet --cell`. */
  readonly cell?: number;
  /** The largest width of the sheet (px). The default is 1600, as `labs sheet`. */
  readonly maxWidth?: number;
  /** The WebP quality from 0 to 1. The default is 0.92. */
  readonly quality?: number;
  /**
   * One column for each pane of the split screen of the URL (`panes`, `cams`), from one render for each time. Then
   * `cameras` does not apply. Without panes in the URL, the sheet has the cameras.
   */
  readonly panes?: boolean;
  /**
   * True shows the onion skin in each cell (the capture mode of the onion skin, on a stopped clock). After the sheet,
   * the page gets its initial onion skin again.
   */
  readonly onion?: boolean;
}

/** The result of `sheet`. */
export interface SheetResult {
  readonly width: number;
  readonly height: number;
  /** "image/webp". A browser without a WebP encoder (WebKit) gives "image/jpeg". */
  readonly mime: string;
  /** The bytes of the picture. The bridge moves the buffer to the page (no base64). */
  readonly bytes: ArrayBuffer;
  /** The drawn time of each cell. */
  readonly simMs: readonly (number | null)[];
  readonly take: string | null;
  readonly cameras: readonly string[];
  /** The clip lanes of the window, or null (panel events after the take, or a view track). */
  readonly lanes: SheetLanes | null;
}

/**
 * The label of a time: `13000-compression` for a named moment of the take, else `13000` (as `label` of the lab CLI).
 * The caller gives the moments of the take (`momentsOf`), so a tool can use this function without the plugin of the
 * page.
 */
export function timeLabel(moments: Readonly<Record<string, number>>, ms: number): string {
  const named = Object.entries(moments).find(([, at]) => at === ms)?.[0];
  return named === undefined ? String(ms) : `${String(ms)}-${named}`;
}

/**
 * The lanes of a sheet: one row for each member with the clip (or the family) of each part (as the lab CLI). The row
 * has the short name of the member from the rule of the plugin (`memberLabel`).
 */
export function sheetLanes(lanes: Lanes, from: number, to: number): SheetLanes | null {
  const rows = Object.entries(lanes)
    .filter(([, lane]) => lane.length > 0)
    .map(([member, lane]) => ({
      member: memberLabel(member),
      parts: lane.map((part) => ({
        label: (part.clip ?? part.family).replace(/^clip_/, ""),
        family: part.family,
        from: part.from,
        to: part.to,
        clip: part.clip !== null,
      })),
    }));
  return rows.length === 0 || to <= from ? null : { from, to, rows };
}

/** Read and check the arguments of `sheet`. */
export function sheetArgs(value: unknown): Required<Omit<SheetArgs, "cameras">> & { cameras: string[] | null } {
  const args = (typeof value === "object" && value !== null ? value : {}) as Record<string, unknown>;
  const times = Array.isArray(args.times) ? args.times.map(Number) : [];
  if (times.length === 0 || times.some((at) => !Number.isFinite(at) || at < 0)) {
    throw new Error("sheet: `times` must be a list of times (ms) of at least one item.");
  }
  const cameras = Array.isArray(args.cameras) ? args.cameras.map(String) : null;
  if ((cameras?.length ?? 1) * times.length > MAX_CELLS) {
    throw new Error(`sheet: at most ${String(MAX_CELLS)} cells (times × cameras); use a larger step.`);
  }
  const quality = args.quality === undefined ? 0.92 : Number(args.quality);
  if (!(quality >= 0 && quality <= 1)) throw new Error("sheet: the quality must be a number from 0 to 1.");
  return {
    times: times.map(Math.round),
    cameras: cameras === null || cameras.length === 0 ? null : cameras,
    cell: args.cell === undefined ? 400 : Number(args.cell),
    maxWidth: args.maxWidth === undefined ? 1600 : Number(args.maxWidth),
    quality,
    panes: args.panes === true,
    onion: args.onion === true,
  };
}

/** The split screen of the URL for a sheet with `panes`: the layout and the camera label of each pane. */
function sheetPanes(query: URLSearchParams, times: number): { layout: PaneLayout; labels: string[] } | null {
  const layout = parsePaneLayout(query.get("panes"));
  if (layout === null || layout === "1") return null;
  const cams = parseCams(query.get("cams"));
  const main = query.get("camera") ?? (query.has("view") ? "free view" : "overview");
  const labels = Array.from({ length: paneCount(layout) }, (_, pane) => {
    const cam = cams[pane] ?? (pane === 0 ? null : defaultCams()[pane - 1]);
    if (cam == null) return main;
    return cam.name ?? "free view";
  });
  if (labels.length * times > MAX_CELLS) {
    throw new Error(`sheet: at most ${String(MAX_CELLS)} cells (times × panes); use a larger step.`);
  }
  return { layout, labels };
}

/** The lanes of the window when the scene is the plain take; null with panel events or another source. */
function windowLanes(lab: Room3DLabApi, take: string | null, from: number, to: number): SheetLanes | null {
  const plain = takeNamed(take);
  if (take === null || plain === undefined || lab.source() !== "take") return null;
  if (lab.events().length > plain.events.length) return null;
  return sheetLanes(takeLanesIn(take, from, to), from, to);
}

/**
 * The longest wait for the first frame of a sheet (ms). A cold shadow frame loads its scene and its assets first.
 * Each subsequent frame gets CELL_FRAME_MS.
 */
export const FIRST_FRAME_MS = 90_000;
export const CELL_FRAME_MS = 15_000;

/**
 * Wait for a drawn frame for a maximum of `timeoutMs`. A hidden page draws no frame, so the call fails immediately. A
 * page that draws nothing (a window behind others in WebKit, a minimized window) fails after the time with a clear
 * reason. It does not wait for the long time limit of the host.
 */
export async function frameWithin(
  lab: Pick<Room3DLabApi, "frame">,
  timeoutMs: number,
  page: { readonly visibilityState?: string } = globalThis.document,
): Promise<void> {
  if (page.visibilityState === "hidden") {
    throw new Error("sheet: the page is hidden, so the browser draws no frame. Show the workbench window.");
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const late = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(
        new Error(
          `sheet: no frame in ${String(timeoutMs)} ms. The frame draws nothing while its window is hidden, ` +
            "minimized or behind other windows.",
        ),
      );
    }, timeoutMs + 1_000);
  });
  try {
    await Promise.race([lab.frame(timeoutMs), late]);
  } finally {
    clearTimeout(timer);
  }
}

/** The window parts of the call (a test gives a fake). */
export interface SheetPage {
  readonly href: string;
}

/**
 * Run `sheet`: seek, wait for the frame and capture each cell, and compose the sheet. Then restore the clock and the
 * camera. The call changes the frame where it runs, so the host sends it to the shadow frame.
 */
export async function sheetCall(
  lab: Room3DLabApi | undefined,
  view: ViewHandle | null,
  value: unknown,
  page: SheetPage = globalThis.location,
): Promise<SheetResult> {
  if (lab === undefined) throw new Error("The lab API is not ready.");
  if (view === null) throw new Error("sheet: the lab has no 3D view now.");
  const args = sheetArgs(value);
  const query = new URL(page.href).searchParams;
  const take = query.get("take") ?? query.get("preset");
  const startCamera = query.get("camera");
  const split = args.panes ? sheetPanes(query, args.times.length) : null;
  const cameras = split?.labels ?? args.cameras ?? [startCamera ?? "overview"];
  const columns = sheetColumns(args.times.length, cameras.length);
  const width = cellWidth(columns, args.cell, args.maxWidth);
  const start = lab.time();
  // The onion skin in each cell needs a stopped clock and the capture mode.
  const onionApi = lab as Room3DLabApi & Partial<LabOnionApi>;
  const onion = args.onion ? (onionApi.onion?.({ on: true, capture: true }) ?? null) : null;
  if (onion !== null) lab.pause();
  const cells: { bitmap: ImageBitmap; label: string }[] = [];
  const simMs: (number | null)[] = [];
  try {
    for (const at of args.times) {
      if (split !== null) {
        // One render for each time, cut into the panes.
        lab.seek(at);
        await frameWithin(lab, cells.length === 0 ? FIRST_FRAME_MS : CELL_FRAME_MS);
        const shot = await paneCells(view, split.layout, width);
        for (const cell of shot.cells) {
          cells.push({
            bitmap: cell.bitmap,
            label: `${timeLabel(momentsOf(take), at)} ms · ${cameras[cell.pane] ?? ""}`,
          });
          simMs.push(shot.simMs);
        }
        continue;
      }
      for (const camera of cameras) {
        lab.seek(at);
        lab.camera(camera);
        await frameWithin(lab, cells.length === 0 ? FIRST_FRAME_MS : CELL_FRAME_MS);
        const shot = await view.capture(width);
        if (shot?.bitmap === undefined || shot.bitmap === null) throw new Error("sheet: the scene gave no picture.");
        cells.push({
          bitmap: shot.bitmap,
          label: `${timeLabel(momentsOf(take), at)} ms${cameras.length > 1 ? ` · ${camera}` : ""}`,
        });
        simMs.push(shot.simMs);
      }
    }
    const lanes = windowLanes(lab, take, args.times[0] ?? 0, args.times.at(-1) ?? 0);
    const canvas = composeSheet(cells, columns, width, lanes);
    // WebP, or JPEG in a browser without a WebP encoder (the check of the page, no PNG first).
    const blob = await encodePicture((type, level) => canvas.convertToBlob({ type, quality: level }), args.quality);
    // The bytes, not base64. The bridge moves the buffer to the page.
    const bytes = await blob.arrayBuffer();
    const mime = blob.type === "" ? "image/webp" : blob.type;
    return { width: canvas.width, height: canvas.height, mime, bytes, simMs, take, cameras, lanes };
  } finally {
    for (const cell of cells) cell.bitmap.close();
    if (split === null) lab.camera(startCamera);
    if (onion !== null) onionApi.onion?.({ ...onion.before });
    lab.seek(start);
  }
}

/**
 * The `moments` call of the bridge: the named moments of a take (default: the take of the URL), in the sequence of
 * their times. The `Stop` gate of the host checks the take at these times.
 */
export function takeMoments(take: unknown, page: SheetPage = globalThis.location): Record<string, number> {
  const query = new URL(page.href).searchParams;
  const name = typeof take === "string" ? take : (query.get("take") ?? query.get("preset"));
  return Object.fromEntries(Object.entries(momentsOf(name)).sort((a, b) => a[1] - b[1]));
}
