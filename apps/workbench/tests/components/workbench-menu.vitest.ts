// SPDX-License-Identifier: Apache-2.0
/**
 * The workbench actions of the page: an item of the native menu of the labs app (the Tauri event `workbench-menu`)
 * and the ⌘K chord of the page.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import Workbench from "../../src/Workbench.vue";
import { fakeHost } from "./fakeHost";

const scope = globalThis as { __TAURI_INTERNALS__?: unknown };

afterEach(() => {
  delete scope.__TAURI_INTERNALS__;
  globalThis.localStorage.clear();
});

describe("Workbench actions", () => {
  test("the menu item hides the Claude column and ⌘K shows it again", async () => {
    const callbacks: ((message: unknown) => void)[] = [];
    const commands: string[] = [];
    scope.__TAURI_INTERNALS__ = {
      invoke: (command: string) => {
        commands.push(command);
        return Promise.resolve(command === "plugin:event|listen" ? 4 : null);
      },
      transformCallback: (callback: (message: unknown) => void) => callbacks.push(callback),
    };
    const wrapper = mount(Workbench, { props: { host: fakeHost().host } });
    await flushPromises();
    expect(commands).toContain("plugin:event|listen");
    for (const callback of callbacks) callback({ event: "workbench-menu", id: 4, payload: { id: "toggle-claude" } });
    await flushPromises();
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(false);
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyK", key: "k", metaKey: true }));
    await flushPromises();
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(true);
    wrapper.unmount();
    expect(commands).toContain("plugin:event|unlisten");
  });
});
