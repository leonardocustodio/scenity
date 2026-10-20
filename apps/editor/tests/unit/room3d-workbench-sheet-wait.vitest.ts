// SPDX-License-Identifier: Apache-2.0
/**
 * The frame wait of the `sheet` call. A cold shadow frame gets a long first wait. A page that draws nothing fails with
 * a clear reason after the time of the sheet. A hidden page fails at once, not after the 240 s of the host.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { CELL_FRAME_MS, FIRST_FRAME_MS, frameWithin } from "../../src/core/bridge/workbenchSheet";

afterEach(() => {
  vi.useRealTimers();
});

describe("the frame wait of a sheet", () => {
  it("gives the first frame more time than the others", () => {
    expect(FIRST_FRAME_MS).toBeGreaterThan(CELL_FRAME_MS);
    expect(FIRST_FRAME_MS).toBeLessThan(240_000);
  });

  it("passes the time to frame() and ends with the frame", async () => {
    const frame = vi.fn(() => Promise.resolve({ simMs: 5000, stats: null }));
    await frameWithin({ frame }, 2_000, { visibilityState: "visible" });
    expect(frame).toHaveBeenCalledWith(2_000);
  });

  it("fails after its time when the page draws nothing", async () => {
    vi.useFakeTimers();
    const frame = vi.fn(() => new Promise<never>(() => undefined));
    const wait = frameWithin({ frame }, 15_000, { visibilityState: "visible" });
    const checked = expect(wait).rejects.toThrow("no frame in 15000 ms");
    await vi.advanceTimersByTimeAsync(16_001);
    await checked;
  });

  it("fails at once in a hidden page", async () => {
    const frame = vi.fn(() => Promise.resolve({ simMs: 0, stats: null }));
    await expect(frameWithin({ frame }, 15_000, { visibilityState: "hidden" })).rejects.toThrow("hidden");
    expect(frame).not.toHaveBeenCalled();
  });
});
