// SPDX-License-Identifier: Apache-2.0
// The overlays of the Scene view. They dock to the four edges and fold. The overlay menu shows and hides them. A drag
// of the head docks an overlay to the nearest edge. The places go into the state of the panel.
import { mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { PANEL_STATE_KEY } from "../../src/studio/shell/panelState";
import { nearestEdge, OverlayDock, readPlaces, setPageOverlays } from "../../src/scene/viewport/overlays";
import SceneViewPanel from "../../src/scene/viewport/SceneViewPanel.vue";
import { orientationOverlay, screenAxes } from "../../src/scene/viewport/viewOverlays";
import { editorViewCommands, ORTHO_FOV, telephoto, turnedTo, viewOfAxis } from "../../src/scene/viewport/editorViews";
import { viewOf } from "@scenity/editor-core";

afterEach(() => {
  setPageOverlays(null);
  document.body.innerHTML = "";
});

function dockOf(): OverlayDock {
  const dock = new OverlayDock(document.body);
  for (const [id, edge, order] of [
    ["view", "top", 0],
    ["grid", "top", 1],
    ["stats", "bottom", 0],
  ] as const) {
    const content = document.createElement("p");
    content.textContent = id;
    dock.add({ id, title: () => id.toUpperCase(), edge, order, content });
  }
  return dock;
}

const edgeOf = (id: string): string | undefined =>
  document.querySelector<HTMLElement>(`[data-overlay="${id}"]`)?.closest<HTMLElement>("[data-edge]")?.dataset.edge;
const click = (testid: string): void => document.querySelector<HTMLElement>(`[data-testid="${testid}"]`)?.click();

describe("the overlays of the Scene view", () => {
  it("dock to an edge in their order, fold, and hide from the overlay menu", () => {
    const dock = dockOf();
    const saved: unknown[] = [];
    dock.onChange((places) => saved.push(places));
    const top = document.querySelector('.scene-overlay-edge[data-edge="top"]');
    expect([...(top?.children ?? [])].map((node) => (node as HTMLElement).dataset.overlay)).toEqual(["view", "grid"]);
    click("overlay-view-fold");
    expect(document.querySelector('[data-overlay="view"]')?.hasAttribute("data-folded")).toBe(true);
    expect(document.querySelector('[data-testid="overlay-view-fold"]')?.getAttribute("aria-expanded")).toBe("false");
    // The menu of an overlay docks it to another edge, after the overlays there.
    click("overlay-view-menu");
    click("overlay-view-dock-bottom");
    expect(edgeOf("view")).toBe("bottom");
    expect(dock.place("view")).toEqual({ edge: "bottom", order: 1, folded: true, hidden: false });
    // The overlay menu shows and hides each overlay.
    dock.toggleMenu();
    click("overlay-menu-grid");
    expect(document.querySelector<HTMLElement>('[data-overlay="grid"]')?.hidden).toBe(true);
    expect(document.querySelector('[data-testid="overlay-menu-grid"]')?.getAttribute("aria-checked")).toBe("false");
    dock.toggleMenu();
    expect(document.querySelector('[data-testid="scene-overlay-menu"]')).toBeNull();
    expect(saved.at(-1)).toMatchObject({ grid: { hidden: true }, view: { edge: "bottom", folded: true } });
  });

  it("take saved places and drop bad ones; a drop docks to the nearest edge", () => {
    expect(readPlaces({ a: { edge: "left", order: 2, folded: true }, b: { edge: "middle", order: 1 }, c: 3 })).toEqual({
      a: { edge: "left", order: 2, folded: true, hidden: false },
    });
    const box = { left: 0, top: 0, width: 800, height: 600 };
    expect(nearestEdge(box, 400, 20)).toBe("top");
    expect(nearestEdge(box, 790, 300)).toBe("right");
    expect(nearestEdge(box, 400, 590)).toBe("bottom");
    expect(nearestEdge(box, 10, 300)).toBe("left");
    const dock = dockOf();
    dock.load({ stats: { edge: "right", order: 0, folded: false, hidden: false } });
    expect(edgeOf("stats")).toBe("right");
  });

  it("keep their places in the state of the Scene view panel", async () => {
    const state: Record<string, unknown> = {
      overlays: { grid: { edge: "left", order: 0, folded: true, hidden: false } },
    };
    const view = document.createElement("div");
    mount(SceneViewPanel, {
      props: { element: view },
      attachTo: document.body,
      global: {
        provide: {
          [PANEL_STATE_KEY as symbol]: {
            read: (key: string) => state[key],
            write: (key: string, value: unknown) => {
              state[key] = value;
            },
          },
        },
      },
    });
    const dock = dockOf();
    setPageOverlays(dock);
    await Promise.resolve();
    expect(edgeOf("grid")).toBe("left");
    dock.set("stats", { folded: true });
    await Promise.resolve();
    expect(state.overlays).toMatchObject({ grid: { edge: "left" }, stats: { folded: true } });
  });

  it("draw the world axes as the view sees them", () => {
    const front = screenAxes([0, 0, -1]);
    const byAxis = Object.fromEntries(front.map((item) => [item.axis, item]));
    expect(byAxis.x?.x).toBeCloseTo(1);
    expect(byAxis.y?.y).toBeCloseTo(-1);
    expect(byAxis.z?.depth).toBeCloseTo(1);
    // The far axes come first: the axis toward the eye draws last.
    expect(front.at(-1)?.axis).toBe("z");
    const down = screenAxes([0, -1, 0]);
    const top = Object.fromEntries(down.map((item) => [item.axis, item]));
    expect(top.x?.x).toBeCloseTo(1);
    expect(top.z?.y).toBeCloseTo(1);
  });
});

describe("the views and the projection of the editor camera", () => {
  const camera = { target: [1, 0, 0] as [number, number, number], yaw: 0.3, pitch: 0.2, distance: 4, fov: 50 };

  it("turn to a view along an axis; the target and the distance stay", () => {
    expect(viewOfAxis("x", true)).toBe("right");
    expect(viewOfAxis("y", false)).toBe("bottom");
    expect(viewOfAxis("z", true)).toBe("front");
    const right = viewOf(turnedTo(camera, "right"));
    expect(right.position[0]).toBeCloseTo(5);
    expect(right.target).toEqual([1, 0, 0]);
    const top = viewOf(turnedTo(camera, "top"));
    expect(top.position[1]).toBeGreaterThan(3.99);
  });

  it("make the orthographic projection a long lens with the same height of the view at the target", () => {
    const view = viewOf(camera);
    const lens = telephoto(view);
    expect(lens.fov).toBe(ORTHO_FOV);
    expect(lens.target).toEqual(view.target);
    const half = (pose: typeof view): number =>
      Math.hypot(...pose.position.map((value, index) => value - (pose.target[index] ?? 0))) *
      Math.tan((pose.fov * Math.PI) / 360);
    expect(half(lens)).toBeCloseTo(half(view));
  });

  it("have a command and a key for each view and for the projection", () => {
    const calls: string[] = [];
    const port = {
      view: (name: string) => calls.push(name),
      projection: "perspective" as const,
      setProjection: (next: string) => calls.push(next),
    };
    const commands = editorViewCommands(port, () => null);
    expect(commands.map((command) => [command.id, command.keys?.[0]])).toEqual([
      ["view.front", "Alt+1"],
      ["view.back", "Alt+Shift+1"],
      ["view.right", "Alt+3"],
      ["view.left", "Alt+Shift+3"],
      ["view.top", "Alt+7"],
      ["view.bottom", "Alt+Shift+7"],
      ["view.projection", "Alt+5"],
    ]);
    for (const command of commands) void command.run({});
    expect(calls).toEqual(["front", "back", "right", "left", "top", "bottom", "orthographic"]);
  });

  it("turn the view from a click on the end of an axis, and switch the projection", () => {
    const overlay = orientationOverlay();
    document.body.append(overlay.element);
    const calls: string[] = [];
    let projection: "perspective" | "orthographic" = "perspective";
    overlay.listen({
      view: (name) => calls.push(name),
      get projection() {
        return projection;
      },
      setProjection: (next) => {
        projection = next;
      },
    });
    overlay.show([0, 0, 5], [0, 0, -1]);
    const press = (testid: string): void => {
      document.querySelector(`[data-testid="${testid}"]`)?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    };
    press("orientation-x");
    press("orientation--z");
    const button = document.querySelector<HTMLButtonElement>('[data-testid="orientation-projection"]');
    expect(button?.textContent).toBe("Persp");
    button?.click();
    expect(projection).toBe("orthographic");
    expect(button?.textContent).toBe("Ortho");
    expect(calls).toEqual(["right", "back"]);
  });
});
