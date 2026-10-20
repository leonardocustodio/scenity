// SPDX-License-Identifier: Apache-2.0
/**
 * The start phases of the lab page on the User Timing time line. The perf harness (`bun run labs bench`) reads them,
 * and the devtools also show them.
 *
 *   labs:first-frame    the scene drew its first frame (`data-ready` of the room view)
 *   labs:assets-ready   the asset files of the scene settled: `data-assets` is ready or failed, or none without the
 *                       fog (the graybox). The view starts at "none" before the renderer tells its state.
 *   labs:frame-ready    both, and the fog of the loading scene is gone: the page shows the frame
 *   labs:platform       the platform capabilities, checked after the frame is ready, in the mark detail
 *
 * The observer reads only the attributes of the room view. It changes nothing and stops after the last phase.
 */
import { markPlatform } from "@scenity/labs-platform";

export const START_MARKS = {
  firstFrame: "labs:first-frame",
  assetsReady: "labs:assets-ready",
  frameReady: "labs:frame-ready",
} as const;

/** The asset states that end the asset phase (`AssetState` of the runtime); "none" counts only without the fog. */
const SETTLED = new Set(["ready", "failed"]);

/** The phases that a page shows, from the room view of the page. */
export function startPhases(root: ParentNode): { firstFrame: boolean; assetsReady: boolean; fog: boolean } {
  const room = root.querySelector('[data-testid="room-view"]');
  const state = room?.getAttribute("data-assets") ?? "";
  const fog = room?.querySelector('[data-testid="room-3d-fog"]') !== null;
  return {
    firstFrame: room?.getAttribute("data-ready") === "true",
    assetsReady: SETTLED.has(state) || (state === "none" && !fog),
    fog,
  };
}

/**
 * Watch the page and mark each start phase one time. `onReady` runs after the last mark. The default is the platform
 * mark, after the start, so its checks do not make the start slower. The result is a function that stops the watch.
 */
export function markStart(
  root: Document = document,
  onReady: () => void = () => void markPlatform("lab").catch(() => undefined),
): () => void {
  const done = new Set<string>();
  const mark = (name: string): void => {
    if (done.has(name)) return;
    done.add(name);
    performance.mark(name);
  };
  const observer = new MutationObserver(() => {
    check();
  });
  function check(): void {
    const phases = startPhases(root);
    if (phases.firstFrame) mark(START_MARKS.firstFrame);
    if (phases.assetsReady) mark(START_MARKS.assetsReady);
    if (done.has(START_MARKS.firstFrame) && done.has(START_MARKS.assetsReady) && !phases.fog) {
      mark(START_MARKS.frameReady);
      observer.disconnect();
      onReady();
    }
  }
  observer.observe(root.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: ["data-ready", "data-assets"],
  });
  return () => {
    observer.disconnect();
  };
}
