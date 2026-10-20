// SPDX-License-Identifier: Apache-2.0
/**
 * The gizmo bar of the scene page: the mode buttons (W move, E turn, R scale),
 * the axes (L: world or local), the pivot (P: each origin or the centre), the snaps with their steps, and the field of
 * a typed value. The texts are Fluent messages of `src/i18n/en-US/gizmo.ftl`. The bar has no design tokens:
 * the page styles it in gizmo.css.
 */
import type { SnapSettings } from "@scenity/editor-core";
import { t } from "../../texts";
import { placePart } from "../pageParts";
import type { TypedValue } from "./gizmoControl";
import type { GizmoChange, GizmoMode, GizmoSettings } from "./gizmoSettings";

/** The bar: its element, a refresh from the settings, and the typed value field. */
export interface GizmoBar {
  readonly element: HTMLElement;
  show(settings: GizmoSettings): void;
  /** Show a typed value with its label (for example "Move X: 0.5"), or hide the field for null. */
  typed(value: TypedValue | null): void;
}

/** The mode buttons: the mode, its key, and the texts of the button. */
const MODES: readonly { mode: GizmoMode; key: string; label: () => string; title: (key: string) => string }[] = [
  { mode: "view", key: "Q", label: () => t("gizmo-mode-view"), title: (key) => t("gizmo-mode-view-title", { key }) },
  {
    mode: "translate",
    key: "W",
    label: () => t("gizmo-mode-move"),
    title: (key) => t("gizmo-mode-move-title", { key }),
  },
  { mode: "rotate", key: "E", label: () => t("gizmo-mode-turn"), title: (key) => t("gizmo-mode-turn-title", { key }) },
  { mode: "scale", key: "R", label: () => t("gizmo-mode-scale"), title: (key) => t("gizmo-mode-scale-title", { key }) },
];

/** The snaps of the bar: the switch, the step field and its unit, and the texts of the switch and the field. */
const SNAPS: readonly {
  on: keyof SnapSettings;
  step: keyof SnapSettings;
  unit: string;
  label: () => string;
  stepTitle: () => string;
}[] = [
  {
    on: "gridOn",
    step: "grid",
    unit: "m",
    label: () => t("gizmo-snap-grid"),
    stepTitle: () => t("gizmo-snap-grid-step"),
  },
  {
    on: "angleOn",
    step: "angle",
    unit: "°",
    label: () => t("gizmo-snap-angle"),
    stepTitle: () => t("gizmo-snap-angle-step"),
  },
  {
    on: "scaleOn",
    step: "scale",
    unit: "×",
    label: () => t("gizmo-snap-scale"),
    stepTitle: () => t("gizmo-snap-scale-step"),
  },
];

/** The text of a typed value: the mode, the axis (when the drag has one) and the value. */
function typedText({ mode, axis, text }: TypedValue): string {
  const args = { axis, value: text };
  if (mode === "rotate") return axis === null ? t("gizmo-typed-turn", args) : t("gizmo-typed-turn-axis", args);
  if (mode === "scale") return axis === null ? t("gizmo-typed-scale", args) : t("gizmo-typed-scale-axis", args);
  return axis === null ? t("gizmo-typed-move", args) : t("gizmo-typed-move-axis", args);
}

function button(text: string, testId: string, title: string, run: () => void): HTMLButtonElement {
  const element = document.createElement("button");
  element.type = "button";
  element.textContent = text;
  element.title = title;
  element.dataset.testid = testId;
  element.addEventListener("click", run);
  return element;
}

function check(testId: string, label: string, run: (on: boolean) => void): [HTMLLabelElement, HTMLInputElement] {
  const box = document.createElement("input");
  box.type = "checkbox";
  box.dataset.testid = testId;
  box.addEventListener("change", () => run(box.checked));
  const wrap = document.createElement("label");
  wrap.append(box, " ", label);
  return [wrap, box];
}

