// SPDX-License-Identifier: Apache-2.0
/**
 * The workbench keys: the ⌘ chords of the page, the chords that a lab frame sends (the bridge event `key`, which
 * stays in the page), and the menu events of the labs app through the event plugin of Tauri.
 */
import type { RequestParams } from "@scenity/workbench-host/protocol";
import { describe, expect, test, vi } from "vitest";
import { listenMenu, menuId, MENU_EVENT, type MenuWindow } from "../../src/host/menuEvents";
import {
  focusPrompt,
  keyAction,
  menuAction,
  pageAction,
  paletteKey,
  surfaceOf,
  type PageKeyEvent,
} from "../../src/layout/workbenchKeys";
import { createRelay } from "../../src/surfaces/relay";

const key = (code: string, parts: Partial<PageKeyEvent> = {}): PageKeyEvent => ({
  code,
  metaKey: true,
  ctrlKey: false,
  altKey: false,
  shiftKey: false,
  target: null,
  ...parts,
});

describe("the palette key of the page", () => {
  test("sends ⌘P to the lab frame while the lab shows; Ctrl+P only outside a text field", () => {
    expect(paletteKey(key("KeyP"), true)).toBe(true);
    expect(paletteKey(key("KeyP"), false)).toBe(false);
    expect(paletteKey(key("KeyP", { shiftKey: true }), true)).toBe(false);
    expect(paletteKey(key("KeyK"), true)).toBe(false);
    const field = { tagName: "TEXTAREA" } as unknown as EventTarget;
    expect(paletteKey(key("KeyP", { metaKey: false, ctrlKey: true }), true)).toBe(true);
    expect(paletteKey(key("KeyP", { metaKey: false, ctrlKey: true, target: field }), true)).toBe(false);
    expect(paletteKey(key("KeyP", { target: field }), true)).toBe(true);
  });
});

describe("the workbench keys of the page", () => {
  test("maps the ⌘ chords to the actions and leaves the lab keys alone", () => {
    expect(pageAction(key("Backslash"))).toBe("toggle-claude");
    // ⌘1 to ⌘9 put the tab at that place in front (the order of the manifest).
    expect(pageAction(key("Digit1"))).toBe("surface-1");
    expect(pageAction(key("Digit3"))).toBe("surface-3");
    expect(pageAction(key("Digit9"))).toBe("surface-9");
    expect(pageAction(key("Digit0"))).toBeNull();
    expect(pageAction(key("KeyK"))).toBe("focus-claude");
    expect(pageAction(key("Backslash", { metaKey: false }))).toBeNull();
    expect(pageAction(key("Space"))).toBeNull();
    expect(pageAction(key("KeyR"))).toBeNull();
    expect(pageAction(key("KeyK", { shiftKey: true }))).toBeNull();
    expect(pageAction(key("KeyK", { altKey: true }))).toBeNull();
  });

  test("a Ctrl chord counts outside a text field only: the terminal keeps Ctrl+K and Ctrl+\\", () => {
    const terminal = { tagName: "TEXTAREA" } as unknown as EventTarget;
    expect(pageAction(key("KeyK", { metaKey: false, ctrlKey: true }))).toBe("focus-claude");
    expect(pageAction(key("KeyK", { metaKey: false, ctrlKey: true, target: terminal }))).toBeNull();
    expect(pageAction(key("Backslash", { metaKey: false, ctrlKey: true, target: terminal }))).toBeNull();
    expect(pageAction(key("KeyK", { target: terminal }))).toBe("focus-claude");
  });

  test("maps the keys of a frame and the menu IDs to the same actions", () => {
    expect(keyAction("\\")).toBe("toggle-claude");
    expect(keyAction("1")).toBe("surface-1");
    expect(keyAction("4")).toBe("surface-4");
    expect(menuAction("surface-2")).toBe("surface-2");
    // The first tab of the native menu of an older labs app.
    expect(menuAction("surface-lab")).toBe("surface-1");
    expect(menuAction("surface-web")).toBeNull();
    expect(menuAction("surface-10")).toBeNull();
    expect(menuAction("restart-host")).toBe("restart-host");
    expect(menuAction("reload-page")).toBeNull();
    expect(menuAction(4)).toBeNull();
    expect(surfaceOf("surface-1")).toBe(1);
    expect(surfaceOf("surface-9")).toBe(9);
    expect(surfaceOf("focus-claude")).toBeNull();
  });

  test("gives the focus to the first shown text field of the column", () => {
    const hidden = { focus: vi.fn(), getClientRects: () => ({ length: 0 }) };
    const shown = { focus: vi.fn(), getClientRects: () => ({ length: 1 }) };
    expect(focusPrompt({ querySelectorAll: () => [hidden, shown] })).toBe(true);
    expect(hidden.focus).not.toHaveBeenCalled();
    expect(shown.focus).toHaveBeenCalledOnce();
    expect(focusPrompt({ querySelectorAll: () => [hidden] })).toBe(false);
    expect(focusPrompt(null)).toBe(false);
  });
});

