// SPDX-License-Identifier: Apache-2.0
// The tour of the editor window: six steps, Next, Back, Skip, and the done mark in the browser. Also no start under
// automation, and the mark of the part of the window of each step.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import TourCard from "../../src/studio/tour/TourCard.vue";
import {
  endTour,
  startTour,
  startTourOnce,
  TOUR_KEY,
  TOUR_STEPS,
  tourDone,
  tourStep,
} from "../../src/studio/tour/tour";
import { editorI18n } from "../../src/texts";

afterEach(() => {
  tourStep.value = null;
  localStorage.removeItem(TOUR_KEY);
  document.body.innerHTML = "";
});

describe("the tour", () => {
  it("has six steps; it starts once, not under automation, and a skip keeps it done", () => {
    expect(TOUR_STEPS).toHaveLength(6);
    startTourOnce(true);
    expect(tourStep.value).toBeNull();
    startTourOnce(false);
    expect(tourStep.value).toBe(0);
    endTour();
    expect([tourStep.value, tourDone()]).toEqual([null, true]);
    startTourOnce(false);
    expect(tourStep.value).toBeNull();
  });

  it("shows each step with Next and Back, opens its panel and marks its part; Done ends it", async () => {
    const target = document.createElement("div");
    target.dataset.panel = "hierarchy";
    document.body.append(target);
    const opened: string[] = [];
    const wrapper = mount(TourCard, {
      props: { open: (panel: string) => void opened.push(panel) },
      global: { plugins: [editorI18n().plugin] },
      attachTo: document.body,
    });
    startTour();
    await flushPromises();
    expect(wrapper.get("[data-testid=tour]").attributes("data-step")).toBe("view");
    expect(wrapper.find("[data-testid=tour-back]").exists()).toBe(false);
    await wrapper.get("[data-testid=tour-next]").trigger("click");
    await new Promise((resolve) => requestAnimationFrame(resolve));
    expect(wrapper.get("[data-testid=tour]").attributes("data-step")).toBe("hierarchy");
    expect(opened).toEqual(["scene.view", "hierarchy"]);
    expect(target.dataset.tourTarget).toBe("1");
    await wrapper.get("[data-testid=tour-back]").trigger("click");
    expect(wrapper.get("[data-testid=tour]").attributes("data-step")).toBe("view");
    for (const step of TOUR_STEPS) {
      expect(step.title).toMatch(/^tour-/);
      await wrapper.get("[data-testid=tour-next]").trigger("click");
    }
    expect(wrapper.find("[data-testid=tour]").exists()).toBe(false);
    expect(tourDone()).toBe(true);
    wrapper.unmount();
  });
});
