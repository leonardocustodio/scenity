// SPDX-License-Identifier: Apache-2.0
/**
 * "Open in a new window": one window shows one checkout. In the labs app, the page calls the shell command
 * `open_window` with `{ checkout }`. The shell starts a host for that checkout and opens a second window on it. In a
 * browser, the page asks its host for a second host (`windows.open`) and opens a new tab on its endpoint (`?host=<origin>#token=<token>`, the same as the first tab).
 */
import type { HostRequest } from "../host/useHost";
import type { TauriInternals } from "../host/endpoint";

/** The Tauri command of the shell (frontend/labs-desktop) that opens a window on another checkout. */
export const OPEN_WINDOW_COMMAND = "open_window";

/** The window parts that the action uses (a test gives a fake). */
export interface NewWindowHost {
  readonly location: { readonly href: string };
  open(url: string, target: string, features: string): unknown;
  readonly __TAURI_INTERNALS__?: TauriInternals;
}

/** The URL of the workbench page on another host: the same page, `?host=<origin>#token=<token>`. */
export function pageUrlFor(href: string, origin: string, token: string): string {
  const url = new URL(href);
  url.search = "";
  url.searchParams.set("host", origin);
  url.hash = `token=${token}`;
  return url.toString();
}

/** Open a window (the app) or a tab (a browser) on another checkout. Give the way that it used. */
export async function openNewWindow(
  path: string,
  request: HostRequest,
  win: NewWindowHost = globalThis,
): Promise<"tauri" | "browser"> {
  const internals = win.__TAURI_INTERNALS__;
  if (internals !== undefined && typeof internals.invoke === "function") {
    await internals.invoke(OPEN_WINDOW_COMMAND, { checkout: path });
    return "tauri";
  }
  const { origin, token } = await request("windows.open", { path });
  win.open(pageUrlFor(win.location.href, origin, token), "_blank", "noopener");
  return "browser";
}
