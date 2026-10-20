// SPDX-License-Identifier: Apache-2.0
/**
 * The handles of the components in the Scene view: the wires and the handles of the primary
 * selected entity (handleModel.ts) on a 2D overlay over the main view, as the gizmo draws. A press on a handle starts
 * a live drag of the scene channel: the handle moves along its axis, in its plane or in the plane of the view, and the
 * end of the drag is one step of the history (Escape restores the start). Alt and a press on a handle with an
 * item (a point of a path) deletes the item as one step. The overlay draws the posed scene, and a drag
 * changes the base scene with `unposeOps`, as the gizmo does.
 */
import { unposeOps } from "@scenity/editor-core";
import { diffDocuments } from "@scenity/scene/ops";
import { vsub, type Vec3 } from "@scenity/scene/math";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { pageView, projectPoint, viewRay, type CameraView, type ViewSource } from "../dragMath";
import type { ScenePageEditor } from "../sceneEditor";
import { mainViewBox } from "../viewport/mainView";
import { entityHandles, nearestOnAxis, onViewPlane, type ComponentHandle, type HandleSet } from "./handleModel";
import { ALL_HANDLE_PROVIDERS } from "./handleProviders";
import "./handles.css";

/** The distance in CSS pixels that a press finds a handle at. */
const HIT_PX = 8;
const HANDLE_PX = 5;

/** What the handles read of the page. */
export interface HandleParts extends ViewSource {
  readonly canvas: HTMLCanvasElement;
  readonly editor: ScenePageEditor;
  readonly selection: { readonly ids: readonly string[] };
}

/** A handle on the canvas, for the script API and the tests. */
export interface HandleInfo {
  readonly id: string;
  readonly entity: string;
  /** The canvas point of the handle (CSS pixels), or null when it is not in the view. */
  readonly x: number | null;
  readonly y: number | null;
  readonly ghost: boolean;
}

/** The handles part of the script API of the scene page. */
export interface HandlesApi {
  handles(): readonly HandleInfo[];
}

/** A drag of a handle that runs. */
interface HandleDrag {
  readonly handle: ComponentHandle;
  readonly pointer: number;
  readonly base: SceneDocument;
  readonly posed: SceneDocument;
  readonly view: CameraView;
  readonly box: DOMRect;
  /** The point of the press on the plane or the axis of the handle. */
  readonly grab: Vec3;
}

/** The colour of a token of the page, else a fallback. */
function token(name: string, fallback: string): string {
  const value = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return value === "" ? fallback : value;
}

/** The point of a ray on the axis or on the view plane of a handle. */
function dragPoint(handle: ComponentHandle, view: CameraView, ray: ReturnType<typeof viewRay>): Vec3 | null {
  if (handle.axis !== null) return nearestOnAxis(ray, handle.at, handle.axis);
  return onViewPlane(ray, handle.at, handle.plane ?? view.forward);
}

/** The op of a value of a handle: a set of the field in the component of its entity. */
function handleOp(handle: ComponentHandle, value: unknown): SceneOp {
  const field = handle.field.split(".").join("/");
  return { op: "set", path: `/entities/${handle.entity}/components/${handle.component}/${field}`, value } as SceneOp;
}

/** Draw the wires and the handles of a set on the overlay. */
function drawHandles(
  context: CanvasRenderingContext2D,
  set: HandleSet,
  view: CameraView,
  box: DOMRect,
  active: string | null,
): void {
  const project = (point: Vec3) => projectPoint(view, point, box.width, box.height);
  context.lineWidth = 1;
  context.strokeStyle = token("--sc-color-studio-selection", "#4c9aff");
  for (const wire of set.wires) {
    const points = wire.points.map(project);
    if (points.some((point) => point === null)) continue;
    context.beginPath();
    points.forEach((point, at) =>
      at === 0 ? context.moveTo(point?.x ?? 0, point?.y ?? 0) : context.lineTo(point?.x ?? 0, point?.y ?? 0),
    );
    if (wire.closed === true) context.closePath();
    context.stroke();
  }
  for (const handle of set.handles) {
    const point = project(handle.at);
    if (point === null) continue;
    context.beginPath();
    context.arc(point.x, point.y, HANDLE_PX, 0, Math.PI * 2);
    context.fillStyle = handle.id === active ? token("--sc-color-status-caution", "#ffd23f") : context.strokeStyle;
    if (handle.ghost === true) context.stroke();
    else context.fill();
  }
}

