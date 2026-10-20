// SPDX-License-Identifier: Apache-2.0
/**
 * The notices of the workbench: Claude waits for the owner, or the `Stop` gate refused "done". When the window is not
 * in front, the page tells the owner in one of these ways:
 * - in the labs app, with the Tauri command `notify` (a native notification);
 * - in a browser, with the Notification API when the owner granted it;
 * - else with a mark in the title of the tab until the window comes to the front.
 */
import type { TauriInternals } from "../host/endpoint";

/** The window parts of the notifier (a test gives a fake). */
export interface NoticeWindow {
  readonly document: { title: string; hasFocus(): boolean };
  readonly __TAURI_INTERNALS__?: TauriInternals;
  readonly Notification?: {
    readonly permission: string;
    new (title: string, options?: { body?: string }): unknown;
  };
  addEventListener(type: "focus", listener: () => void): void;
  removeEventListener(type: "focus", listener: () => void): void;
}

/** The mark in the title of the tab while a notice waits. */
export const TITLE_MARK = "● ";

/** How the notifier told the owner: not at all (the window is in front), natively, in the browser, or in the title. */
export type NoticeWay = "none" | "tauri" | "browser" | "title";

export interface Notifier {
  /** Tell the owner when the window is not in front. Give the way. */
  show(title: string, message: string): Promise<NoticeWay>;
  dispose(): void;
}

/** Make the notifier of a window. */
export function createNotifier(win: NoticeWindow): Notifier {
  let marked = false;
  const unmark = (): void => {
    if (!marked) return;
    marked = false;
    if (win.document.title.startsWith(TITLE_MARK)) win.document.title = win.document.title.slice(TITLE_MARK.length);
  };
  win.addEventListener("focus", unmark);
  const mark = (): NoticeWay => {
    if (!marked) win.document.title = `${TITLE_MARK}${win.document.title}`;
    marked = true;
    return "title";
  };
  return {
    async show(title, message) {
      if (win.document.hasFocus()) return "none";
      const tauri = win.__TAURI_INTERNALS__;
      if (tauri !== undefined && typeof tauri.invoke === "function") {
        try {
          await tauri.invoke("notify", { title, body: message });
          return "tauri";
        } catch {
          return mark();
        }
      }
      const Native = win.Notification;
      if (Native?.permission === "granted") {
        try {
          new Native(title, { body: message });
          return "browser";
        } catch {
          return mark();
        }
      }
      return mark();
    },
    dispose() {
      win.removeEventListener("focus", unmark);
      unmark();
    },
  };
}
