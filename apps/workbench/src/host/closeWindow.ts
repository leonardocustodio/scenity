// SPDX-License-Identifier: Apache-2.0
/**
 * "Close window": in the labs app, the page closes its own window. The shell then stops the host of that window
 * (`WindowEvent::Destroyed` in frontend/labs-desktop), so its dev servers and its terminals also end. The page sends
 * the core command `plugin:window|close` with the label of its window, as `getCurrentWindow().close()` of
 * `@tauri-apps/api` does. The capability of the shell allows `core:window:allow-close` for the workbench windows only.
 * In a browser, there is no such action: the tab closes itself.
 */

/** The core command of Tauri 2 that closes a window. */
export const CLOSE_WINDOW_COMMAND = "plugin:window|close";

/** The Tauri internals that the action uses: the invoke function and the label of the window of the page. */
export interface CloseWindowInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  readonly metadata?: { readonly currentWindow?: { readonly label?: unknown } };
}

/** The window parts that the action uses (a test gives a fake). */
export interface CloseWindowHost {
  readonly __TAURI_INTERNALS__?: Partial<CloseWindowInternals>;
}

/** The label of the window of the page in the labs app, or null in a browser. */
export function windowLabel(win: CloseWindowHost = globalThis as CloseWindowHost): string | null {
  const internals = win.__TAURI_INTERNALS__;
  if (typeof internals?.invoke !== "function") return null;
  const label = internals.metadata?.currentWindow?.label;
  return typeof label === "string" && label !== "" ? label : null;
}

/** Close the window of the page. Give false outside the labs app (nothing to close). */
export async function closeWindow(win: CloseWindowHost = globalThis as CloseWindowHost): Promise<boolean> {
  const label = windowLabel(win);
  const internals = win.__TAURI_INTERNALS__;
  if (label === null || typeof internals?.invoke !== "function") return false;
  await internals.invoke(CLOSE_WINDOW_COMMAND, { label });
  return true;
}
