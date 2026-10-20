// SPDX-License-Identifier: Apache-2.0
/**
 * The layout and the states of the workbench page: the top bar, the surface frame, the Claude column and ⌘\, the
 * dock tabs, no host, a lost host, no checkout, and a failed dev server.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import type { HostState } from "../../src/host/useHost";
import Workbench from "../../src/Workbench.vue";
import { CHECKOUT, fakeHost, surfaceState } from "./fakeHost";

afterEach(() => {
  globalThis.localStorage.clear();
});

/** Mount the page out of the document: happy-dom then loads no frame page. */
function mountWith(host: ReturnType<typeof fakeHost>["host"]) {
  return mount(Workbench, { props: { host } });
}

describe("Workbench layout", () => {
  test("shows the checkout, the surface tabs, the dots and the lab frame with the workbench origin", () => {
    const wrapper = mountWith(fakeHost().host);
    const top = wrapper.get("[data-testid=workbench-top-bar]").text();
    // expect(top).toContain("Scenity");
    expect(top).toContain("Scenity 3D");
    expect(top).toContain("lc/room3d-sdk");
    expect(wrapper.get("[data-testid=top-changed]").text()).toBe("3 files changed");
    expect(wrapper.get("[data-testid=surface-tab-lab]").attributes("aria-current")).toBe("page");
    expect(wrapper.find("[data-testid=surface-tab-web]").exists()).toBe(false);
    expect(wrapper.get("[data-testid=dot-host]").attributes("title")).toBe("Host: connected");
    expect(wrapper.get("[data-testid=dot-vite]").attributes("title")).toBe("Lab dev server: ready");
    const frame = wrapper.get("[data-testid=surface-frame-visible]");
    expect(frame.attributes("src")).toBe(
      `http://127.0.0.1:5400/?take=greet&t=6350&workbench=${encodeURIComponent("http://127.0.0.1:5300")}`,
    );
    expect(frame.attributes("allow")).toContain("fullscreen");
    expect(frame.attributes("allow")).toContain("clipboard-write");
    expect(wrapper.find("[data-testid=surface-frame-shadow]").exists()).toBe(false);
    expect(wrapper.get("[data-testid=status-line]").text()).toBe("Lab dev server ready on port 5400.");
  });

  test("keeps the frame src when the host reports a new URL of the same server", async () => {
    const { host, surfaces } = fakeHost();
    const wrapper = mountWith(host);
    const before = wrapper.get("[data-testid=surface-frame-visible]").attributes("src");
    surfaces.value = [surfaceState({ url: "http://127.0.0.1:5400/?take=greet&t=9000" })];
    await flushPromises();
    expect(wrapper.get("[data-testid=surface-frame-visible]").attributes("src")).toBe(before);
  });

  test("adds the hidden shadow frame when the host lists one", async () => {
    const { host, surfaces } = fakeHost();
    const wrapper = mountWith(host);
    surfaces.value = [surfaceState({ shadowUrl: "http://127.0.0.1:5400/?take=greet&panel=0&dock=0" })];
    await flushPromises();
    const shadow = wrapper.get("[data-testid=surface-frame-shadow]");
    expect(shadow.attributes("aria-hidden")).toBe("true");
    expect(shadow.attributes("tabindex")).toBe("-1");
    expect(shadow.classes()).toContain("surface-shadow");
  });

  test("⌘\\ hides and shows the Claude column; a plain backslash goes to the lab", async () => {
    const wrapper = mountWith(fakeHost().host);
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(true);
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "Backslash", key: "\\" }));
    await flushPromises();
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(true);
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "Backslash", key: "\\", metaKey: true }));
    await flushPromises();
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(false);
    expect(globalThis.localStorage.getItem("scenity.workbench.claude")).toBe("hidden");
    await wrapper.get("[data-testid=toggle-claude]").trigger("click");
    expect(wrapper.find("[data-testid=claude-column]").exists()).toBe(true);
  });

  test("the Sessions tab opens the list of the sessions and closes again", async () => {
    const wrapper = mountWith(fakeHost().host);
    await wrapper.get("[data-testid=dock-tab-sessions]").trigger("click");
    expect(wrapper.get("[data-testid=dock-sessions]").find("[data-testid=dock-sessions-tab]").exists()).toBe(true);
    await wrapper.get("[data-testid=dock-tab-sessions]").trigger("click");
    expect(wrapper.find("[data-testid=dock-sessions]").exists()).toBe(false);
  });
});

describe("Workbench states", () => {
  test.each<[HostState, boolean, string]>([
    ["looking", false, "workbench-host-looking"],
    ["none", false, "workbench-no-host"],
    ["connecting", false, "workbench-host-waiting"],
    ["lost", false, "workbench-host-waiting"],
  ])("state %s before a hello shows %s", (state, greeted, testId) => {
    const wrapper = mountWith(fakeHost({ state, greeted }).host);
    expect(wrapper.find(`[data-testid=${testId}]`).exists()).toBe(true);
    expect(wrapper.find("[data-testid=workspace]").exists()).toBe(false);
  });

  test("a lost host keeps the surface and shows the reconnecting banner", () => {
    const wrapper = mountWith(fakeHost({ state: "lost" }).host);
    expect(wrapper.get("[data-testid=host-lost]").text()).toContain("Reconnecting");
    expect(wrapper.find("[data-testid=surface-frame-visible]").exists()).toBe(true);
    expect(wrapper.get("[data-testid=dot-host]").attributes("title")).toBe("Host: connection lost");
  });

  test("no checkout shows the checkouts", async () => {
    const { host } = fakeHost({ checkout: null, surfaces: [], answers: { "checkouts.list": () => [CHECKOUT] } });
    const wrapper = mountWith(host);
    await flushPromises();
    expect(wrapper.find("[data-testid=checkouts]").exists()).toBe(true);
    expect(wrapper.findAll("[data-testid=checkout-row]")).toHaveLength(1);
    expect(wrapper.find("[data-testid=checkouts-close]").exists()).toBe(false);
  });

  test("a failed dev server shows its last log lines and restarts with checkouts.open", async () => {
    const error = Array.from({ length: 20 }, (_, index) => `line ${String(index + 1)}`).join("\n");
    const failed = surfaceState({ url: null, server: { status: "failed", port: null, error } });
    const { host, calls } = fakeHost({
      surfaces: [failed],
      answers: { "checkouts.open": () => ({ checkout: CHECKOUT, surfaces: [surfaceState()] }) },
    });
    const wrapper = mountWith(host);
    const log = wrapper.get("[data-testid=surface-log]").text();
    expect(log.startsWith("line 5")).toBe(true);
    expect(log.endsWith("line 20")).toBe(true);
    expect(wrapper.get("[data-testid=dot-vite]").attributes("title")).toBe("Lab dev server: failed");
    await wrapper.get("[data-testid=surface-restart]").trigger("click");
    await flushPromises();
    // The dock panels also load their lists. This test examines only the checkout requests.
    expect(calls.filter((call) => call.type.startsWith("checkouts."))).toEqual([
      { type: "checkouts.open", params: { path: CHECKOUT.path } },
    ]);
    expect(wrapper.find("[data-testid=surface-status-failed]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=surface-frame-visible]").exists()).toBe(true);
  });

  test("a starting server shows its port over the frame", () => {
    const starting = surfaceState({ url: null, server: { status: "starting", port: 5400, error: null } });
    const wrapper = mountWith(fakeHost({ surfaces: [starting] }).host);
    expect(wrapper.get("[data-testid=surface-status-starting]").text()).toContain("on port 5400");
  });
});
