// SPDX-License-Identifier: Apache-2.0
// The layout of the dock of the content browser: the sizes stay inside their limits, and a stored layout keeps only
// fields of the correct type. The dock heights of the URL and of the script API set the layout.
import { beforeEach, describe, expect, it } from "vitest";
import {
  applyHeight,
  clampSize,
  defaultLayout,
  heightOf,
  LIMITS,
  useDockLayout,
} from "../../src/core/browser/dockLayout";

describe("the layout of the dock", () => {
  beforeEach(() => {
    globalThis.localStorage.clear();
  });

  it("keeps each size inside its limits; the dock leaves 10 rem of the window to the scene", () => {
    expect(clampSize("treeWidth", 2)).toBe(LIMITS.treeWidth.min);
    expect(clampSize("treeWidth", 99)).toBe(LIMITS.treeWidth.max);
    expect(clampSize("height", 50, 16, 800)).toBe(40);
    expect(clampSize("stripHeight", 5.123)).toBe(5.12);
  });

  it("closes the folders by default on a narrow screen", () => {
    expect(defaultLayout(1440)).toMatchObject({ tree: true });
    expect(defaultLayout(390)).toMatchObject({ tree: false });
  });

  it("reads a stored layout, field by field, and the dock height of the URL over it", () => {
    globalThis.localStorage.setItem(
      "room3d-lab.dock-layout",
      JSON.stringify({ tree: false, treeWidth: 20, timeline: "yes", open: false }),
    );
    const layout = useDockLayout("auto");
    expect(layout).toMatchObject({ tree: false, treeWidth: 20, open: false, timeline: true });
    expect(heightOf(layout)).toBe("closed");
    applyHeight(layout, "bar");
    expect(heightOf(layout)).toBe("bar");
    applyHeight(layout, "half");
    expect(heightOf(layout)).toBe("open");
    expect(layout.height).toBe(defaultLayout().height);
  });
});
