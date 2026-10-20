// SPDX-License-Identifier: Apache-2.0
/**
 * The "Restart host" button of the top bar. It sends `host.restart`. The status line says that the host restarts until
 * the next hello. A host without a supervisor gives its reason.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import Workbench from "../../src/Workbench.vue";
import { CHECKOUT, fakeHost } from "./fakeHost";

describe("Restart host", () => {
  test("the button sends host.restart; the status line shows the restart until the next hello", async () => {
    const { host, calls, checkout } = fakeHost({ answers: { "host.restart": () => ({ restarting: true }) } });
    const wrapper = mount(Workbench, { props: { host } });
    await wrapper.get("[data-testid=restart-host]").trigger("click");
    await flushPromises();
    expect(calls.filter((call) => call.type === "host.restart")).toHaveLength(1);
    expect(wrapper.get("[data-testid=status-line]").text()).toContain("The host restarts");
    expect(wrapper.get("[data-testid=restart-host]").attributes("disabled")).toBeDefined();
    checkout.value = { ...CHECKOUT };
    await flushPromises();
    expect(wrapper.get("[data-testid=status-line]").text()).not.toContain("The host restarts");
  });

  test("a host without a supervisor gives its reason in the status line", async () => {
    const { host } = fakeHost({
      answers: {
        "host.restart": () => {
          throw new Error("This host runs without its supervisor, so it cannot restart itself.");
        },
      },
    });
    const wrapper = mount(Workbench, { props: { host } });
    await wrapper.get("[data-testid=restart-host]").trigger("click");
    await flushPromises();
    expect(wrapper.get("[data-testid=status-line]").text()).toContain("without its supervisor");
    expect(wrapper.get("[data-testid=restart-host]").attributes("disabled")).toBeUndefined();
  });
});
