// SPDX-License-Identifier: Apache-2.0
/**
 * The tab in front goes to the host. Each tab change sends `surface.front`. A new hello (a reconnect or a restarted
 * host) sends the tab again. Thus the prompt hook sends the packet of the surface that the owner sees.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import Workbench from "../../src/Workbench.vue";
import { CHECKOUT, fakeHost, surfaceState } from "./fakeHost";

function fronts(calls: readonly { type: string; params: unknown }[]): unknown[] {
  return calls.filter((call) => call.type === "surface.front").map((call) => call.params);
}

describe("the surface in front", () => {
  test("a tab change and a new hello send surface.front", async () => {
    const { host, calls, checkout } = fakeHost({ surfaces: [surfaceState()] });
    const wrapper = mount(Workbench, { props: { host } });
    await wrapper.get("[data-testid=surface-tab-lab]").trigger("click");
    await flushPromises();
    expect(fronts(calls)).toEqual([{ surface: "lab" }]);
    checkout.value = { ...CHECKOUT };
    await flushPromises();
    expect(fronts(calls)).toEqual([{ surface: "lab" }, { surface: "lab" }]);
  });
});
