// SPDX-License-Identifier: Apache-2.0
/**
 * The poster of a scene: an image that the player shows at once and
 * hides at the first frame. When no backend works, the poster stays with the error state of the player.
 *
 * The poster URL comes from the `poster` option (null: no poster), else from the `poster` field of the scene document
 * (a path relative to the scene file). `scenity build` copies the poster files into the build. A still of the asset
 * pipeline can be the poster: the field names any image file of the project.
 *
 * The view: in a container of the player, an `<img part="poster">` over the canvas; on a canvas of the page, the CSS
 * background of the canvas (the player does not change the DOM round a canvas of the page).
 */
import type { PlayerOptions } from "./types";

/** The poster of a player: the view of the browser, or a fake of a test. */
export interface PosterView {
  /** Show the image of a URL (the load state). */
  show(url: string): void;
  /** Hide the poster: the first frame is on the canvas. */
  hide(): void;
  /** Show the poster again with the error state: no backend works. */
  fail(reason: string): void;
  /** The canvas changed (a fallback): keep the poster over the new canvas. */
  move(canvas: HTMLCanvasElement): void;
  dispose(): void;
}

/** The poster URL of the options and of the scene document, or null for no poster. */
export function posterUrl(
  options: Pick<PlayerOptions, "poster">,
  scenePoster: string | undefined,
  sceneUrl: string,
): string | null {
  if (options.poster === null) return null;
  if (options.poster !== undefined) return new URL(options.poster, sceneUrl).href;
  return scenePoster === undefined ? null : new URL(scenePoster, sceneUrl).href;
}

const IMAGE_STYLE = "position:absolute;inset:0;width:100%;height:100%;object-fit:cover;pointer-events:none";

/** The poster as an image over a canvas that the player made in a container. */
function imagePoster(canvas: HTMLCanvasElement): PosterView {
  const image = document.createElement("img");
  image.alt = "";
  image.setAttribute("part", "poster");
  image.setAttribute("data-testid", "player-poster");
  image.setAttribute("style", IMAGE_STYLE);
  image.hidden = true;
  const container = canvas.parentElement;
  if (container !== null && getComputedStyle(container).position === "static") container.style.position = "relative";
  canvas.after(image);
  return {
    show: (url) => {
      image.src = url;
      image.hidden = false;
    },
    hide: () => {
      image.hidden = true;
    },
    fail: (reason) => {
      image.dataset.error = reason;
      if (image.getAttribute("src") !== null) image.hidden = false;
    },
    move: (next) => {
      next.after(image);
    },
    dispose: () => {
      image.remove();
    },
  };
}

/** The poster as the CSS background of a canvas of the page. */
function backgroundPoster(first: HTMLCanvasElement): PosterView {
  let canvas = first;
  let url: string | null = null;
  const paint = (on: boolean): void => {
    canvas.style.backgroundImage = on && url !== null ? `url("${encodeURI(url)}")` : "";
    canvas.style.backgroundSize = on ? "cover" : "";
    canvas.style.backgroundPosition = on ? "center" : "";
  };
  return {
    show: (next) => {
      url = next;
      paint(true);
    },
    hide: () => {
      paint(false);
    },
    fail: () => {
      paint(true);
    },
    move: (next) => {
      canvas = next;
    },
    dispose: () => {
      paint(false);
    },
  };
}

/** The poster view of the browser for a canvas. `owned` is true when the player made the canvas in a container. */
export function browserPoster(canvas: HTMLCanvasElement, owned: boolean): PosterView {
  return owned ? imagePoster(canvas) : backgroundPoster(canvas);
}
