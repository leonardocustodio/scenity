// SPDX-License-Identifier: Apache-2.0
/**
 * The overlays of the Scene view and their contents. This module has the dock of the view and the overlay menu (the
 * backtick key). It also has the Orientation overlay (the world axes as the view sees them) and the Stats overlay.
 * The Stats overlay shows the backend, the tier, the frame rate, the entities and the selection. The viewport adds
 * View options, Cameras and Grid and snap (viewportBar.ts). The gizmo adds Tools and Tool settings
 * (gizmo/gizmoOverlays.ts). The agent panel adds the Agent overlay (agent/followView.ts).
 */
import { watch } from "vue";
import { currentShell } from "../../studio/shell/shell";
import { t } from "../../texts";
import { pageKeys, SCENE_CONTEXT } from "../settings/pageKeys";
import { partPlace } from "../pageParts";
import { viewOfAxis, type EditorViewName, type Projection } from "./editorViews";
import { OverlayDock, pageOverlays, setPageOverlays } from "./overlays";
import { viewportBar, type BarActions } from "./viewportBar";

/** Run a step with the overlays of the page: immediately, or when the viewport makes them. */
export function whenOverlays(use: (dock: OverlayDock) => void): void {
  const dock = pageOverlays();
  if (dock !== null) {
    use(dock);
    return;
  }
  const stop = watch(pageOverlays, (next) => {
    if (next === null) return;
    stop();
    use(next);
  });
}

/** Make the overlay dock of a Scene view and the command of the overlay menu. */
export function startOverlays(parent: HTMLElement): OverlayDock {
  const dock = new OverlayDock(parent);
  pageKeys().register([
    {
      id: "overlay.menu",
      title: t("command-overlay-menu"),
      keys: ["`"],
      keyContext: SCENE_CONTEXT,
      menu: "window",
      run: () => dock.toggleMenu(),
    },
  ]);
  return dock;
}

type Vec = readonly [number, number, number];

const dot = (a: Vec, b: Vec): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const cross = (a: Vec, b: Vec): Vec => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
function unit(a: Vec): Vec {
  const length = Math.hypot(a[0], a[1], a[2]);
  return length === 0 ? [0, 0, 0] : [a[0] / length, a[1] / length, a[2] / length];
}

/** An axis of the Orientation overlay on the screen: its end (from the centre, y down) and its depth. */
export interface ScreenAxis {
  readonly axis: "x" | "y" | "z";
  readonly x: number;
  readonly y: number;
  /** Toward the eye is more than 0. */
  readonly depth: number;
}

/** The world axes as a view in the direction `forward` sees them, the far axes first. */
export function screenAxes(direction: Vec): ScreenAxis[] {
  const forward = unit(direction);
  // A view straight down uses -Z as the up of the screen (X to the right, as the top view). A view up uses +Z.
  const up0: Vec = Math.abs(forward[1]) > 0.999 ? [0, 0, Math.sign(forward[1])] : [0, 1, 0];
  const right = unit(cross(forward, up0));
  const up = cross(right, forward);
  const axes: [ScreenAxis["axis"], Vec][] = [
    ["x", [1, 0, 0]],
    ["y", [0, 1, 0]],
    ["z", [0, 0, 1]],
  ];
  return axes
    .map(([axis, vector]) => ({ axis, x: dot(vector, right), y: -dot(vector, up), depth: -dot(vector, forward) }))
    .sort((a, b) => a.depth - b.depth);
}

const SVG = "http://www.w3.org/2000/svg";

/** What the Orientation overlay changes of the editor camera. */
export interface OrientationPort {
  view(name: EditorViewName): void;
  readonly projection: Projection;
  setProjection(next: Projection): void;
}

/** The end of an axis: a dot that turns the view to look from that side of the axis. */
function axisEnd(item: ScreenAxis, positive: boolean, pick: (name: EditorViewName) => void): SVGElement {
  const sign = positive ? 1 : -1;
  const name = viewOfAxis(item.axis, positive);
  const end = document.createElementNS(SVG, "circle");
  end.setAttribute("cx", String(sign * item.x * 24));
  end.setAttribute("cy", String(sign * item.y * 24));
  end.setAttribute("r", positive ? "6" : "4");
  end.setAttribute("class", positive ? "end" : "end negative");
  end.setAttribute("role", "button");
  end.setAttribute("tabindex", "0");
  end.setAttribute("aria-label", t(`viewport-command-view-${name}`));
  end.dataset.testid = `orientation-${positive ? "" : "-"}${item.axis}`;
  end.addEventListener("click", () => pick(name));
  end.addEventListener("keydown", (event) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    pick(name);
  });
  return end;
}

