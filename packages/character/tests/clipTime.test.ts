// SPDX-License-Identifier: Apache-2.0
// The clip times of the characters (src/clipTime.ts): the parts of an in/hold/out clip, a once clip in a short or a
// long phase, and the phase length.
import { describe, expect, it } from "bun:test";
import { cycleShare, fitOnce, inHoldOut, phaseLength } from "../src/clipTime";

describe("inHoldOut", () => {
  it("plays the in part, holds, and ends the out part at the phase end", () => {
    expect(inHoldOut(0, 1000, 600, 5000)).toMatchObject({ part: "in", weight: 0 });
    expect(inHoldOut(500, 1000, 600, 5000)).toMatchObject({ part: "in", weight: 0.5 });
    expect(inHoldOut(2000, 1000, 600, 5000)).toMatchObject({ part: "hold", weight: 1, holdMs: 1000 });
    expect(inHoldOut(4400, 1000, 600, 5000)).toMatchObject({ part: "out", weight: 1 });
    expect(inHoldOut(5000, 1000, 600, 5000)).toMatchObject({ part: "out", weight: 0 });
  });

  it("plays the in and the out faster in a short phase, and has no out part without a phase end", () => {
    expect(inHoldOut(400, 1000, 600, 800)).toMatchObject({ part: "in" });
    expect(inHoldOut(600, 1000, 600, 800)).toMatchObject({ part: "out" });
    expect(inHoldOut(9000, 1000, 600, null)).toMatchObject({ part: "hold", holdMs: 8000 });
    expect(inHoldOut(0, 1000, 600, 5000, true)).toMatchObject({ part: "hold", weight: 1 });
  });
});

describe("fitOnce and phaseLength", () => {
  it("plays a once clip faster in a short phase and holds its end in a long one", () => {
    expect(fitOnce(1000, 4000, 2000)).toBe(2000);
    expect(fitOnce(1000, 4000, 8000)).toBe(1000);
    expect(fitOnce(1000, 4000, null)).toBe(1000);
  });

  it("gives the phase length from the view times", () => {
    expect(phaseLength({ phaseStartMs: 1000, phaseEndMs: 4000 })).toBe(3000);
    expect(phaseLength({ phaseStartMs: 1000 })).toBeNull();
    expect(phaseLength({ phaseStartMs: null, phaseEndMs: 4000 })).toBeNull();
  });

  it("gives the share of a cycle, also before the time 0", () => {
    expect(cycleShare(250, 1000)).toBe(0.25);
    expect(cycleShare(-250, 1000)).toBe(0.75);
  });
});
