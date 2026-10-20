// SPDX-License-Identifier: Apache-2.0
/**
 * The visibility of the lab page in a hidden surface tab. The workbench page shows one surface tab at a time. The
 * frames of the other tabs stay loaded behind it at 0 opacity, and a browser keeps their render loops active. The
 * bridge call `visibility` ("hidden" or "visible") pauses them. The page hides its root (`display: none`), so the 3D
 * room sees no part of its view on the screen and stops its frame loop. This is the same as in a hidden browser tab,
 * but without a `visibilitychange` of the document.
 *
 * A call that needs frames (a capture, a sheet, a frame, the metrics) wakes a hidden page for the call. The page shows,
 * waits for WAKE_PAINTS paints (the renderer gets the visible flag and draws), and runs the call. It hides again
 * LINGER_MS after the last such call. A 3D room before its first frame keeps the page visible until that frame, so the
 * page does not use the 2D room as a fallback.
 */

/** The calls of the bridge that need frames of the scene. */
export const RENDER_CALLS: ReadonlySet<string> = new Set([
  "capture",
  "sheet",
  "frame",
  "measureAt",
  "check",
  "sweep",
  "strip",
  "inspect",
  "measure",
]);
/** The number of paints that a woken page waits for before the call. Then the renderer has the visible flag. */
export const WAKE_PAINTS = 3;
/** The time that a woken page stays visible after its last call (ms). Thus the next call of a tool needs no wake. */
export const LINGER_MS = 2000;
/** A page with a 3D room before its first frame tries to hide again after this time (ms). */
export const RETRY_MS = 1000;

export type Visibility = "hidden" | "visible";

/** The window parts of the visibility (a test gives a fake). */
export interface VisibilityHost {
  /** The style of the root element of the page. */
  readonly root: { readonly style: Pick<CSSStyleDeclaration, "setProperty" | "removeProperty"> };
  /** True while a part of the page must draw before it hides: a 3D room before its first frame. */
  busy(): boolean;
  setTimeout(run: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  /** Wait for the next paint of the page. */
  paint(): Promise<void>;
}

export interface PageVisibility {
  /** The call `visibility`: the state that the workbench asks for. Returns the current state of the page. */
  set(value: unknown): Visibility;
  /** Run a call that needs frames: a hidden page shows for it. */
  during<T>(run: () => Promise<T>): Promise<T>;
  /** The current state of the page. */
  state(): Visibility;
  /** Show the page and stop the timers. */
  stop(): void;
}

export function pageVisibility(host: VisibilityHost): PageVisibility {
  let wanted: Visibility = "visible";
  let hidden = false;
  let active = 0;
  let timer: unknown = null;

  function clear(): void {
    if (timer !== null) host.clearTimeout(timer);
    timer = null;
  }

  function show(): void {
    if (!hidden) return;
    host.root.style.removeProperty("display");
    hidden = false;
  }

  /** Hide the page when the workbench asks for it and no call needs frames. A busy page tries again after RETRY_MS. */
  function settle(): void {
    clear();
    if (wanted === "visible" || active > 0) {
      show();
      return;
    }
    if (hidden) return;
    if (host.busy()) {
      timer = host.setTimeout(settle, RETRY_MS);
      return;
    }
    host.root.style.setProperty("display", "none", "important");
    hidden = true;
  }

  return {
    set(value) {
      wanted = value === "hidden" ? "hidden" : "visible";
      settle();
      return hidden ? "hidden" : "visible";
    },
    async during(run) {
      active += 1;
      clear();
      if (hidden) {
        show();
        for (let paint = 0; paint < WAKE_PAINTS; paint += 1) await host.paint();
      }
      try {
        return await run();
      } finally {
        active -= 1;
        if (active === 0 && wanted === "hidden") {
          clear();
          timer = host.setTimeout(settle, LINGER_MS);
        }
      }
    },
    state: () => (hidden ? "hidden" : "visible"),
    stop() {
      clear();
      wanted = "visible";
      show();
    },
  };
}

/** The visibility of this page (the bridge starts it). */
export function browserVisibility(): PageVisibility {
  return pageVisibility({
    root: document.documentElement,
    busy: () => document.querySelector('[data-testid="room-view"]:not([data-ready])') !== null,
    setTimeout: (run, ms) => globalThis.setTimeout(run, ms),
    clearTimeout: (handle) => {
      globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    paint: () =>
      new Promise((resolve) => {
        requestAnimationFrame(() => {
          resolve();
        });
      }),
  });
}