/**
 * The Orientation overlay: the world axes as the view sees them. A click on the end of an axis looks from that side
 * (+X the right view, +Y the top view, +Z the front view, and their opposites). The button changes the projection.
 * `show` draws a view direction.
 */
export function orientationOverlay(): {
  readonly element: HTMLElement;
  show(position: Vec, forward: Vec): void;
  listen(port: OrientationPort): void;
} {
  const element = document.createElement("div");
  element.className = "scene-orientation";
  const svg = document.createElementNS(SVG, "svg");
  svg.setAttribute("viewBox", "-32 -32 64 64");
  svg.setAttribute("aria-label", t("overlay-orientation"));
  svg.dataset.testid = "orientation-axes";
  const projection = document.createElement("button");
  projection.type = "button";
  projection.title = t("viewport-projection-title");
  projection.dataset.testid = "orientation-projection";
  element.append(svg, projection);
  let port: OrientationPort | null = null;
  const pick = (name: EditorViewName): void => port?.view(name);
  let shown = "";
  const label = (): void => {
    const now = port?.projection ?? "perspective";
    projection.textContent = t(`viewport-projection-${now}`);
    projection.dataset.value = now;
  };
  projection.addEventListener("click", () => {
    if (port === null) return;
    port.setProjection(port.projection === "perspective" ? "orthographic" : "perspective");
    label();
  });
  label();
  return {
    element,
    listen(next) {
      port = next;
      label();
    },
    show(_position, forward) {
      label();
      const axes = screenAxes(forward);
      const key = axes.map((item) => `${item.axis}${item.x.toFixed(2)},${item.y.toFixed(2)}`).join(" ");
      if (key === shown) return;
      shown = key;
      // The far ends draw first. The negative ends are the small dots on the other side.
      const negatives = axes.map((item) => axisEnd(item, false, pick));
      const positives = axes.map((item) => {
        const group = document.createElementNS(SVG, "g");
        group.setAttribute("class", `axis axis-${item.axis}`);
        group.dataset.axis = item.axis;
        const line = document.createElementNS(SVG, "line");
        line.setAttribute("x2", String(item.x * 24));
        line.setAttribute("y2", String(item.y * 24));
        const end = axisEnd(item, true, pick);
        const letter = document.createElementNS(SVG, "text");
        letter.setAttribute("x", String(item.x * 24));
        letter.setAttribute("y", String(item.y * 24));
        letter.textContent = item.axis.toUpperCase();
        group.append(line, end, letter);
        return group;
      });
      negatives.forEach((end, index) => end.classList.add(`axis-${axes[index]?.axis ?? "x"}`));
      svg.replaceChildren(...negatives, ...positives);
    },
  };
}

/** The Stats overlay: the backend, the tier and the frame rate of the core, the entities and the selection. */
export function statsOverlay(): { readonly element: HTMLElement; show(entities: number, selected: number): void } {
  const element = document.createElement("p");
  element.className = "scene-stats";
  element.dataset.testid = "overlay-stats-text";
  return {
    element,
    show(entities, selected) {
      const render = currentShell()?.status.values.render ?? null;
      const parts = [
        render === null ? null : `${render.backend} · ${render.tier}`,
        render?.fps === null || render?.fps === undefined ? null : t("overlay-stats-fps", { fps: render.fps }),
        t("overlay-stats-entities", { count: entities }),
        t("overlay-stats-selected", { count: selected }),
      ];
      const text = parts.filter((part) => part !== null).join(" · ");
      if (element.textContent !== text) element.textContent = text;
    },
  };
}

/**
 * The bar of the viewport, the Orientation and the Stats overlays. In the editor window, the controls of the bar go
 * into the overlays, and the page then gets the dock. With no editor window, the bar stays a bar over the canvas.
 */
export function viewOverlayParts(actions: BarActions) {
  const place = partPlace("view");
  const dock = place === document.body ? null : startOverlays(place);
  const bar = viewportBar(actions, dock);
  const orientation = orientationOverlay();
  const stats = statsOverlay();
  if (dock !== null) {
    const { element } = orientation;
    dock.add({ id: "orientation", title: () => t("overlay-orientation"), edge: "right", order: 0, content: element });
    dock.add({ id: "stats", title: () => t("overlay-stats"), edge: "bottom", order: 0, content: stats.element });
    setPageOverlays(dock);
  }
  return { bar, orientation, stats };
}
