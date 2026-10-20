// SPDX-License-Identifier: Apache-2.0
/**
 * The transform gizmos of the scene page in the edit mode. The page loads this
 * module only with `edit=1` (a lazy chunk), so a page without the edit mode and the release workers do not change.
 *
 * Where the gizmo draws: on a 2D overlay canvas over the scene canvas, on the main thread, with the camera of the
 * document (dragMath.ts, as the entity drag and the camera presenter of the runtime). The core draws in a worker; a
 * gizmo in the worker scene would need new protocol messages, a round trip for each hover, and three.js code in the
 * worker. The overlay needs none of them, and it never goes into a frame of the core, a capture or a frame key.
 *
 * - A press on a handle starts a drag; the handle takes the press before the entity drag and the click select.
 * - W, E and R choose move, turn and scale; L toggles the world and local axes; P toggles the pivot and the centre.
 * - X, Y and Z start a typed value on that axis with no pointer. During a drag, digits, the point, the minus key and
 *   Backspace type a value; Enter or the release applies it; Escape restores the start.
 * - W, E, R, L, P, X, Y and Z are page commands of the key map (`gizmo.*`), so the owner can change them.
 * - Alt during a drag disables the snaps; Shift gives a move grid ten times larger.
 */
import type { AxisIndex, ScreenPoint } from "@scenity/editor-core";
import { drawGizmo, fitOverlay, overlayCanvas } from "./gizmoDraw";
import { gizmoBar } from "./gizmoBar";
import { gizmoOverlays } from "./gizmoOverlays";
import { whenOverlays } from "../viewport/viewOverlays";
import { GizmoControl, type GizmoParts } from "./gizmoControl";
import { grabPoint, hitHandle, type HandleId } from "./gizmoHandles";
import type { GizmoChange, GizmoSettings } from "./gizmoSettings";
import type { HandleInfo } from "../handles/startHandles";
import "./gizmo.css";
import { t } from "../../texts";
import { pageKeys, SCENE_CONTEXT, type PageKeyCommandSpec } from "../settings/pageKeys";

/** The gizmo now, for the script API and the tests. */
export interface GizmoInfo {
  readonly settings: GizmoSettings;
  /** The entities that a drag changes (the selection with a transform and with no lock). */
  readonly targets: readonly string[];
  /** The world origin of the gizmo, or null with no target. */
  readonly origin: readonly number[] | null;
  /** A canvas point (CSS pixels) to press each handle that shows on a pixel of the canvas. */
  readonly handles: Readonly<Partial<Record<HandleId, ScreenPoint>>>;
  readonly dragging: HandleId | null;
  /** The typed value of the drag that runs, or null. */
  readonly typed: string | null;
}

/** The gizmo part of the script API of the scene page. */
export interface GizmoApi {
  gizmo(): GizmoInfo;
  /** Change the settings (mode, axes, pivot, snaps) as the bar and the keys do. */
  setGizmo(change: GizmoChange): GizmoInfo;
  /** The handles of the components of the primary selected entity (handles/startHandles.ts). */
  handles?(): readonly HandleInfo[];
}

/** The context of the modal keys of a gizmo drag in the key map. */
export const GIZMO_DRAG_CONTEXT = "drag";

/** True for a text field (the inspector and the bar fields): the keys of the gizmo do not apply there. */
function textField(target: EventTarget | null): boolean {
  if (target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement) return true;
  return target instanceof HTMLInputElement && !["checkbox", "button"].includes(target.type);
}

/** The canvas point of a pointer event. */
function canvasPoint(canvas: HTMLCanvasElement, event: PointerEvent): ScreenPoint {
  const box = canvas.getBoundingClientRect();
  return { x: event.clientX - box.left, y: event.clientY - box.top };
}

