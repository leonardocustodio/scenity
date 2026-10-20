// SPDX-License-Identifier: Apache-2.0
/**
 * The main view of the Scene view. With a split view, the main view is the pane at the top left corner of the canvas.
 * With one view, it is the full canvas. The picks, the gizmos, the drags, the icons and the
 * layout tools of the page use the box of the main view, so their points stay correct in a split view. The other
 * panes only show their cameras (splitViews.ts).
 */
import type { SplitLayout } from "@scenity/runtime-dev/document/splitView";
import { paneBoxes } from "@scenity/runtime-dev/panes";

let layout: SplitLayout = "1";

/** Set the layout of the split view of the page. */
export function setMainLayout(next: SplitLayout): void {
  layout = next;
}

/** The current layout of the split view of the page. */
export function mainLayout(): SplitLayout {
  return layout;
}

/** The box of the main view in client pixels: the top left pane of the split view, or the whole canvas. */
export function mainViewBox(canvas: Element): DOMRect {
  const box = canvas.getBoundingClientRect();
  if (layout === "1") return box;
  const [main] = paneBoxes(layout, box.width, box.height);
  return main === undefined ? box : new DOMRect(box.left, box.top, main.width, main.height);
}
