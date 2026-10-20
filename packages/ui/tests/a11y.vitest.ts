// SPDX-License-Identifier: Apache-2.0
/* eslint-disable vue/one-component-per-file -- The tests define small probe components. */
import { fireEvent, screen, waitFor } from "@testing-library/vue";
import { describe, expect, it } from "vitest";
import { defineComponent, h, nextTick } from "vue";
import {
  createAnnouncer,
  focusElement,
  focusRouteTarget,
  LiveRegions,
  SkipLink,
  usePrefersReducedMotion,
  useAnnouncer,
} from "../src/a11y";
import { renderUi } from "./helpers";

describe("announcer and live regions", () => {
  it("writes polite and assertive text into the two regions, with the rate limit", async () => {
    let now = 0;
    const timers: (() => void)[] = [];
    const announcer = createAnnouncer({
      minIntervalMs: 2000,
      now: () => now,
      schedule: (run) => {
        timers.push(run);
        return () => undefined;
      },
    });
    const Speaker = defineComponent({
      setup() {
        const a = useAnnouncer();
        return () =>
          h("div", [
            h("button", { onClick: () => a.polite("Sam: Giving now.") }, "line"),
            h("button", { onClick: () => a.assertive("Sam asks: what dose?") }, "question"),
          ]);
      },
    });
    renderUi(defineComponent({ render: () => h("div", [h(Speaker), h(LiveRegions)]) }), { plugins: [announcer] });
    await fireEvent.click(screen.getByText("line"));
    await fireEvent.click(screen.getByText("question"));
    await nextTick();
    await nextTick();
    expect(screen.getByTestId("live-polite").textContent).toBe("Sam: Giving now.");
    expect(screen.getByTestId("live-assertive").textContent).toBe("");
    expect(screen.getByRole("status").getAttribute("aria-live")).toBe("polite");
    now = 2000;
    timers.shift()?.();
    await waitFor(() => {
      expect(screen.getByTestId("live-assertive").textContent).toBe("Sam asks: what dose?");
    });
    expect(screen.getByTestId("live-assertive").getAttribute("aria-live")).toBe("assertive");
  });

  it("useAnnouncer without an announcer is silent", () => {
    const Probe = defineComponent({
      setup() {
        const a = useAnnouncer();
        a.polite("nothing happens");
        return () => h("p", "ok");
      },
    });
    renderUi(Probe);
    expect(screen.getByText("ok")).toBeTruthy();
  });
});

describe("focus management", () => {
  it("moves the focus to the page title after a route change", () => {
    document.body.innerHTML = '<main id="main"><h1>Library</h1><button>Start</button></main>';
    const target = focusRouteTarget();
    expect(target?.tagName).toBe("H1");
    expect(document.activeElement?.textContent).toBe("Library");
    expect(target?.getAttribute("tabindex")).toBe("-1");
  });

  it("prefers an explicit route-focus target and leaves focusable elements as they are", () => {
    document.body.innerHTML = "<main><h1>Room</h1><button data-route-focus>Enter</button></main>";
    const target = focusRouteTarget();
    expect(target?.tagName).toBe("BUTTON");
    expect(target?.hasAttribute("tabindex")).toBe(false);
    expect(focusElement(null)).toBe(false);
  });

  it("SkipLink moves the focus to the main content", async () => {
    renderUi(defineComponent({ render: () => h("div", [h(SkipLink), h("main", { id: "main" }, "content")]) }));
    const link = screen.getByRole("link", { name: "Skip to main content" });
    expect(link.getAttribute("href")).toBe("#main");
    await fireEvent.click(link);
    expect(document.activeElement?.id).toBe("main");
  });
});

describe("reduced motion", () => {
  it("follows data-motion on the root element and on a part of the page", async () => {
    let value: { value: boolean } | null = null;
    const Probe = defineComponent({
      setup() {
        value = usePrefersReducedMotion();
        return () => h("p", "probe");
      },
    });
    renderUi(Probe);
    expect(value!.value).toBe(false);
    document.documentElement.dataset.motion = "reduced";
    await waitFor(() => {
      expect(value!.value).toBe(true);
    });
    delete document.documentElement.dataset.motion;
    await waitFor(() => {
      expect(value!.value).toBe(false);
    });
  });
});
