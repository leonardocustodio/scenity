// SPDX-License-Identifier: Apache-2.0
// The compare view of the workbench. The before and after of a turn open in it (the frame and the motion), side by side
// or as a wipe. The picker opens two marked tiles in it. The keys of the page do not act while the view is open.
import type { PickCandidate, PictureRef } from "@scenity/workbench-host/protocol";
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import BeforeAfter from "../../src/claude/BeforeAfter.vue";
import type { TurnDisplay } from "../../src/claude/useTurnHistory";
import CompareDialog from "../../src/compare/CompareDialog.vue";
import { turnPairs } from "../../src/compare/comparePairs";
import { usePickerCompare } from "../../src/compare/usePickerCompare";
import { fakePictures, pictureIdOf, type FakePictures } from "./fakePictures";

function picture(label: string): PictureRef {
  return { id: pictureIdOf(label), simMs: 6350, width: 640, height: 400, mime: "image/webp" };
}
const blob = (label: string) => `blob:picture-${pictureIdOf(label)}`;

const TURN: TurnDisplay = {
  session: "s1",
  turn: 4,
  prompt: "lower the hat hand",
  files: ["families/wave.ts"],
  url: null,
  reloaded: false,
  before: picture("B4"),
  after: picture("A4"),
  beforeSheet: picture("SB4"),
  afterSheet: picture("SA4"),
  window: { from: 4350, to: 8350, times: [4350, 8350], camera: "top", source: "time" },
};

let pictures: FakePictures;
beforeEach(() => {
  pictures = fakePictures();
});
afterEach(() => {
  pictures.stop();
  document.body.innerHTML = "";
});

const dialog = () => document.querySelector('[data-testid="compare-dialog"]');
const testid = (id: string) => document.querySelector<HTMLElement>(`[data-testid="${id}"]`);

describe("the compare view of a turn", () => {
  it("opens the before and after of a turn large, with the frame and the motion", async () => {
    const panel = mount(BeforeAfter, { props: { turn: TURN }, attachTo: document.body });
    expect(dialog()).toBeNull();
    await panel.get('[data-testid="before-after-compare"]').trigger("click");
    await flushPromises();
    expect(dialog()?.getAttribute("aria-label")).toBe("Compare: Turn 4");
    expect(testid("compare-a")?.getAttribute("src")).toBe(blob("B4"));
    expect(testid("compare-b")?.getAttribute("src")).toBe(blob("A4"));
    testid("compare-pair-motion")?.click();
    await flushPromises();
    expect(testid("compare-a")?.getAttribute("src")).toBe(blob("SB4"));
    expect(testid("compare-b")?.getAttribute("src")).toBe(blob("SA4"));
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    await flushPromises();
    expect(dialog()).toBeNull();
    panel.unmount();
  });

  it("cuts B over A at the line of the wipe, swaps the sides and keeps the line over the pairs", async () => {
    const view = mount(CompareDialog, { props: { pairs: turnPairs(TURN), title: "Turn 4" }, attachTo: document.body });
    await flushPromises();
    testid("compare-wipe-mode")?.click();
    await flushPromises();
    expect(dialog()?.getAttribute("data-mode")).toBe("wipe");
    expect(testid("compare-b")?.getAttribute("style")).toContain("inset(0 0 0 50%)");
    const range = testid("compare-split") as HTMLInputElement;
    range.value = "20";
    range.dispatchEvent(new Event("input"));
    await flushPromises();
    expect(testid("compare-b")?.getAttribute("style")).toContain("inset(0 0 0 20%)");
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    await flushPromises();
    expect(testid("compare-line")?.getAttribute("style")).toContain("left: 25%");
    testid("compare-swap")?.click();
    await flushPromises();
    expect(testid("compare-a")?.getAttribute("src")).toBe(blob("A4"));
    testid("compare-pair-motion")?.click();
    await flushPromises();
    expect(testid("compare-b")?.getAttribute("style")).toContain("inset(0 0 0 25%)");
    expect(testid("compare-a")?.getAttribute("src")).toBe(blob("SA4"));
    testid("compare-close")?.click();
    expect(view.emitted("close")).toHaveLength(1);
    view.unmount();
  });

  it("keeps the keys of the page from acting while it is open", () => {
    const seen: string[] = [];
    const listener = (event: KeyboardEvent) => seen.push(event.key);
    globalThis.addEventListener("keydown", listener);
    const view = mount(CompareDialog, { props: { pairs: turnPairs(TURN), title: "Turn 4" }, attachTo: document.body });
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "1", bubbles: true }));
    view.unmount();
    document.dispatchEvent(new KeyboardEvent("keydown", { key: "2", bubbles: true }));
    globalThis.removeEventListener("keydown", listener);
    expect(seen).toEqual(["2"]);
  });
});

describe("the compare action of the picker", () => {
  const tile = (id: string) => ({ id, label: `tile ${id}`, kind: "tune", tune: "a:1" }) as PickCandidate;

  it("opens two marked tiles as A and B in mark order, and a third mark starts a new pair", () => {
    const [x, y, z] = [tile("x"), tile("y"), tile("z")];
    const tiles = [x, y, z];
    const compare = usePickerCompare(
      () => tiles,
      (item) => ({ label: item.label, picture: null, url: `blob:${item.id}`, simMs: null }),
    );
    compare.toggle(y);
    expect(compare.pairs.value).toBeNull();
    compare.toggle(x);
    expect(compare.pairs.value?.[0]?.a.url).toBe("blob:y");
    expect(compare.pairs.value?.[0]?.b.url).toBe("blob:x");
    compare.toggle(z);
    expect(compare.marked.value).toEqual(["z"]);
    compare.toggle(z);
    expect(compare.marked.value).toEqual([]);
  });

  it("shows tiles by URL (a run file) in the view", async () => {
    const view = mount(CompareDialog, {
      props: {
        pairs: [
          {
            label: "Sheets",
            a: { label: "tile x", picture: null, url: "blob:x", simMs: null },
            b: { label: "tile y", picture: null, url: "blob:y", simMs: null },
          },
        ],
        title: "Picker sheets",
      },
      attachTo: document.body,
    });
    await flushPromises();
    expect(testid("compare-a")?.getAttribute("src")).toBe("blob:x");
    expect(testid("compare-b")?.getAttribute("src")).toBe("blob:y");
    expect(document.querySelector('[data-testid^="compare-pair-"]')).toBeNull();
    view.unmount();
  });
});
