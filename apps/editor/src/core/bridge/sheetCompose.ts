// SPDX-License-Identifier: Apache-2.0
/**
 * The layout of a contact sheet: the grid of the cells with a label under each, and the clip lanes under the grid. The lab page
 * (workbenchSheet.ts, the call `sheet`) and the scene page (src/scene/sceneSheet.ts) compose their sheets with it. It has no lab module, so the
 * scene page can load it. The layout is the layout of `bun run labs sheet` (scripts/lab/shooter.ts `Shooter.sheet`).
 */

/** The clip lanes under a sheet: the range and a row of parts per member (scripts/lab/shooter.ts `SheetLanes`). */
export interface SheetLanes {
  readonly from: number;
  readonly to: number;
  readonly rows: readonly {
    readonly member: string;
    readonly parts: readonly {
      readonly label: string;
      readonly family: string;
      readonly from: number;
      readonly to: number;
      readonly clip: boolean;
    }[];
  }[];
}

/** The most cells of one sheet. A sheet is one picture to read, not a film. */
export const MAX_CELLS = 64;
const LABEL = 22;
const GAP = 4;
const LANE = 18;
const LANE_COLORS = ["#4fb3bf", "#e0a63a", "#7bc96f", "#c47ad6", "#5b8def", "#e46b6b", "#9aa5b1", "#d6c75a"];

/**
 * The columns of a sheet (`bun run labs sheet`, the lab CLI of the plugin): one per camera, else at most four times
 * per row.
 */
export function sheetColumns(times: number, cameras: number): number {
  return cameras > 1 ? cameras : Math.min(times, 4);
}

/** The width of a cell: at most `cell`, and the sheet at most `maxWidth` wide. */
export function cellWidth(columns: number, cell = 400, maxWidth = 1600): number {
  return Math.max(16, Math.min(cell, Math.floor((maxWidth - GAP) / columns) - GAP));
}

function drawLanes(context: OffscreenCanvasRenderingContext2D, lanes: SheetLanes, top: number, width: number): void {
  const name = 60;
  const span = width - GAP * 2 - name;
  context.font = "11px ui-monospace, Menlo, monospace";
  lanes.rows.forEach((row, index) => {
    const y = top + index * (LANE + 2);
    context.fillStyle = "#9aa5b1";
    context.fillText(row.member, GAP, y + LANE / 2);
    for (const part of row.parts) {
      let hash = 0;
      for (const char of part.family) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
      const x = GAP + name + ((part.from - lanes.from) / (lanes.to - lanes.from)) * span;
      const w = Math.max(1, ((part.to - part.from) / (lanes.to - lanes.from)) * span - 1);
      context.globalAlpha = part.clip ? 1 : 0.4;
      context.fillStyle = LANE_COLORS[hash % LANE_COLORS.length] ?? "#9aa5b1";
      context.fillRect(x, y, w, LANE);
      context.globalAlpha = 1;
      context.save();
      context.beginPath();
      context.rect(x, y, w, LANE);
      context.clip();
      context.fillStyle = "#11151c";
      context.fillText(part.label, x + 3, y + LANE / 2);
      context.restore();
    }
  });
}

/** Compose the sheet: the cells in a grid with the label under each, then the lanes (Shooter.sheet). */
export function composeSheet(
  cells: readonly { readonly bitmap: ImageBitmap; readonly label: string }[],
  columns: number,
  width: number,
  lanes: SheetLanes | null,
): OffscreenCanvas {
  const first = cells[0]?.bitmap;
  if (first === undefined) throw new Error("sheet: a sheet needs a frame.");
  const height = Math.round((width * first.height) / first.width);
  const lines = Math.ceil(cells.length / columns);
  const lanesHeight = lanes === null ? 0 : lanes.rows.length * (LANE + 2) + GAP;
  const sheetWidth = columns * (width + GAP) + GAP;
  const canvas = new OffscreenCanvas(sheetWidth, lines * (height + LABEL + GAP) + GAP + lanesHeight);
  const context = canvas.getContext("2d");
  if (context === null) throw new Error("sheet: the page has no 2D canvas.");
  context.fillStyle = "#1b1f27";
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.font = "14px ui-monospace, Menlo, monospace";
  context.textBaseline = "middle";
  cells.forEach((cell, index) => {
    const x = GAP + (index % columns) * (width + GAP);
    const y = GAP + Math.floor(index / columns) * (height + LABEL + GAP);
    context.drawImage(cell.bitmap, x, y, width, height);
    context.fillStyle = "#e8ecf3";
    context.fillText(cell.label, x + 6, y + height + LABEL / 2);
  });
  if (lanes !== null) drawLanes(context, lanes, lines * (height + LABEL + GAP) + GAP, sheetWidth);
  return canvas;
}
