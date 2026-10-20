// SPDX-License-Identifier: Apache-2.0
// The place of the floating cards of the lab (src/core/editor/usePanelPlace.ts): a drag of the grip, the arrow keys,
// the limits of the window and the setting of this browser.
import { afterEach, describe, expect, it } from "vitest";
import { clampOffset, usePanelPlace } from "../../src/core/editor/usePanelPlace";

const KEY = "scenity.labs.test.cardsPlace";

function pointer(type: string, x: number, y: number): PointerEvent {
  const target = { setPointerCapture: () => undefined, closest: () => null };
  return {
    type,
    button: 0,
    clientX: x,
    clientY: y,
    pointerId: 1,
    target,
    currentTarget: target,
    preventDefault: () => undefined,
  } as unknown as PointerEvent;
}

function key(name: string, shift = false): KeyboardEvent {
  return new KeyboardEvent("keydown", { key: name, shiftKey: shift });
}

describe("the place of the cards", () => {
  afterEach(() => {
    globalThis.localStorage.removeItem(KEY);
  });

  it("keeps a part of the panel in the window", () => {
    expect(clampOffset({ x: 50, y: -200 }, 1000, 800)).toEqual({ x: 0, y: -40 });
    expect(clampOffset({ x: -5000, y: 5000 }, 1000, 800)).toEqual({ x: -904, y: 704 });
  });

  it("follows a drag of the grip and keeps the place for the next page", () => {
    const place = usePanelPlace(KEY);
    place.grab(pointer("pointerdown", 500, 100));
    expect(place.moving.value).toBe(true);
    place.move(pointer("pointermove", 300, 250));
    place.drop(pointer("pointerup", 300, 250));
    expect(place.offset.value).toEqual({ x: -200, y: 150 });
    expect(place.style.value.transform).toBe("translate(-200px, 150px)");
    expect(usePanelPlace(KEY).offset.value).toEqual({ x: -200, y: 150 });
    place.reset();
    expect(usePanelPlace(KEY).offset.value).toEqual({ x: 0, y: 0 });
  });

  it("moves with the arrow keys of the grip and goes back with Home", () => {
    const place = usePanelPlace(KEY);
    place.key(key("ArrowLeft"));
    place.key(key("ArrowDown", true));
    expect(place.offset.value).toEqual({ x: -20, y: 80 });
    place.key(key("Home"));
    expect(place.offset.value).toEqual({ x: 0, y: 0 });
  });
});
