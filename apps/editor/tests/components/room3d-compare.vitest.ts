// SPDX-License-Identifier: Apache-2.0
// The compare view of the lab: the linked clock of both sides, and the wipe. The tests of the sides in the URL and of
// the frames of a side need the editor plugin of a room. Thus they are in the editor face of the room plugin
// (CodeBlue).
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import CompareStage from "../../src/core/compare/CompareStage.vue";
import type { FrameShot } from "../../src/core/compare/compareFrames";
import type { CompareSide } from "../../src/core/compare/sources";
import { useCompare } from "../../src/core/compare/useCompare";

describe("the linked clock", () => {
  function linked(delay: (side: CompareSide) => number = () => 0) {
    const asked: string[] = [];
    const compare = useCompare({
      a: { kind: "take", take: "greet" },
      b: { kind: "take", take: "parade" },
      timeMs: 0,
      camera: "chest",
      end: () => 20_000,
      frame: async (side, timeMs, camera): Promise<FrameShot> => {
        asked.push(`${side.take}@${String(timeMs)}/${camera}`);
        await new Promise((resolve) => setTimeout(resolve, delay(side)));
        return { url: `blob:${side.take}-${String(timeMs)}`, simMs: timeMs, from: "render", ms: 1, note: null };
      },
    });
    return { compare, asked };
  }

  it("asks both sides for the same time at each seek, step and camera", async () => {
    const { compare, asked } = linked();
    await compare.seek(14_136);
    await compare.step(100);
    await compare.setCamera("top");
    expect(asked).toEqual([
      "greet@14136/chest",
      "parade@14136/chest",
      "greet@14236/chest",
      "parade@14236/chest",
      "greet@14236/top",
      "parade@14236/top",
    ]);
    expect(compare.shown.value).toBe(14_236);
    expect(compare.shots.value.a?.simMs).toBe(compare.shots.value.b?.simMs);
    await compare.seek(99_000);
    expect(compare.timeMs.value).toBe(20_000);
  });

  it("shows only the newest time after a fast scrub, never a pair of two times", async () => {
    const { compare } = linked((side) => (side.take === "greet" ? 5 : 1));
    const first = compare.seek(1_000);
    const second = compare.seek(2_000);
    await Promise.all([first, second]);
    expect(compare.shown.value).toBe(2_000);
    expect([compare.shots.value.a?.simMs, compare.shots.value.b?.simMs]).toEqual([2_000, 2_000]);
  });

  it("plays both sides in steps of 100 ms and stops at the end", async () => {
    const { compare } = linked();
    await compare.seek(19_800);
    compare.play();
    await new Promise((resolve) => setTimeout(resolve, 450));
    expect(compare.playing.value).toBe(false);
    expect(compare.shown.value).toBe(20_000);
  });
});

describe("the wipe", () => {
  const side = (label: string) => ({ label, url: `blob:${label}`, note: null, simMs: 14_136 });

  it("shows A and B side by side, or B over A cut at the line of the wipe", async () => {
    const stage = (mode: "side" | "wipe", split: number) =>
      mount(CompareStage, { props: { a: side("greet"), b: side("parade"), mode, split }, attachTo: document.body });
    const sides = stage("side", 50);
    expect(sides.get('[data-testid="compare-a"]').attributes("src")).toBe("blob:greet");
    expect(sides.get('[data-testid="compare-b"]').attributes("style") ?? "").not.toContain("clip-path");
    const wipe = stage("wipe", 50);
    expect(wipe.get('[data-testid="compare-b"]').attributes("style")).toContain("inset(0 0 0 50%)");
    await wipe.get('[data-testid="compare-split"]').setValue("30");
    expect(wipe.emitted("update:split")?.at(-1)).toEqual([30]);
    const moved = stage("wipe", 30);
    expect(moved.get('[data-testid="compare-b"]').attributes("style")).toContain("inset(0 0 0 30%)");
    expect(moved.get('[data-testid="compare-wipe-line"]').attributes("style")).toContain("left: 30%");
  });

  it("moves the line with a drag on the stage", async () => {
    const stage = mount(CompareStage, {
      props: { a: side("greet"), b: side("parade"), mode: "wipe", split: 50 },
      attachTo: document.body,
    });
    const wipe = stage.get('[data-testid="compare-wipe"]');
    Object.defineProperty(wipe.element, "getBoundingClientRect", {
      value: () => ({ left: 100, width: 400, top: 0, height: 250 }),
    });
    await wipe.trigger("pointerdown", { clientX: 200 });
    await wipe.trigger("pointermove", { clientX: 400 });
    await flushPromises();
    expect(stage.emitted("update:split")?.map((item) => item[0])).toEqual([25, 75]);
    await wipe.trigger("pointerup");
    await wipe.trigger("pointermove", { clientX: 450 });
    expect(stage.emitted("update:split")).toHaveLength(2);
  });
});
