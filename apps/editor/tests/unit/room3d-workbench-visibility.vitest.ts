// SPDX-License-Identifier: Apache-2.0
// The visibility of a surface page in a hidden tab. The call `visibility` hides the root of the page. A call that
// needs frames shows it for the call and hides it again after LINGER_MS. A 3D room before its first frame keeps the
// page visible.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  LINGER_MS,
  pageVisibility,
  RETRY_MS,
  WAKE_PAINTS,
  type VisibilityHost,
} from "../../src/core/bridge/workbenchVisibility";

function fakeHost(busy = { value: false }) {
  const style = new Map<string, string>();
  const paints = { count: 0 };
  const host: VisibilityHost = {
    root: {
      style: {
        setProperty: (name: string, value: string | null) => {
          style.set(name, value ?? "");
        },
        removeProperty: (name: string) => {
          const old = style.get(name) ?? "";
          style.delete(name);
          return old;
        },
      },
    },
    busy: () => busy.value,
    setTimeout: (run, ms) => setTimeout(run, ms),
    clearTimeout: (handle) => {
      clearTimeout(handle as ReturnType<typeof setTimeout>);
    },
    paint: () => {
      paints.count += 1;
      return Promise.resolve();
    },
  };
  return { host, style, paints, busy };
}

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("the visibility of a surface page", () => {
  it("hides and shows the root on the call", () => {
    const { host, style } = fakeHost();
    const page = pageVisibility(host);
    expect(page.set("hidden")).toBe("hidden");
    expect(style.get("display")).toBe("none");
    expect(page.set("visible")).toBe("visible");
    expect(style.has("display")).toBe(false);
    expect(page.set("anything")).toBe("visible");
  });

  it("wakes a hidden page for a call that needs frames, then hides it after the linger time", async () => {
    const { host, style, paints } = fakeHost();
    const page = pageVisibility(host);
    page.set("hidden");
    let shownInCall = false;
    const result = await page.during(() => {
      shownInCall = !style.has("display");
      return Promise.resolve(42);
    });
    expect(result).toBe(42);
    expect(shownInCall).toBe(true);
    expect(paints.count).toBe(WAKE_PAINTS);
    expect(page.state()).toBe("visible");
    vi.advanceTimersByTime(LINGER_MS + 1);
    expect(page.state()).toBe("hidden");
    // A second call in the linger time needs no wake.
    await page.during(() => Promise.resolve(null));
    vi.advanceTimersByTime(LINGER_MS / 2);
    await page.during(() => Promise.resolve(null));
    expect(paints.count).toBe(WAKE_PAINTS * 2);
  });

  it("keeps a page with a 3D room before its first frame visible until the frame", () => {
    const { host, style, busy } = fakeHost({ value: true });
    const page = pageVisibility(host);
    expect(page.set("hidden")).toBe("visible");
    busy.value = false;
    vi.advanceTimersByTime(RETRY_MS + 1);
    expect(style.get("display")).toBe("none");
    page.stop();
    expect(style.has("display")).toBe(false);
  });
});
