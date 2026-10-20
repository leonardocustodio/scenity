// SPDX-License-Identifier: Apache-2.0
/**
 * The sandbox of the lab frames. The visible frame and the shadow frame have the `sandbox` attribute with
 * exactly the tokens of frameSandbox.ts: scripts, the own origin of the lab server and forms. No token lets the frame
 * open a window, navigate the workbench page or leave the sandbox.
 */
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, test } from "vitest";
import Workbench from "../../src/Workbench.vue";
import { LAB_FRAME_SANDBOX, LAB_FRAME_SANDBOX_TOKENS } from "../../src/surfaces/frameSandbox";
import { fakeHost, surfaceState } from "./fakeHost";

/** The tokens of the `sandbox` attribute, sorted. */
function tokens(value: string | undefined): string[] {
  return (value ?? "")
    .split(/\s+/)
    .filter((token) => token !== "")
    .sort();
}

describe("the sandbox of the lab frames", () => {
  test("the visible frame and the shadow frame have the tokens of the lab page only", async () => {
    const { host, surfaces } = fakeHost();
    // Out of the document: happy-dom loads no frame page.
    const wrapper = mount(Workbench, { props: { host } });
    surfaces.value = [surfaceState({ shadowUrl: "http://127.0.0.1:5400/?take=greet&panel=0&dock=0" })];
    await flushPromises();
    for (const where of ["visible", "shadow"]) {
      const sandbox = wrapper.get(`[data-testid=surface-frame-${where}]`).attributes("sandbox");
      expect(tokens(sandbox)).toEqual(["allow-forms", "allow-same-origin", "allow-scripts"]);
      for (const refused of [
        "allow-popups",
        "allow-popups-to-escape-sandbox",
        "allow-top-navigation",
        "allow-top-navigation-by-user-activation",
        "allow-modals",
        "allow-downloads",
      ])
        expect(tokens(sandbox)).not.toContain(refused);
    }
  });

  test("the attribute value is the token list", () => {
    expect(tokens(LAB_FRAME_SANDBOX)).toEqual([...LAB_FRAME_SANDBOX_TOKENS].sort());
  });
});
