// SPDX-License-Identifier: Apache-2.0
// The Frame index panel: the frames by plan, camera and time, the stale marks, a pick of two frames to compare, Before,
// and the index job.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import FrameIndexPanel from "../../src/scene/frameIndex/FrameIndexPanel.vue";
import {
  camerasOf,
  cellOf,
  pick,
  planName,
  plansOf,
  timesOf,
  type FrameRow,
} from "../../src/scene/frameIndex/frameIndexModel";
import { editorI18n } from "../../src/texts";

const frame = (key: string, change: Partial<FrameRow> = {}): FrameRow => ({
  key,
  plan: "sequence:sequences/meet.sequence.json",
  scene: "scenes/plaza.scene.json",
  sequence: "sequences/meet.sequence.json",
  camera: "front",
  time: 0,
  moment: true,
  made: "2026-10-19T10:00:00.000Z",
  stale: false,
  ...change,
});

const FRAMES = [
  frame("a"),
  frame("b", { time: 500 }),
  frame("c", { camera: "top" }),
  frame("d", { time: 500, made: "2026-10-18T10:00:00.000Z", stale: true }),
  frame("e", { plan: "scene:scenes/empty.scene.json", sequence: null, camera: null, moment: false }),
];

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the model of the frame index", () => {
  it("groups the frames by plan, camera and time, with the picture before a change", () => {
    expect(plansOf(FRAMES)).toEqual(["sequence:sequences/meet.sequence.json", "scene:scenes/empty.scene.json"]);
    expect(camerasOf(FRAMES, "sequence:sequences/meet.sequence.json")).toEqual(["front", "top"]);
    expect(timesOf(FRAMES, "sequence:sequences/meet.sequence.json")).toEqual([0, 500]);
    expect(cellOf(FRAMES, "sequence:sequences/meet.sequence.json", "front", 500)).toEqual({
      newest: FRAMES[1],
      before: FRAMES[3],
    });
    expect(cellOf(FRAMES, "sequence:sequences/meet.sequence.json", "top", 500)).toBeNull();
    expect(planName("sequence:sequences/meet.sequence.json")).toBe("meet");
    expect(pick(pick(pick([], "a"), "b"), "c")).toEqual(["b", "c"]);
    expect(pick(["a", "b"], "a")).toEqual(["b"]);
  });
});

describe("the Frame index panel", () => {
  it("shows the grid with the stale marks, compares two frames and starts the index", async () => {
    const posts: string[] = [];
    vi.stubGlobal("fetch", (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        posts.push(url);
        return Promise.resolve(Response.json({ ok: true }));
      }
      return Promise.resolve(Response.json({ running: false, log: [], code: 0, wanted: 4, frames: FRAMES }));
    });
    const wrapper = mount(FrameIndexPanel, {
      props: { base: "/projects/walk/" },
      global: { plugins: [editorI18n().plugin] },
    });
    await flushPromises();
    expect(wrapper.find("[data-testid=frames-count]").text()).toBe("Pictures: 5 · frames now: 4 · stale: 1");
    const cells = wrapper.findAll("[data-testid=frames-cell]");
    expect(cells).toHaveLength(3);
    expect(cells[0]?.find("img").attributes("src")).toContain("/projects/walk/frames/a.png");
    await wrapper.find("[data-testid=frames-before]").trigger("click");
    expect(wrapper.findAll("[data-testid=frames-compare] figure")).toHaveLength(2);
    expect(wrapper.find("[data-testid=frames-compare]").text()).toContain("stale");
    await cells[2]?.trigger("click");
    expect(wrapper.findAll("[data-testid=frames-compare] img").map((img) => img.attributes("src"))).toEqual([
      expect.stringContaining("/b.png"),
      expect.stringContaining("/c.png"),
    ]);
    await wrapper.find("[data-testid=frames-index]").trigger("click");
    await flushPromises();
    expect(posts).toEqual(["/projects/walk/frames.index"]);
    wrapper.unmount();
  });

  it("shows the empty state with no frame", async () => {
    vi.stubGlobal("fetch", () =>
      Promise.resolve(Response.json({ running: false, log: [], code: null, wanted: 0, frames: [] })),
    );
    const wrapper = mount(FrameIndexPanel, {
      props: { base: "/projects/walk/" },
      global: { plugins: [editorI18n().plugin] },
    });
    await flushPromises();
    expect(wrapper.find("[data-empty=frameIndex]").text()).toContain("No frame yet");
    wrapper.unmount();
  });
});
