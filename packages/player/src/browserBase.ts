// SPDX-License-Identifier: Apache-2.0
/**
 * The browser parts that each player has: the fetch, the clock and the animation frames of
 * the page, the canvas, the poster, the timers and the pixel ratio. The full player (browser.ts) and the light player
 * of a plugin core (light.ts) add the other parts.
 */
import { canUseSceneWorker } from "@scenity/runtime/client";
import type { PlayerDeps } from "./deps";
import { browserPoster } from "./poster";
import { browserTimer, replaceCanvas } from "./renderer";

/** Make a canvas that fills a container. */
function makeCanvas(container: HTMLElement): HTMLCanvasElement {
  const canvas = document.createElement("canvas");
  canvas.style.display = "block";
  canvas.style.width = "100%";
  canvas.style.height = "100%";
  container.append(canvas);
  return canvas;
}

/** The parts of each player. */
export type BaseDeps = Pick<
  PlayerDeps,
  | "fetch"
  | "page"
  | "now"
  | "frame"
  | "cancelFrame"
  | "canUseWorker"
  | "makeCanvas"
  | "replaceCanvas"
  | "poster"
  | "timer"
  | "devicePixelRatio"
>;

/** The browser parts of each player. */
export function browserBase(): BaseDeps {
  return {
    fetch: (url) => fetch(url),
    page: location.href,
    now: () => performance.now(),
    frame: (callback) => requestAnimationFrame(() => callback()),
    cancelFrame: (handle) => {
      cancelAnimationFrame(handle);
    },
    canUseWorker: canUseSceneWorker,
    makeCanvas,
    // The new canvas of a fallback, the poster and the timers of the watchdog and the quality ladder.
    replaceCanvas,
    poster: browserPoster,
    timer: browserTimer,
    devicePixelRatio: () => globalThis.devicePixelRatio,
  };
}
