// SPDX-License-Identifier: Apache-2.0
/**
 * The cells of a contact sheet with one column per pane: one capture of the full canvas per time (one render), cut
 * into the boxes of the panes. Every layout has panes of one aspect (the large pane of the 3-pane layout is 2/3 × 1,
 * the small ones 1/3 × 1/2). Thus the cells of a sheet have one size.
 */
import { LAYOUT_SHARES, paneBoxes, type PaneLayout } from "@scenity/runtime-dev";
import type { ViewHandle } from "../useLabStats";

/** One cell of a sheet: the picture of a pane. */
export interface PaneCell {
  readonly bitmap: ImageBitmap;
  readonly pane: number;
}

/** The width of the grid capture that gives each pane at least `cell` pixels (at most 4096). */
export function gridWidth(layout: PaneLayout, cell: number): number {
  const narrowest = Math.min(...LAYOUT_SHARES[layout].map((share) => share.width));
  return Math.min(4096, Math.ceil(cell / narrowest));
}

/**
 * Capture the frame at the current clock time once as a grid, and cut it into one picture per pane, `cell` pixels
 * wide. The bitmaps belong to the caller (close them). The result has the time of the frame.
 */
export async function paneCells(
  view: Pick<ViewHandle, "capture">,
  layout: PaneLayout,
  cell: number,
): Promise<{ readonly simMs: number | null; readonly cells: PaneCell[] }> {
  const shot = await view.capture(gridWidth(layout, cell), undefined, { grid: true });
  const grid = shot?.bitmap ?? null;
  if (shot === null || grid === null) throw new Error("sheet: the scene gave no picture.");
  try {
    const boxes = paneBoxes(layout, grid.width, grid.height);
    const cells = await Promise.all(
      boxes.map(async (box, pane) => {
        const height = Math.max(1, Math.round((cell * box.height) / box.width));
        const options = { resizeWidth: cell, resizeHeight: height, resizeQuality: "high" } as const;
        return { pane, bitmap: await createImageBitmap(grid, box.x, box.y, box.width, box.height, options) };
      }),
    );
    return { simMs: shot.simMs, cells };
  } finally {
    grid.close();
  }
}
