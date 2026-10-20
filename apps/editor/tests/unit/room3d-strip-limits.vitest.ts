// SPDX-License-Identifier: Apache-2.0
// The limits of the frame strip: the lane samples of a clock that plays for a long time stay at one sample per 100 ms
// of the range. A sample keeps the last value of its bucket.
import { describe, expect, it } from "vitest";
import type { LaneSample } from "../../src/core/lanes";
import { withSample } from "../../src/core/browser/useFrameStrip";

const member = (clip: string) => [{ id: "ada", clip, family: "wave" }];

describe("the lane samples of the strip", () => {
  it("keeps one sample per 100 ms of the range over ten minutes of play (a loop of the window)", () => {
    const range = { from: 4_000, to: 12_000 };
    let samples: readonly LaneSample[] = [];
    // Ten minutes of play at one capture per 100 ms (with a jitter). The clock loops over the window.
    for (let step = 0; step < 6_000; step += 1) {
      const at = range.from + ((step * 103 + (step % 7)) % (range.to - range.from));
      samples = withSample(samples, { at, members: member(`clip_${String(step % 3)}`) }, range);
    }
    expect(samples.length).toBeLessThanOrEqual((range.to - range.from) / 100 + 1);
    expect(new Set(samples.map((sample) => Math.round(sample.at / 100))).size).toBe(samples.length);
  });

  it("keeps the last sample of a bucket and no sample out of the range", () => {
    const range = { from: 0, to: 1_000 };
    let samples = withSample([], { at: 210, members: member("a") }, range);
    samples = withSample(samples, { at: 190, members: member("b") }, range);
    expect(samples).toEqual([{ at: 190, members: member("b") }]);
    expect(withSample(samples, { at: 5_000, members: member("c") }, range)).toBe(samples);
    expect(withSample(samples, { at: 1_050, members: member("c") }, range)).toHaveLength(2);
  });
});
