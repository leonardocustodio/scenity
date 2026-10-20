// SPDX-License-Identifier: Apache-2.0
/**
 * The smoke test of the workbench page: the page mounts and says that no host is connected.
 */
import { PROTOCOL_VERSION } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import Workbench from "../../src/Workbench.vue";

describe("Workbench", () => {
  test("says that the host is not connected", async () => {
    // The page finds the endpoint first. The URL of the test page names no host.
    const wrapper = mount(Workbench);
    await flushPromises();
    const panel = wrapper.get("[data-testid=workbench-no-host]");
    expect(panel.text()).toContain("The host is not connected.");
    expect(panel.text()).toContain(`Protocol ${String(PROTOCOL_VERSION)}`);
  });
});
