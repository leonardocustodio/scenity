// SPDX-License-Identifier: Apache-2.0
/**
 * The menu events of the labs app. The native menu of frontend/labs-desktop sends
 * the event `workbench-menu` with `{ id }` to the page. The page listens through the event plugin of Tauri 2, as
 * `listen` of `@tauri-apps/api/event` does: `transformCallback` gives a callback ID, and the command
 * `plugin:event|listen` connects it to the event. The capability of the page allows `listen` and `unlisten` only.
 * The page thus needs no `@tauri-apps/api` package. In a browser there is no menu, and the listen does nothing.
 */

/** The event of the native menu (`menu::MENU_EVENT` of the shell). */
export const MENU_EVENT = "workbench-menu";

/** The Tauri internals that the event listen uses. */
export interface TauriEventInternals {
  invoke(command: string, args?: Record<string, unknown>): Promise<unknown>;
  transformCallback(callback: (message: unknown) => void, once?: boolean): number;
  unregisterCallback?(id: number): void;
}

/** The window parts of the listen (a test gives a fake). */
export interface MenuWindow {
  readonly __TAURI_INTERNALS__?: Partial<TauriEventInternals>;
  readonly __TAURI_EVENT_PLUGIN_INTERNALS__?: { unregisterListener?(event: string, id: number): void };
}

/** The `id` of a menu event (`{ event, id, payload: { id } }`), or null. */
export function menuId(message: unknown): string | null {
  if (typeof message !== "object" || message === null) return null;
  const payload = (message as { payload?: unknown }).payload;
  if (typeof payload !== "object" || payload === null) return null;
  const id = (payload as { id?: unknown }).id;
  return typeof id === "string" ? id : null;
}

/**
 * Listen to the menu events of the labs app. `onId` gets the ID of each menu item. Returns the stop function, or null
 * outside the app or when the listen fails.
 */
export async function listenMenu(
  onId: (id: string) => void,
  win: MenuWindow = globalThis as MenuWindow,
): Promise<(() => void) | null> {
  const found = win.__TAURI_INTERNALS__;
  if (typeof found?.invoke !== "function" || typeof found.transformCallback !== "function") return null;
  const tauri = found as TauriEventInternals;
  const handler = tauri.transformCallback((message) => {
    const id = menuId(message);
    if (id !== null) onId(id);
  });
  let eventId: unknown;
  try {
    eventId = await tauri.invoke("plugin:event|listen", { event: MENU_EVENT, target: { kind: "Any" }, handler });
  } catch {
    tauri.unregisterCallback?.(handler);
    return null;
  }
  if (typeof eventId !== "number") return null;
  const listener = eventId;
  return () => {
    win.__TAURI_EVENT_PLUGIN_INTERNALS__?.unregisterListener?.(MENU_EVENT, listener);
    tauri.invoke("plugin:event|unlisten", { event: MENU_EVENT, eventId: listener }).catch(() => undefined);
    tauri.unregisterCallback?.(handler);
  };
}
