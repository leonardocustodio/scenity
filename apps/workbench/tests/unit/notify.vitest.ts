// SPDX-License-Identifier: Apache-2.0
// The notices of the workbench page: nothing while the window is in front, and the Tauri command `notify` in the app.
// Else the Notification API when the user granted it, else a mark in the title until the focus.
import { describe, expect, it, vi } from "vitest";
import { createNotifier, TITLE_MARK, type NoticeWindow } from "../../src/claude/notify";

function fakeWindow(options: { focus?: boolean; tauri?: boolean; permission?: string } = {}) {
  const listeners: (() => void)[] = [];
  const invoke = vi.fn(() => Promise.resolve(null));
  const shown: string[] = [];
  class FakeNotification {
    static permission = options.permission ?? "default";
    constructor(title: string) {
      shown.push(title);
    }
    close(): void {
      shown.push("closed");
    }
  }
  const win: NoticeWindow = {
    document: { title: "Scenity", hasFocus: () => options.focus === true },
    ...(options.tauri === true ? { __TAURI_INTERNALS__: { invoke } } : {}),
    Notification: FakeNotification,
    addEventListener: (_type, listener) => listeners.push(listener),
    removeEventListener: () => undefined,
  };
  return { win, invoke, shown, focus: () => listeners.forEach((listener) => listener()) };
}

describe("the notifier", () => {
  it("does nothing while the window is in front", async () => {
    const { win, invoke } = fakeWindow({ focus: true, tauri: true });
    expect(await createNotifier(win).show("Claude waits", "Allow Bash?")).toBe("none");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("calls the Tauri command notify in the app", async () => {
    const { win, invoke } = fakeWindow({ tauri: true });
    expect(await createNotifier(win).show("Claude waits", "Allow Bash?")).toBe("tauri");
    expect(invoke).toHaveBeenCalledWith("notify", { title: "Claude waits", body: "Allow Bash?" });
  });

  it("uses the Notification API when granted, else marks the title once until the focus", async () => {
    const granted = fakeWindow({ permission: "granted" });
    expect(await createNotifier(granted.win).show("Claude waits", "x")).toBe("browser");
    expect(granted.shown).toEqual(["Claude waits"]);

    const plain = fakeWindow();
    const notifier = createNotifier(plain.win);
    expect(await notifier.show("Claude waits", "x")).toBe("title");
    expect(await notifier.show("Claude waits", "y")).toBe("title");
    expect(plain.win.document.title).toBe(`${TITLE_MARK}Scenity`);
    plain.focus();
    expect(plain.win.document.title).toBe("Scenity");
  });
});