describe("the key event of a frame", () => {
  test("goes to onKey and never to the host", () => {
    const reports: RequestParams<"surface.report">[] = [];
    const keys: string[] = [];
    const relay = createRelay({
      answer: () => undefined,
      report: (params) => reports.push(params),
      onKey: (k) => keys.push(k),
    });
    const frame = { origin: "http://127.0.0.1:5400", window: { postMessage: () => undefined } };
    relay.attach("lab", "visible", frame);
    relay.receive({ source: frame.window, origin: frame.origin, data: { workbench: 1, event: "key", key: "k" } });
    relay.receive({ source: frame.window, origin: frame.origin, data: { workbench: 1, event: "key", key: "x" } });
    relay.receive({ source: {}, origin: frame.origin, data: { workbench: 1, event: "key", key: "1" } });
    expect(keys).toEqual(["k"]);
    expect(reports).toEqual([]);
    relay.dispose();
  });
});

/** A fake of the Tauri internals: the callbacks and the invoke calls. */
function fakeTauri(answer: unknown = 9) {
  const callbacks = new Map<number, (message: unknown) => void>();
  const calls: { command: string; args?: Record<string, unknown> }[] = [];
  const unregistered: unknown[] = [];
  const win: MenuWindow = {
    __TAURI_INTERNALS__: {
      invoke: (command, args) => {
        calls.push({ command, ...(args === undefined ? {} : { args }) });
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
      transformCallback: (callback) => {
        callbacks.set(callbacks.size + 1, callback);
        return callbacks.size;
      },
      unregisterCallback: (id) => callbacks.delete(id),
    },
    __TAURI_EVENT_PLUGIN_INTERNALS__: { unregisterListener: (event, id) => unregistered.push([event, id]) },
  };
  return { win, callbacks, calls, unregistered };
}

describe("the menu events of the labs app", () => {
  test("listens to workbench-menu through the event plugin and stops again", async () => {
    const tauri = fakeTauri();
    const ids: string[] = [];
    const stop = await listenMenu((id) => ids.push(id), tauri.win);
    expect(tauri.calls[0]).toEqual({
      command: "plugin:event|listen",
      args: { event: MENU_EVENT, target: { kind: "Any" }, handler: 1 },
    });
    tauri.callbacks.get(1)?.({ event: MENU_EVENT, id: 9, payload: { id: "toggle-claude" } });
    tauri.callbacks.get(1)?.({ event: MENU_EVENT, id: 9, payload: "nothing" });
    expect(ids).toEqual(["toggle-claude"]);
    stop?.();
    expect(tauri.unregistered).toEqual([[MENU_EVENT, 9]]);
    expect(tauri.calls[1]).toEqual({ command: "plugin:event|unlisten", args: { event: MENU_EVENT, eventId: 9 } });
    expect(tauri.callbacks.size).toBe(0);
  });

  test("does nothing in a browser, and forgets the callback when the listen fails", async () => {
    expect(await listenMenu(() => undefined, {})).toBeNull();
    const tauri = fakeTauri(new Error("not allowed"));
    expect(await listenMenu(() => undefined, tauri.win)).toBeNull();
    expect(tauri.callbacks.size).toBe(0);
    expect(menuId({ payload: { id: 3 } })).toBeNull();
  });
});