/** Start the handles of the Scene view; the result is the handles part of the script API. */
export function startHandles(parts: HandleParts): HandlesApi {
  const { canvas, editor } = parts;
  const overlay = document.createElement("canvas");
  overlay.id = "scene-handles";
  overlay.dataset.testid = "scene-handles";
  overlay.setAttribute("aria-hidden", "true");
  canvas.after(overlay);
  let drag: HandleDrag | null = null;
  let hover: string | null = null;
  const now = () => {
    const posed = editor.posed();
    const id = parts.selection.ids[0];
    const set = id === undefined ? { handles: [], wires: [] } : entityHandles(posed, id, ALL_HANDLE_PROVIDERS);
    return { posed, set, view: pageView(posed, parts), box: mainViewBox(canvas) };
  };
  const info = (): HandleInfo[] => {
    const { set, view, box } = now();
    return set.handles.map((handle) => {
      const point = view === null ? null : projectPoint(view, handle.at, box.width, box.height);
      return {
        id: handle.id,
        entity: handle.entity,
        x: point?.x ?? null,
        y: point?.y ?? null,
        ghost: handle.ghost === true,
      };
    });
  };
  let last = "";
  const draw = (): void => {
    // No selection, or the play mode: no handle, and no work in the frame after the overlay is clear.
    if (parts.selection.ids.length === 0 || editor.play.active) {
      if (last !== "") overlay.getContext("2d")?.clearRect(0, 0, overlay.width, overlay.height);
      last = "";
      requestAnimationFrame(draw);
      return;
    }
    const { set, view, box } = now();
    const key = JSON.stringify([box.left, box.top, box.width, box.height, view, set.handles.map((h) => h.at), hover]);
    if (key !== last) {
      last = key;
      const px = (value: number): string => `${String(value)}px`;
      Object.assign(overlay.style, {
        left: px(box.left),
        top: px(box.top),
        width: px(box.width),
        height: px(box.height),
      });
      const dpr = globalThis.devicePixelRatio || 1;
      overlay.width = Math.max(1, Math.round(box.width * dpr));
      overlay.height = Math.max(1, Math.round(box.height * dpr));
      const context = overlay.getContext("2d");
      context?.setTransform(dpr, 0, 0, dpr, 0, 0);
      context?.clearRect(0, 0, box.width, box.height);
      if (context !== null && view !== null) drawHandles(context, set, view, box, drag?.handle.id ?? hover);
    }
    requestAnimationFrame(draw);
  };
  requestAnimationFrame(draw);
  listenHandles(parts, {
    hit: (x, y) => {
      const { set, view, box, posed } = now();
      if (view === null) return null;
      const found = set.handles.find((handle) => {
        const point = projectPoint(view, handle.at, box.width, box.height);
        return point !== null && Math.hypot(point.x - x, point.y - y) <= HIT_PX;
      });
      return found === undefined ? null : { handle: found, view, box, posed };
    },
    get drag() {
      return drag;
    },
    set drag(next) {
      drag = next;
    },
    hover: (id) => (hover = id),
  });
  return { handles: info };
}

/** The pointer of the handles: the hit, the drag that runs and the hover. */
interface HandleInput {
  hit(x: number, y: number): { handle: ComponentHandle; view: CameraView; box: DOMRect; posed: SceneDocument } | null;
  drag: HandleDrag | null;
  hover(id: string | null): void;
}

/** Listen to the pointer and to Escape (a capture listener: before the entity drag, the orbit and the click select). */
function listenHandles(parts: HandleParts, input: HandleInput): void {
  const { canvas, editor } = parts;
  const local = (event: PointerEvent) => {
    const box = mainViewBox(canvas);
    return { x: event.clientX - box.left, y: event.clientY - box.top };
  };
  const end = (cancel: boolean): void => {
    const active = input.drag;
    if (active === null) return;
    input.drag = null;
    delete canvas.dataset.handleDrag;
    const same = diffDocuments(active.base, editor.doc).length === 0;
    editor.channel.end(cancel || same);
    editor.changed();
  };
  window.addEventListener(
    "pointerdown",
    (event) => {
      if (event.target !== canvas || event.button !== 0 || input.drag !== null || editor.channel.live) return;
      const at = local(event);
      const found = input.hit(at.x, at.y);
      if (found === null) return;
      // Alt and a press on a handle with an item deletes the item (one step).
      const remove = found.handle.remove;
      if (event.altKey && remove !== undefined) {
        event.stopImmediatePropagation();
        event.preventDefault();
        editor.channel.begin();
        editor.channel.move(unposeOps(editor.doc, found.posed, [handleOp(found.handle, remove())]));
        editor.channel.end(false);
        editor.changed();
        return;
      }
      const ray = viewRay(found.view, at.x, at.y, found.box.width, found.box.height);
      const grab = dragPoint(found.handle, found.view, ray);
      if (grab === null) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      canvas.setPointerCapture(event.pointerId);
      editor.channel.begin();
      input.drag = { ...found, pointer: event.pointerId, base: editor.doc, grab };
      canvas.dataset.handleDrag = found.handle.id;
    },
    { capture: true },
  );
  window.addEventListener(
    "pointermove",
    (event) => {
      const active = input.drag;
      if (active === null) {
        if (event.target === canvas) input.hover(input.hit(local(event).x, local(event).y)?.handle.id ?? null);
        return;
      }
      if (event.pointerId !== active.pointer) return;
      event.stopImmediatePropagation();
      const at = local(event);
      const ray = viewRay(active.view, at.x, at.y, active.box.width, active.box.height);
      const point = dragPoint(active.handle, active.view, ray);
      if (point === null) return;
      const moved: Vec3 = [...vsub(point, vsub(active.grab, active.handle.at))] as Vec3;
      const ops = [handleOp(active.handle, active.handle.value(moved))];
      editor.channel.move(unposeOps(active.base, active.posed, ops));
    },
    { capture: true },
  );
  const up = (event: PointerEvent): void => {
    if (input.drag?.pointer !== event.pointerId) return;
    event.stopImmediatePropagation();
    end(event.type === "pointercancel");
  };
  window.addEventListener("pointerup", up, { capture: true });
  window.addEventListener("pointercancel", up, { capture: true });
  window.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && input.drag !== null) {
      event.preventDefault();
      end(true);
    }
  });
}
