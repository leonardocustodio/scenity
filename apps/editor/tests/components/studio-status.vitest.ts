// SPDX-License-Identifier: Apache-2.0
// The status bar of the editor window: the values from the page, and the action of each item (save, frame, open the
// Rules panel, open the inspect panel). Also the problem counts, the frame rate, and the bell of the facts that need an
// action.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WindowStatus } from "../../src/studio/shell/status";
import StatusBar from "../../src/studio/shell/StatusBar.vue";
import { fpsOf, problemCounts, saveStatus, startStatus } from "../../src/scene/statusParts";

const mounted: { unmount(): void }[] = [];
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount();
  document.body.innerHTML = "";
});

const find = (testId: string): HTMLButtonElement | null =>
  document.querySelector<HTMLButtonElement>(`[data-testid="${testId}"]`);

describe("the status bar", () => {
  it("shows the values of the page and runs the action of each item", async () => {
    const status = new WindowStatus();
    mounted.push(mount(StatusBar, { props: { status }, attachTo: document.body }));
    const listeners: ((ids: readonly string[]) => void)[] = [];
    const save = vi.fn();
    const frame = vi.fn();
    const openPerformance = vi.fn();
    const shown: string[] = [];
    const stop = startStatus(
      { status, showPanel: (id) => shown.push(id) },
      {
        save,
        frame,
        openPerformance,
        selection: { ids: ["lamp"], listen: (listener) => (listeners.push(listener), () => undefined) },
        stats: () => Promise.resolve({ backend: "webgpu", tier: "high", intervalP50: 16.7 }),
      },
    );
    status.set("save", saveStatus("unsaved", true));
    // The Problems panel gives the counts (problems/startProblems.ts).
    status.set("problems", { fail: 1, warn: 1 });
    await new Promise((done) => setTimeout(done, 700));
    await flushPromises();
    expect(find("status-save")?.dataset.state).toBe("unsaved");
    expect(find("status-selection")?.textContent).toContain("1 selected");
    expect(find("status-problems")?.dataset.state).toBe("fail");
    expect(find("status-render")?.textContent.replace(/\s+/g, " ")).toContain("webgpu · high · 60 fps");
    find("status-save")?.click();
    find("status-selection")?.click();
    find("status-render")?.click();
    expect(save).toHaveBeenCalledOnce();
    expect(frame).toHaveBeenCalledOnce();
    expect(shown).toEqual([]);
    expect(openPerformance).toHaveBeenCalledOnce();
    listeners[0]?.([]);
    await flushPromises();
    expect(find("status-selection")?.disabled).toBe(true);
    stop();
  });

  it("keeps the facts that need an action under the bell", async () => {
    const status = new WindowStatus();
    mounted.push(mount(StatusBar, { props: { status }, attachTo: document.body }));
    const forget = status.remember("The save failed: the disk is full.");
    await flushPromises();
    expect(find("status-bell")?.dataset.count).toBe("1");
    forget();
    await flushPromises();
    expect(find("status-bell")?.dataset.count).toBe("0");
  });

  it("counts the problems, the frame rate and the save errors", () => {
    expect(
      problemCounts([
        { level: "warn", status: "error" },
        { level: "block", status: "known" },
      ]),
    ).toEqual({
      fail: 0,
      warn: 1,
    });
    expect(fpsOf(33.3)).toBe(30);
    expect(fpsOf(0)).toBeNull();
    expect(saveStatus("saved", false).error).toBe(false);
    expect(saveStatus("not saved: a rule fails", true).error).toBe(true);
  });
});
