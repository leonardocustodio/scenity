// SPDX-License-Identifier: Apache-2.0
/**
 * "Close window": in the labs app, the top bar closes the window of the page. It uses the core command
 * `plugin:window|close` with the window label. In a browser, the button does not show.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { closeWindow, windowLabel } from "../../src/host/closeWindow";
import Workbench from "../../src/Workbench.vue";
import { fakeHost } from "./fakeHost";

const scope = globalThis as { __TAURI_INTERNALS__?: unknown };

afterEach(() => {
  delete scope.__TAURI_INTERNALS__;
  globalThis.localStorage.clear();
});

function fakeApp(label: string): { command: string; args: unknown }[] {
  const calls: { command: string; args: unknown }[] = [];
  scope.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label } },
    invoke: (command: string, args?: unknown) => {
      calls.push({ command, args });
      return Promise.resolve(command === "plugin:event|listen" ? 1 : null);
    },
    transformCallback: () => 1,
  };
  return calls;
}

describe("Close window", () => {
  test("the app window closes itself by its label", async () => {
    const calls = fakeApp("workbench-1");
    const wrapper = mount(Workbench, { props: { host: fakeHost().host } });
    await flushPromises();
    await wrapper.get("[data-testid=close-window]").trigger("click");
    await flushPromises();
    expect(calls).toContainEqual({ command: "plugin:window|close", args: { label: "workbench-1" } });
    wrapper.unmount();
  });

  test("a browser tab has no Close window button and the action does nothing", async () => {
    const wrapper = mount(Workbench, { props: { host: fakeHost().host } });
    await flushPromises();
    expect(wrapper.find("[data-testid=close-window]").exists()).toBe(false);
    expect(windowLabel()).toBeNull();
    expect(await closeWindow()).toBe(false);
    wrapper.unmount();
  });

  test("an app page without a window label closes nothing", async () => {
    const calls: string[] = [];
    const win = { __TAURI_INTERNALS__: { invoke: (command: string) => (calls.push(command), Promise.resolve(null)) } };
    expect(await closeWindow(win)).toBe(false);
    expect(calls).toEqual([]);
  });
});
