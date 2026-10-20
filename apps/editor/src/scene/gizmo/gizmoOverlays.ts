// SPDX-License-Identifier: Apache-2.0
/**
 * The overlays of the gizmo in the Scene view: Tools (view, move, turn, scale) and Tool
 * settings (world or local, pivot or centre), and the snap switches in the overlay Grid and snap. They do what the
 * tools of the toolbar do (gizmoBar.ts) and show the same settings; their test IDs start with `overlay-`.
 */
import { t } from "../../texts";
import type { OverlayDock } from "../viewport/overlays";
import type { GizmoChange, GizmoMode, GizmoSettings } from "./gizmoSettings";

const MODES: readonly { readonly mode: GizmoMode; readonly key: string; label(): string }[] = [
  { mode: "view", key: "Q", label: () => t("gizmo-mode-view") },
  { mode: "translate", key: "W", label: () => t("gizmo-mode-move") },
  { mode: "rotate", key: "E", label: () => t("gizmo-mode-turn") },
  { mode: "scale", key: "R", label: () => t("gizmo-mode-scale") },
];

const SNAPS = [
  { on: "gridOn", label: () => t("gizmo-snap-grid") },
  { on: "angleOn", label: () => t("gizmo-snap-angle") },
  { on: "scaleOn", label: () => t("gizmo-snap-scale") },
] as const;

function button(text: string, testid: string, run: () => void): HTMLButtonElement {
  const node = document.createElement("button");
  node.type = "button";
  node.textContent = text;
  node.dataset.testid = testid;
  node.addEventListener("click", run);
  return node;
}

/** Add the gizmo overlays to a dock; `show` puts the settings into them. */
export function gizmoOverlays(
  dock: OverlayDock,
  change: (value: GizmoChange) => void,
  current: () => GizmoSettings,
): (settings: GizmoSettings) => void {
  const tools = document.createElement("div");
  tools.className = "scene-overlay-column";
  const modes = MODES.map((item) => {
    const node = button(item.label(), `overlay-tool-${item.mode}`, () => change({ mode: item.mode }));
    node.title = item.key;
    return node;
  });
  tools.append(...modes);
  const settings = document.createElement("div");
  settings.className = "scene-overlay-row";
  const space = button("", "overlay-tool-space", () =>
    change({ space: current().space === "world" ? "local" : "world" }),
  );
  const pivot = button("", "overlay-tool-pivot", () =>
    change({ pivot: current().pivot === "pivot" ? "centre" : "pivot" }),
  );
  settings.append(space, pivot);
  const snaps = SNAPS.map((snap) => {
    const box = document.createElement("input");
    box.type = "checkbox";
    box.dataset.testid = `overlay-snap-${snap.on}`;
    box.addEventListener("change", () => change({ snaps: { [snap.on]: box.checked } }));
    const label = document.createElement("label");
    label.append(box, " ", snap.label());
    return { box, label };
  });
  dock.add({ id: "tools", title: () => t("overlay-tools"), edge: "left", order: 0, content: tools });
  dock.add({ id: "tool-settings", title: () => t("overlay-tool-settings"), edge: "left", order: 1, content: settings });
  dock.content("grid")?.append(...snaps.map((snap) => snap.label));
  return (now) => {
    modes.forEach((node, index) => node.setAttribute("aria-pressed", String(MODES[index]?.mode === now.mode)));
    space.textContent = now.space === "world" ? t("gizmo-space-world") : t("gizmo-space-local");
    pivot.textContent = now.pivot === "pivot" ? t("gizmo-pivot-pivot") : t("gizmo-pivot-centre");
    snaps.forEach((snap, index) => {
      const key = SNAPS[index]?.on;
      if (key !== undefined) snap.box.checked = now.snaps[key];
    });
  };
}
