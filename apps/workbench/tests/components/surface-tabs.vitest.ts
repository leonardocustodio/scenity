// SPDX-License-Identifier: Apache-2.0
/**
 * The surface tabs of the workbench page: the tab of the lab that the host lists, and the restart of a failed lab dev
 * server (an open of the checkout again). The tabs, their labels, their order, ⌘1 to ⌘9 and the hidden surfaces come
 * from the project of `host.hello`.
 */
import type { Checkout, HelloAccess, ProjectSurfaceInfo, SurfaceState } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, test } from "vitest";
import { nextTick } from "vue";
import Workbench from "../../src/Workbench.vue";
import { CHECKOUT, fakeHost, surfaceState } from "./fakeHost";

afterEach(() => {
  globalThis.localStorage.clear();
});

/** The `checkouts.open` requests of the page. */
function opens(calls: readonly { type: string; params: unknown }[]): unknown[] {
  return calls.filter((call) => call.type === "checkouts.open").map((call) => call.params);
}

describe("the surface tabs", () => {
  test("the lab tab is on when the host lists the lab", () => {
    const wrapper = mount(Workbench, { props: { host: fakeHost({ surfaces: [surfaceState()] }).host } });
    expect(wrapper.get("[data-testid=surface-tab-lab]").attributes("disabled")).toBeUndefined();
    expect(wrapper.find("[data-testid=surface-tab-web]").exists()).toBe(false);
  });

  test("a failed lab server restarts with an open of the checkout, and the words name the surface", async () => {
    const failed = surfaceState({ server: { status: "failed", port: null, error: "vite: port in use" } });
    const { host, calls } = fakeHost({
      surfaces: [failed],
      answers: {
        "checkouts.open": (): { checkout: Checkout; surfaces: SurfaceState[] } => ({
          checkout: CHECKOUT,
          surfaces: [failed],
        }),
      },
    });
    const wrapper = mount(Workbench, { props: { host } });
    await flushPromises();
    expect(wrapper.text()).toContain("The lab dev server stopped with an error");
    await wrapper.get("[data-surface-tab=lab] [data-testid=surface-restart]").trigger("click");
    await flushPromises();
    expect(opens(calls)).toEqual([{ path: CHECKOUT.path }]);
  });
});

/** A surface of a project manifest with the defaults of the host. */
function info(id: string, label: string, more: Partial<ProjectSurfaceInfo> = {}): ProjectSurfaceInfo {
  return { id, kind: "scene", label, capabilities: [], page: null, hidden: false, order: 1, ...more };
}

/** The access of a `host.hello` with these surfaces in the project. */
function access(surfaces: ProjectSurfaceInfo[]): HelloAccess {
  const project = {
    ...{ id: "shop", name: "Shop", dir: "/work/shop", manifest: "/work/shop/scenity.project.json", surfaces },
    ...{ runs: {}, setup: null, gate: null, contentRoots: [], denylist: [], credentialFile: ".env", theme: null },
  };
  return { project, git: true, role: "admin", auth: "none", remote: false };
}

describe("the surface tabs from the project", () => {
  const surfaces = [
    info("editor", "Editor", { capabilities: ["scene", "index"], order: 2 }),
    info("preview", "Preview", { order: 1 }),
    info("tools", "Tools", { hidden: true }),
  ];
  const states = surfaces.map((item) =>
    surfaceState({ id: item.id, label: item.label, capabilities: item.capabilities }),
  );

  test("the tabs follow the order with their labels; a hidden surface has no tab, but its frame loads", () => {
    const wrapper = mount(Workbench, {
      props: { host: fakeHost({ surfaces: states, access: access(surfaces) }).host },
    });
    const tabs = wrapper.findAll("[data-testid^=surface-tab-]");
    expect(tabs.map((tab) => tab.text())).toEqual(["Preview", "Editor"]);
    expect(tabs.map((tab) => tab.attributes("title"))).toEqual(["The preview surface (⌘1)", "The editor surface (⌘2)"]);
    expect(wrapper.get("[data-testid=surface-tab-preview]").attributes("aria-current")).toBe("page");
    // The first tab is in front. The frames of the scene surface and of the hidden surface load behind it.
    const loaded = wrapper.findAll("[data-surface-tab]").map((item) => item.attributes("data-surface-tab"));
    expect(loaded).toEqual(["preview", "editor", "tools"]);
  });

  test("⌘2 puts the second tab in front and tells the host", async () => {
    const { host, calls } = fakeHost({ surfaces: states, access: access(surfaces) });
    const wrapper = mount(Workbench, { props: { host } });
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit2", metaKey: true }));
    await nextTick();
    expect(wrapper.get("[data-testid=surface-tab-editor]").attributes("aria-current")).toBe("page");
    expect(calls.filter((call) => call.type === "surface.front").map((call) => call.params)).toEqual([
      { surface: "editor" },
    ]);
    // ⌘3 has no tab: nothing changes.
    globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "Digit3", metaKey: true }));
    await nextTick();
    expect(wrapper.get("[data-testid=surface-tab-editor]").attributes("aria-current")).toBe("page");
    wrapper.unmount();
  });

  test("the built-in project of this repository gives the lab tab, ⌘1", () => {
    const lab = info("lab", "Lab", { capabilities: ["scene", "index"] });
    const wrapper = mount(Workbench, { props: { host: fakeHost({ access: access([lab]) }).host } });
    expect(wrapper.get("[data-testid=surface-tab-lab]").attributes("title")).toBe("The lab surface (⌘1)");
    expect(wrapper.get("[data-testid=surface-tab-lab]").text()).toBe("Lab");
  });
});
