// SPDX-License-Identifier: Apache-2.0
/**
 * The start marks of the lab page: the first frame, the settled assets and the frame without the fog. Each one is
 * marked once on the User Timing time line, in that order. The watch stops after them.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { markStart, START_MARKS, startPhases } from "../../src/startMarks";

/** The room view of the page with its attributes and the fog of the loading scene. */
function roomView(): { room: HTMLElement; fog: HTMLElement } {
  const room = document.createElement("div");
  room.dataset.testid = "room-view";
  room.setAttribute("data-assets", "loading");
  const fog = document.createElement("div");
  fog.dataset.testid = "room-3d-fog";
  room.appendChild(fog);
  document.body.appendChild(room);
  return { room, fog };
}

/** The MutationObserver calls come after a task. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function marked(name: string): number {
  return performance.getEntriesByName(name, "mark").length;
}

afterEach(() => {
  document.body.innerHTML = "";
  performance.clearMarks();
});

describe("startPhases", () => {
  it("reads nothing before the room view", () => {
    expect(startPhases(document)).toEqual({ firstFrame: false, assetsReady: false, fog: true });
  });

  it("reads the phases of the room view", () => {
    const { room, fog } = roomView();
    room.setAttribute("data-ready", "true");
    room.setAttribute("data-assets", "failed");
    fog.remove();
    expect(startPhases(document)).toEqual({ firstFrame: true, assetsReady: true, fog: false });
  });

  it("does not take the first state of the view (none, under the fog) for settled assets", () => {
    const { room } = roomView();
    room.setAttribute("data-assets", "none");
    room.setAttribute("data-ready", "true");
    expect(startPhases(document)).toEqual({ firstFrame: true, assetsReady: false, fog: true });
  });
});

describe("markStart", () => {
  it("marks each phase once, in order, and then calls onReady once", async () => {
    const onReady = vi.fn();
    const stop = markStart(document, onReady);
    const { room, fog } = roomView();
    room.setAttribute("data-ready", "true");
    await settle();
    expect(marked(START_MARKS.firstFrame)).toBe(1);
    expect(marked(START_MARKS.assetsReady)).toBe(0);
    room.setAttribute("data-assets", "ready");
    await settle();
    expect(marked(START_MARKS.assetsReady)).toBe(1);
    expect(marked(START_MARKS.frameReady)).toBe(0);
    fog.remove();
    await settle();
    expect(marked(START_MARKS.frameReady)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    // The watch has stopped: a new change marks nothing.
    room.setAttribute("data-assets", "loading");
    room.setAttribute("data-assets", "ready");
    await settle();
    expect(marked(START_MARKS.assetsReady)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(1);
    stop();
  });

  it("a graybox scene without assets is ready at its first frame", async () => {
    const onReady = vi.fn();
    markStart(document, onReady);
    const { room, fog } = roomView();
    fog.remove();
    room.setAttribute("data-assets", "none");
    room.setAttribute("data-ready", "true");
    await settle();
    expect(marked(START_MARKS.frameReady)).toBe(1);
    expect(onReady).toHaveBeenCalledTimes(1);
  });
});
