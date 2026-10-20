// SPDX-License-Identifier: Apache-2.0
// Solo and hide of the lab page. H hides the selected items in the focused pane. Shift+H shows only them (a second
// press shows every item). Alt+H (or H without a selection) shows every item. The commands take `all` for every pane.
// Hidden items draw in no pane (`all`, or each pane hidden), and the captures obey the flag only when asked. The hide
// is a render flag per pane: not in the URL, not a tune value, not in the frame key. The tests of the plugin of the
// room check the labs core part (the objects of a pane, the pick) and the pixels.
import { frameKey } from "@scenity/labs-platform/frameKey";
import type { HideSpec, SelectTarget } from "@scenity/runtime-dev";
import { mount } from "@vue/test-utils";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { defineComponent, h, nextTick, ref, shallowRef } from "vue";
import { captureTarget } from "../../src/core/bridge/workbenchCapture";
import { useHide, withHidden, withSolo, type HideTool } from "../../src/core/editor/useHide";
import { labFrameInput } from "../../src/core/index/frameInput";
import type { Room3DLabApi } from "../../src/core/useLabApi";

const CART: SelectTarget = { kind: "prop", id: "cart" };
const CY: SelectTarget = { kind: "member", id: "cy" };
const mounted: { unmount(): void }[] = [];

beforeEach(() => {
  globalThis.__room3dLab = {} as Room3DLabApi;
  globalThis.history.replaceState(null, "", "/?take=greet&t=5000&paused=1");
});

afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  globalThis.__room3dLab = undefined;
});

interface Page {
  readonly tool: HideTool;
  readonly sent: HideSpec[];
  readonly runs: string[];
  readonly focus: { value: number };
  readonly full: { value: number | null };
  readonly count: { value: number };
  readonly selected: { value: SelectTarget[] };
}

function pageOf(): Page {
  const sent: HideSpec[] = [];
  const runs: string[] = [];
  const focus = ref(0);
  const full = ref<number | null>(null);
  const count = ref(2);
  const selected = shallowRef<SelectTarget[]>([CART]);
  const made: { tool: HideTool | null } = { tool: null };
  mounted.push(
    mount(
      defineComponent({
        setup() {
          made.tool = useHide({
            panes: { focus, full, count: () => count.value },
            view: () => ({ hide: (spec) => sent.push(spec) }),
            selected: () => selected.value,
            run: (command) => runs.push(command),
          });
          return () => h("div");
        },
      }),
      { attachTo: document.body },
    ),
  );
  if (made.tool === null) throw new Error("no tool");
  return { tool: made.tool, sent, runs, focus, full, count, selected };
}

describe("the hide of a pane", () => {
  it("H hides the items in the focused pane only; the other pane shows them", async () => {
    const page = pageOf();
    page.focus.value = 1;
    page.tool.host.hide([CART, CY], false);
    await nextTick();
    expect(page.tool.drawn()).toEqual({ panes: [null, { hidden: [CART, CY], solo: null }] });
    expect(page.sent.at(-1)).toEqual(page.tool.drawn());
    // The same item again: no second entry.
    page.tool.host.hide([CART], false);
    expect(page.tool.state.value[1]?.hidden).toEqual([CART, CY]);
    // A pane at full size draws the hide of that pane as its one pane.
    page.full.value = 1;
    expect(page.tool.drawn()).toEqual({ panes: [{ hidden: [CART, CY], solo: null }] });
    page.full.value = 0;
    expect(page.tool.drawn()).toEqual({ panes: [null] });
  });

  it("all: true hides the items in every pane (they draw in no pane); Alt+H shows them again", () => {
    const page = pageOf();
    page.count.value = 4;
    page.tool.host.hide([CART], true);
    const panes = page.tool.drawn().panes;
    expect(panes).toHaveLength(4);
    for (const pane of panes) expect(pane).toEqual({ hidden: [CART], solo: null });
    page.tool.host.showAll(false);
    expect(page.tool.drawn().panes[0]).toBeNull();
    expect(page.tool.drawn().panes[1]).toEqual({ hidden: [CART], solo: null });
    page.tool.host.showAll(true);
    expect(page.tool.drawn()).toEqual({ panes: [] });
  });

  it("Shift+H shows only the items; Shift+H again on the same items shows every item", () => {
    const solo = withSolo(null, [CART]);
    expect(solo).toEqual({ hidden: [], solo: [CART] });
    expect(withSolo(solo, [CART])).toBeNull();
    expect(withSolo(solo, [CY])).toEqual({ hidden: [], solo: [CY] });
    // A hidden item leaves the solo list.
    expect(withHidden({ hidden: [], solo: [CART, CY] }, [CY])).toEqual({ hidden: [CY], solo: [CART] });
    const page = pageOf();
    page.tool.host.solo([CART], false);
    expect(page.tool.state.value[0]).toEqual({ hidden: [], solo: [CART] });
    page.tool.host.solo([CART], false);
    expect(page.tool.drawn()).toEqual({ panes: [] });
  });

  it("the keys: H hides, Shift+H solo, Alt+H and H without a selection show every item", () => {
    const page = pageOf();
    const key = (keys: KeyboardEventInit): void => {
      globalThis.dispatchEvent(new KeyboardEvent("keydown", { code: "KeyH", ...keys }));
    };
    key({});
    key({ shiftKey: true });
    key({ altKey: true });
    key({ metaKey: true });
    page.selected.value = [];
    key({});
    expect(page.runs).toEqual(["view.hide", "view.solo", "view.showAll", "view.showAll"]);
  });

  it("is a view flag: no URL change, no frame key change; the captures ask for it with hidden: true", () => {
    const page = pageOf();
    const before = globalThis.location.href;
    const state = {
      take: "greet",
      track: null,
      events: [],
      tunes: {},
      debug: [],
      assets: true,
      reduced: false,
      tier: "high",
    } as const;
    const key = frameKey(labFrameInput(state, 5000, "chest", "content"));
    page.tool.host.hide([CART], true);
    expect(globalThis.location.href).toBe(before);
    expect(frameKey(labFrameInput(state, 5000, "chest", "content"))).toBe(key);
    // The bridge capture (lab_frame): the flag only when asked.
    expect(captureTarget({ pane: 1 })).toEqual({ pane: 1 });
    expect(captureTarget({ pane: 1, hidden: true })).toEqual({ pane: 1, hidden: true });
    expect(captureTarget({ hidden: false })).toEqual({});
  });
});
