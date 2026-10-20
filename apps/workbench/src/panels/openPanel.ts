// SPDX-License-Identifier: Apache-2.0
/**
 * Open a detached window. In the labs app, the page calls the shell command `open_panel`. The result is a native
 * window of the same app on the workbench page with the panel query, with the host of this window
 * (frontend/labs-desktop `panels.rs`). In a browser, the page opens a browser window of the workbench page on the same
 * host (`?panel=…&host=…#token=…`). A browser that blocks the window gives "blocked". `place_window` puts the main
 * window of the app again at its saved place.
 */
import { windowRect, type DetachedPanel, type HostEndpoint, type WindowRect } from "@scenity/workbench-host/protocol";
import type { TauriInternals } from "../host/endpoint";
import { panelPageUrl, panelSearch, panelTitle } from "./panelUrl";

/** The shell commands (frontend/labs-desktop `command_names.rs`). */
export const OPEN_PANEL_COMMAND = "open_panel";
export const PLACE_WINDOW_COMMAND = "place_window";

/** The size of a new window without a saved place. */
export const DEFAULT_SIZE: Readonly<Record<string, readonly [number, number]>> = {
  claude: [480, 860],
  dock: [1280, 560],
  graph: [960, 760],
  pane: [960, 600],
};
const OTHER_SIZE = [960, 640] as const;

/** The window parts that the call uses (a test gives a fake). */
export interface PanelWindowHost {
  readonly location: { readonly href: string };
  open(url: string, target: string, features: string): unknown;
  readonly __TAURI_INTERNALS__?: TauriInternals;
}

/** The `window.open` features of a place (or of the default size of the kind). */
export function featuresOf(panel: Pick<DetachedPanel, "kind" | "rect">): string {
  const [width, height] = DEFAULT_SIZE[panel.kind] ?? OTHER_SIZE;
  const { rect } = panel;
  if (rect === null) return `popup,width=${String(width)},height=${String(height)}`;
  const size = `width=${String(rect.width)},height=${String(rect.height)}`;
  return `popup,${size},left=${String(rect.x)},top=${String(rect.y)}`;
}

/** The name of the browser window of a panel: a second detach of the same key finds the same window. */
export function windowName(key: string): string {
  return `scenity-panel-${key}`;
}

/** The way that a window opened. */
export type OpenWay = "tauri" | "browser" | "blocked";

/** Open the window of a panel. */
export async function openPanel(
  panel: DetachedPanel,
  endpoint: HostEndpoint | null,
  win: PanelWindowHost = globalThis,
): Promise<OpenWay> {
  const internals = win.__TAURI_INTERNALS__;
  if (internals !== undefined && typeof internals.invoke === "function") {
    const [width, height] = DEFAULT_SIZE[panel.kind] ?? OTHER_SIZE;
    await internals.invoke(OPEN_PANEL_COMMAND, {
      request: {
        key: panel.key,
        query: panelSearch(panel),
        title: `Scenity — ${panelTitle(panel)}`,
        rect: panel.rect ?? { x: null, y: null, width, height },
      },
    });
    return "tauri";
  }
  if (endpoint === null) throw new Error("The page has no host endpoint.");
  const opened = win.open(panelPageUrl(win.location.href, panel, endpoint), windowName(panel.key), featuresOf(panel));
  return opened === null || opened === undefined ? "blocked" : "browser";
}

/** Put the main window of the app at its saved place. False in a browser (a page cannot move its tab). */
export async function placeWindow(rect: WindowRect, win: PanelWindowHost = globalThis): Promise<boolean> {
  const internals = win.__TAURI_INTERNALS__;
  if (internals === undefined || typeof internals.invoke !== "function") return false;
  await internals.invoke(PLACE_WINDOW_COMMAND, { rect });
  return true;
}

/** The place of this window now (CSS pixels). */
export function currentRect(
  win: Pick<Window, "screenX" | "screenY" | "innerWidth" | "innerHeight"> = globalThis,
): WindowRect | null {
  const rect = { x: win.screenX, y: win.screenY, width: win.innerWidth, height: win.innerHeight };
  return Object.values(rect).every((value) => Number.isFinite(value)) && rect.width > 0 && rect.height > 0
    ? rect
    : null;
}

/** The shell command of the place of the calling window (`panels.rs`). */
export const WINDOW_RECT_COMMAND = "window_rect";

/**
 * The place of this window: in the labs app from the shell (WKWebView gives no true `screenX` and `screenY`), in a
 * browser from the page. Null when no place is known.
 */
export async function readRect(
  win: Window & Partial<PanelWindowHost> = globalThis as unknown as Window,
): Promise<WindowRect | null> {
  const internals = win.__TAURI_INTERNALS__;
  if (internals === undefined || typeof internals.invoke !== "function") return currentRect(win);
  const value = await internals.invoke(WINDOW_RECT_COMMAND).catch(() => null);
  return windowRect(value);
}

/**
 * Tell the host the place of this window when it changes: at a resize and at a check every `everyMs` (a move has no
 * event). `send` gives false when it cannot send now (no host yet): the next check sends the place again. The result
 * stops it.
 */
export function trackRect(
  send: (rect: WindowRect) => boolean,
  everyMs = 2_000,
  win: Window & Partial<PanelWindowHost> = globalThis as unknown as Window,
): () => void {
  let last = "";
  const check = (): void => {
    void readRect(win).then((rect) => {
      if (rect === null) return;
      const text = JSON.stringify(rect);
      if (text !== last && send(rect)) last = text;
    });
  };
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onResize = (): void => {
    if (timer !== null) clearTimeout(timer);
    timer = setTimeout(check, 400);
  };
  win.addEventListener("resize", onResize);
  const interval = setInterval(check, everyMs);
  check();
  return () => {
    win.removeEventListener("resize", onResize);
    clearInterval(interval);
    if (timer !== null) clearTimeout(timer);
  };
}
