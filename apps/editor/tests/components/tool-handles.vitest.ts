// SPDX-License-Identifier: Apache-2.0
// The handles of a scene tool of a plugin: a dot over the canvas at the world point of each handle, and a drag on the
// level plane of the point (the moves, then the release). Also the end of the layer.
import { afterEach, describe, expect, it, vi } from "vitest";
import { startToolHandles } from "../../src/scene/extensions/toolHandles";

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** A pointer event with a place on the page. */
const pointer = (type: string, x: number, y: number): Event =>
  Object.assign(new MouseEvent(type, { clientX: x, clientY: y, bubbles: true }), { pointerId: 1 });

describe("the handles of a scene tool", () => {
  it("draw each handle at its point and give the moves of a drag on its level", () => {
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => frames.push(callback));
    vi.stubGlobal("cancelAnimationFrame", () => undefined);
    const box = document.createElement("div");
    const canvas = document.createElement("canvas");
    box.append(canvas);
    document.body.append(box);
    canvas.getBoundingClientRect = () => new DOMRect(0, 0, 400, 300);
    const moves: [string, number[], boolean][] = [];
    const forward: [number, number, number] = [0, -Math.SQRT1_2, -Math.SQRT1_2];
    const stop = startToolHandles(canvas, {
      handles: () => [{ id: "a", point: [0, 0, 0], label: "Move A" }],
      move: (id, point, done) => moves.push([id, [...point], done]),
      view: () => ({ position: [0, 10, 10], forward, fov: 50 }),
    });
    const handle = box.querySelector<HTMLButtonElement>('[data-testid="tool-handle"]');
    if (handle === null) throw new Error("no handle");
    expect(handle.getAttribute("aria-label")).toBe("Move A");
    // The point is on the axis of the view: the middle of the canvas, less the half of the dot.
    expect(handle.style.transform).toBe("translate(193px, 143px)");
    handle.setPointerCapture = () => undefined;
    handle.dispatchEvent(pointer("pointerdown", 200, 150));
    handle.dispatchEvent(pointer("pointermove", 260, 150));
    handle.dispatchEvent(pointer("pointerup", 260, 150));
    expect(moves.map(([id, , done]) => [id, done])).toEqual([
      ["a", false],
      ["a", true],
    ]);
    const [, point] = moves[1] ?? [];
    expect(point?.[1]).toBe(0);
    expect(point?.[0]).toBeGreaterThan(0);
    stop();
    expect(box.querySelector('[data-testid="tool-handles"]')).toBeNull();
  });
});