/** The overlay: it draws again when the gizmo on the screen changes (a key of the state at each animation frame). */
function startOverlay(control: GizmoControl, hover: { id: HandleId | null }): void {
  const { canvas } = control.parts;
  const overlay = overlayCanvas(canvas);
  let last = "";
  const draw = (): void => {
    const box = canvas.getBoundingClientRect();
    const shape = control.shape();
    const active = control.dragging ?? hover.id;
    const key = JSON.stringify([box.width, box.height, box.left, box.top, active, control.mode, shape?.handles]);
    if (key !== last) {
      last = key;
      const px = (value: number): string => `${String(value)}px`;
      Object.assign(overlay.style, {
        left: px(box.left),
        top: px(box.top),
        width: px(box.width),
        height: px(box.height),
      });
      const context = fitOverlay(overlay, box.width, box.height);
      if (context !== null && shape !== null) drawGizmo(context, shape, active, control.mode === "scale");
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
}

/** The pointer: a press on a handle starts a drag (a capture listener: before the entity drag and the click select). */
function listenPointer(control: GizmoControl, hover: { id: HandleId | null }): void {
  const { canvas } = control.parts;
  const keys = (event: PointerEvent) => ({ alt: event.altKey, shift: event.shiftKey });
  // The pointer of a press whose drag does not run yet (the free move waits for the inspect report).
  let pending: number | null = null;
  const down = (event: PointerEvent): void => {
    if (event.target !== canvas || event.button !== 0 || control.live) return;
    const shape = control.shape();
    const at = canvasPoint(canvas, event);
    const handle = shape === null ? null : hitHandle(shape, at);
    if (handle === null) return;
    event.stopImmediatePropagation();
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    pending = event.pointerId;
    void control.press(handle, at, event.pointerId).then((started) => {
      // A release before the start ends the drag immediately.
      if (started && pending !== event.pointerId) control.end(true);
      pending = null;
    });
  };
  const move = (event: PointerEvent): void => {
    if (control.owns(event.pointerId)) {
      event.stopImmediatePropagation();
      control.move(canvasPoint(canvas, event), keys(event));
      return;
    }
    if (event.target !== canvas || control.live) return;
    const shape = control.shape();
    hover.id = shape === null ? null : (hitHandle(shape, canvasPoint(canvas, event))?.id ?? null);
  };
  const up = (event: PointerEvent): void => {
    if (pending === event.pointerId) {
      pending = null;
      event.stopImmediatePropagation();
    }
    if (!control.owns(event.pointerId)) return;
    event.stopImmediatePropagation();
    control.end(event.type === "pointercancel");
  };
  window.addEventListener("pointerdown", down, { capture: true });
  window.addEventListener("pointermove", move, { capture: true });
  window.addEventListener("pointerup", up, { capture: true });
  window.addEventListener("pointercancel", up, { capture: true });
}

/**
 * The page commands of the gizmo keys while no drag runs: the mode, the axes, the pivot and a typed value on an
 * axis. While the right button flies the editor camera (`data-fly`), W, A, S, D, Q and E move the camera, so the
 * commands do not run then.
 */
function gizmoCommands(control: GizmoControl): PageKeyCommandSpec[] {
  const { settings, canvas } = control.parts;
  const idle = (): string | null => {
    if (canvas.dataset.fly !== undefined) return t("gizmo-refuse-fly");
    return control.live ? t("gizmo-refuse-drag") : null;
  };
  const mode = (id: string, title: string, key: string, value: GizmoSettings["mode"]): PageKeyCommandSpec => ({
    ...{ id, title, keys: [key], keyContext: SCENE_CONTEXT, when: idle },
    run: () => settings.set({ mode: value }),
  });
  const axis = (index: AxisIndex): PageKeyCommandSpec => {
    const name = ["X", "Y", "Z"][index] ?? "X";
    return {
      ...{
        id: `gizmo.type${name}`,
        title: t("gizmo-command-type-axis", { axis: name }),
        keys: [name],
        keyContext: SCENE_CONTEXT,
      },
      when: () => idle() ?? (control.targets().length === 0 ? t("gizmo-refuse-no-entity") : null),
      run: () => void control.pressAxis(index),
    };
  };
  return [
    mode("gizmo.view", t("gizmo-command-view"), "Q", "view"),
    mode("gizmo.move", t("gizmo-command-move"), "W", "translate"),
    mode("gizmo.turn", t("gizmo-command-turn"), "E", "rotate"),
    mode("gizmo.scale", t("gizmo-command-scale"), "R", "scale"),
    {
      ...{ id: "gizmo.space", title: t("gizmo-command-space"), keys: ["L"], keyContext: SCENE_CONTEXT, when: idle },
      run: () => settings.set({ space: settings.value.space === "world" ? "local" : "world" }),
    },
    {
      ...{ id: "gizmo.pivot", title: t("gizmo-command-pivot"), keys: ["P"], keyContext: SCENE_CONTEXT, when: idle },
      run: () => settings.set({ pivot: settings.value.pivot === "pivot" ? "centre" : "pivot" }),
    },
    axis(0),
    axis(1),
    axis(2),
    // The modal keys of a gizmo drag (the drag reads them; the key map shows them and does not change them).
    ...[
      { id: "gizmo.confirm", title: t("gizmo-command-confirm"), keys: ["Enter"] },
      { id: "gizmo.cancel", title: t("gizmo-command-cancel"), keys: ["Escape"] },
    ].map((spec) => ({ ...spec, keyContext: GIZMO_DRAG_CONTEXT, keyKind: "modal" as const, run: () => undefined })),
  ];
}

/** The keys of a gizmo drag that runs: a typed value, Enter and Escape (modal input of the drag, not commands). */
function listenKeys(control: GizmoControl): void {
  window.addEventListener(
    "keydown",
    (event) => {
      if (!control.live || event.metaKey || event.ctrlKey || textField(event.target)) return;
      if (event.key === "Enter") control.end();
      else if (event.key === "Escape") control.end(true);
      else if (!control.type(event.key)) return;
      event.preventDefault();
      event.stopImmediatePropagation();
    },
    { capture: true },
  );
}

/** The gizmo now. */
function gizmoInfo(control: GizmoControl): GizmoInfo {
  const shape = control.shape();
  const { canvas } = control.parts;
  const box = canvas.getBoundingClientRect();
  // A grab point must be a pixel of the canvas: a panel of the page can cover a part of it.
  const owned = (point: ScreenPoint): boolean =>
    document.elementFromPoint(box.left + point.x, box.top + point.y) === canvas;
  const handles: Partial<Record<HandleId, ScreenPoint>> = {};
  for (const handle of shape?.handles ?? []) {
    const point = shape === null ? null : grabPoint(shape, handle.id, owned);
    if (point !== null) handles[handle.id] = point;
  }
  const typed = control.typed();
  return {
    settings: control.parts.settings.value,
    targets: control.targets(),
    origin: control.frame()?.origin ?? null,
    handles,
    dragging: control.dragging,
    typed: typed === null ? null : typed.text,
  };
}

/** Start the gizmos of the page; the result is the gizmo part of the script API. */
export function startGizmo(parts: GizmoParts): GizmoApi {
  const control = new GizmoControl(parts);
  const hover: { id: HandleId | null } = { id: null };
  const bar = gizmoBar(
    (change) => parts.settings.set(change),
    () => parts.settings.value,
  );
  // The overlays Tools and Tool settings of the Scene view do the same.
  let showOverlays: ((settings: GizmoSettings) => void) | null = null;
  whenOverlays((dock) => {
    showOverlays = gizmoOverlays(
      dock,
      (change) => parts.settings.set(change),
      () => parts.settings.value,
    );
    showOverlays(parts.settings.value);
  });
  bar.show(parts.settings.value);
  parts.settings.listen((value) => {
    bar.show(value);
    showOverlays?.(value);
  });
  control.listen(() => {
    const typed = control.typed();
    bar.typed(typed);
  });
  startOverlay(control, hover);
  listenPointer(control, hover);
  listenKeys(control);
  pageKeys().register(gizmoCommands(control));
  parts.canvas.dataset.gizmo = "1";
  return {
    gizmo: () => gizmoInfo(control),
    setGizmo: (change) => {
      parts.settings.set(change);
      return gizmoInfo(control);
    },
  };
}
