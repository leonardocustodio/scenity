// SPDX-License-Identifier: Apache-2.0
/**
 * The frame compare of the scene page specs: a picture of the scene canvas only. In the edit mode, the parts over the
 * canvas (the bars of the Scene view, the notices, the overlays) are its siblings in the Scene view of the editor
 * window. Their pictures are not the scene: the edges of their round corners and of their text differ by a few levels
 * from one paint to the next over a GPU canvas. Thus the helper hides each element of the page over the canvas for
 * the shot. The picture shows all pixels of the canvas, also the pixels under the panels.
 */
import type { Page } from "@playwright/test";

/** The mark of the elements that the shot hides. */
const HIDDEN = "data-shot-hidden";

/** Hide (or show again) each sibling of the scene canvas (the body children in a page with no edit mode). */
function hideOverlays(page: Page, hide: boolean): Promise<void> {
  return page.evaluate(
    ({ hide: on, mark }) => {
      const canvas = document.querySelector("#scene");
      for (const node of Array.from(canvas?.parentElement?.children ?? [])) {
        if (node === canvas || !(node instanceof HTMLElement)) continue;
        // The CSSOM changes the style, not a style element: the CSP of the page allows it.
        if (on && node.style.visibility !== "hidden") {
          node.setAttribute(mark, node.style.visibility);
          node.style.visibility = "hidden";
        } else if (!on && node.hasAttribute(mark)) {
          node.style.visibility = node.getAttribute(mark) ?? "";
          node.removeAttribute(mark);
        }
      }
    },
    { hide, mark: HIDDEN },
  );
}

/** A picture of the scene canvas without the parts of the edit mode; the page draws a frame first. */
export async function sceneCanvasShot(page: Page): Promise<Buffer> {
  await page.evaluate(() => globalThis.__scenity?.frame());
  await hideOverlays(page, true);
  try {
    return await page.getByTestId("scene-view").screenshot({ animations: "disabled" });
  } finally {
    await hideOverlays(page, false);
  }
}
