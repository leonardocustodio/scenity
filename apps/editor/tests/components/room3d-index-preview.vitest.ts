// SPDX-License-Identifier: Apache-2.0
// The hover preview and the overview strip of the time line. The hover preview shows the tile of the frame index at the
// time under the pointer, with its stale mark and metrics. The overview strip shows the tiles of the index, and a click
// on a tile seeks.
import type { IndexedFrame } from "@scenity/labs-platform/indexRead";
import type { IndexFrame } from "@scenity/labs-platform/indexStore";
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { ref } from "vue";
import { LAB_INDEX, type LabIndex } from "../../src/core/index/useLabIndex";
import LabIndexPreview from "../../src/core/LabIndexPreview.vue";
import { LAB_CONTEXT, type LabContext } from "../../src/core/labContext";

function frame(timeMs: number): IndexFrame {
  return {
    key: `k${String(timeMs)}`.padEnd(32, "0"),
    timeMs,
    step: 100,
    view: "overview",
    size: 160,
    mime: "image/webp",
    bytes: 2,
    metrics: { "ada|ik.reachError|m": 0.012 },
    usedAt: 0,
  } as unknown as IndexFrame;
}

/** A lab index with frames every second up to 20 s; the frame at 5 s is stale. */
function fakeIndex(): LabIndex {
  const lookup = (timeMs: number, options?: { readonly maxGapMs?: number }): IndexedFrame | null => {
    const near = Math.round(timeMs / 1000) * 1000;
    if (Math.abs(near - timeMs) > (options?.maxGapMs ?? 100) || near > 20_000) return null;
    return { frame: frame(near), stale: near === 5000 };
  };
  return {
    lookup,
    picture: (item: IndexFrame) => Promise.resolve(`blob:frame-${String(item.timeMs)}`),
  } as unknown as LabIndex;
}

/** The provides of the lab page: the index and the take of the lab context. */
function global() {
  const lab = { take: { base: ref("greet") } } as unknown as LabContext;
  return { provide: { [LAB_INDEX as symbol]: fakeIndex(), [LAB_CONTEXT as symbol]: lab } };
}

describe("the hover preview of the time line", () => {
  it("shows the frame of the index at the time under the pointer, with the stale mark and the metrics", async () => {
    const wrapper = mount(LabIndexPreview, { props: { at: null, left: "25%" }, global: global() });
    expect(wrapper.find('[data-testid="lab-timeline-preview"]').exists()).toBe(false);
    await wrapper.setProps({ at: 3040 });
    await flushPromises();
    const tile = wrapper.get('[data-testid="lab-timeline-preview"]');
    expect(tile.attributes("data-at")).toBe("3000");
    expect(tile.attributes("data-stale")).toBe("false");
    expect(tile.get("img").attributes("src")).toBe("blob:frame-3000");
    expect(tile.text()).toContain("ada ik.reachError 0.012 m");
    expect(Number(tile.attributes("data-ms"))).toBeLessThanOrEqual(20);
    await wrapper.setProps({ at: 5000 });
    await flushPromises();
    expect(wrapper.get('[data-testid="lab-timeline-preview"]').attributes("data-stale")).toBe("true");
    await wrapper.setProps({ at: 5500 });
    await flushPromises();
    expect(wrapper.find('[data-testid="lab-timeline-preview"]').exists()).toBe(false);
  });
});