/** The snap controls: a switch and a step field for each snap, and the surface switch. */
function snapControls(element: HTMLElement, change: (value: GizmoChange) => void): (snaps: SnapSettings) => void {
  const shows: ((snaps: SnapSettings) => void)[] = [];
  for (const snap of SNAPS) {
    const [wrap, box] = check(`gizmo-snap-${snap.step}`, snap.label(), (on) => change({ snaps: { [snap.on]: on } }));
    const step = document.createElement("input");
    step.type = "number";
    step.min = "0";
    step.step = "any";
    step.dataset.testid = `gizmo-step-${snap.step}`;
    step.title = snap.stepTitle();
    step.addEventListener("change", () => {
      const value = Number(step.value);
      if (Number.isFinite(value) && value > 0) change({ snaps: { [snap.step]: value } });
    });
    wrap.append(step, snap.unit);
    element.append(wrap);
    shows.push((snaps) => {
      box.checked = snaps[snap.on] === true;
      if (document.activeElement !== step) step.value = String(snaps[snap.step]);
    });
  }
  const [wrap, box] = check("gizmo-snap-surface", t("gizmo-snap-surface"), (on) => change({ snaps: { surface: on } }));
  wrap.title = t("gizmo-snap-surface-title");
  element.append(wrap);
  return (snaps) => {
    for (const show of shows) show(snaps);
    box.checked = snaps.surface;
  };
}

/** The commands of the window for the modes (gizmo/startGizmo.ts). */
const MODE_COMMANDS: Readonly<Record<GizmoMode, string>> = {
  view: "gizmo.view",
  translate: "gizmo.move",
  rotate: "gizmo.turn",
  scale: "gizmo.scale",
};

/** Make the bar and add it to the page. `change` applies a change of the settings. */
export function gizmoBar(change: (value: GizmoChange) => void, current: () => GizmoSettings): GizmoBar {
  const element = document.createElement("div");
  element.id = "scene-gizmo-bar";
  element.dataset.testid = "gizmo-bar";
  // The tools and the tool settings of the toolbar (`toolbar.tools`, `toolbar.toolSettings`).
  element.setAttribute("role", "toolbar");
  element.setAttribute("aria-label", t("gizmo-bar-label"));
  const modes = MODES.map((item) => {
    const node = button(item.label(), `gizmo-mode-${item.mode}`, item.title(item.key), () =>
      change({ mode: item.mode }),
    );
    // The command of the window that does the same (the W, E and R keys).
    node.dataset.command = MODE_COMMANDS[item.mode];
    return node;
  });
  const space = button("", "gizmo-space", t("gizmo-space-title"), () =>
    change({ space: current().space === "world" ? "local" : "world" }),
  );
  const pivot = button("", "gizmo-pivot", t("gizmo-pivot-title"), () =>
    change({ pivot: current().pivot === "pivot" ? "centre" : "pivot" }),
  );
  space.dataset.command = "gizmo.space";
  pivot.dataset.command = "gizmo.pivot";
  element.append(...modes, space, pivot);
  const showSnaps = snapControls(element, change);
  const typedField = document.createElement("output");
  typedField.dataset.testid = "gizmo-typed";
  typedField.hidden = true;
  element.append(typedField);
  placePart(element, "tools");
  return {
    element,
    show(settings) {
      modes.forEach((item, index) => {
        item.setAttribute("aria-pressed", String(MODES[index]?.mode === settings.mode));
      });
      const world = settings.mode !== "scale" && settings.space === "world";
      space.textContent = world ? t("gizmo-space-world") : t("gizmo-space-local");
      space.dataset.value = settings.space;
      pivot.textContent = settings.pivot === "pivot" ? t("gizmo-pivot-pivot") : t("gizmo-pivot-centre");
      pivot.dataset.value = settings.pivot;
      showSnaps(settings.snaps);
    },
    typed(value) {
      typedField.hidden = value === null;
      typedField.textContent = value === null ? "" : typedText(value);
    },
  };
}
