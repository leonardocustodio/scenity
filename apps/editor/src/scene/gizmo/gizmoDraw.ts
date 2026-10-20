// SPDX-License-Identifier: Apache-2.0
/**
 * The overlay of the transform gizmo: a 2D canvas over the scene canvas with no
 * pointer events. It draws the handles of gizmoHandles.ts with the camera of the document; the handle under the
 * pointer or in a drag is yellow. The overlay is a view value of the page: it is not part of a frame of the core, a
 * capture, the URL or a file.
 */
import type { ScreenPoint } from "@scenity/editor-core";
import type { GizmoShape, Handle, HandleId } from "./gizmoHandles";

const AXIS_COLOURS = ["#e5484d", "#46a758", "#3e8ed0"] as const;
const ACTIVE = "#ffd23f";
const CENTRE = "#f2f2f2";

/** The overlay canvas: after the scene canvas, so the panels of the page stay over it. */
export function overlayCanvas(scene: HTMLCanvasElement): HTMLCanvasElement {
  const overlay = document.createElement("canvas");
  overlay.id = "scene-gizmo";
  overlay.dataset.testid = "scene-gizmo";
  overlay.setAttribute("aria-hidden", "true");
  scene.after(overlay);
  return overlay;
}

/** Fit the pixels of the overlay to its CSS size; the result is the 2D context in CSS pixels, or null. */
export function fitOverlay(overlay: HTMLCanvasElement, width: number, height: number): CanvasRenderingContext2D | null {
  const dpr = globalThis.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * dpr));
  const h = Math.max(1, Math.round(height * dpr));
  if (overlay.width !== w) overlay.width = w;
  if (overlay.height !== h) overlay.height = h;
  const context = overlay.getContext("2d");
  context?.setTransform(dpr, 0, 0, dpr, 0, 0);
  context?.clearRect(0, 0, width, height);
  return context;
}

function colourOf(handle: Handle, active: HandleId | null): string {
  if (handle.id === active) return ACTIVE;
  return handle.axis === null ? CENTRE : AXIS_COLOURS[handle.axis];
}

function path(context: CanvasRenderingContext2D, points: readonly ScreenPoint[], close: boolean): void {
  context.beginPath();
  points.forEach((point, index) => {
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  });
  if (close) context.closePath();
}

/** The head at the tip of an axis: a triangle (move) or a box (scale). */
function axisHead(context: CanvasRenderingContext2D, from: ScreenPoint, to: ScreenPoint, box: boolean): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  if (box) {
    context.fillRect(to.x - 5, to.y - 5, 10, 10);
    return;
  }
  const side = (turn: number): ScreenPoint => ({
    x: to.x - 12 * Math.cos(angle + turn),
    y: to.y - 12 * Math.sin(angle + turn),
  });
  path(context, [to, side(0.4), side(-0.4)], true);
  context.fill();
}

/** Draw one handle. */
function drawHandle(context: CanvasRenderingContext2D, handle: Handle, active: HandleId | null, box: boolean): void {
  const colour = colourOf(handle, active);
  context.strokeStyle = colour;
  context.fillStyle = colour;
  const [first, second] = handle.points;
  if (handle.kind === "centre" && first !== undefined) {
    context.lineWidth = 2;
    if (box) context.strokeRect(first.x - 6, first.y - 6, 12, 12);
    else {
      context.beginPath();
      context.arc(first.x, first.y, 7, 0, 2 * Math.PI);
      context.stroke();
    }
    return;
  }
  if (handle.kind === "plane") {
    context.globalAlpha = handle.id === active ? 0.7 : 0.35;
    path(context, handle.points, true);
    context.fill();
    context.globalAlpha = 1;
    return;
  }
  context.lineWidth = handle.id === active ? 3.5 : 2.5;
  path(context, handle.points, false);
  context.stroke();
  if (handle.kind === "axis" && first !== undefined && second !== undefined) axisHead(context, first, second, box);
}

/** Draw the gizmo: the planes first, then the lines and the rings, then the centre. */
export function drawGizmo(
  context: CanvasRenderingContext2D,
  shape: GizmoShape,
  active: HandleId | null,
  scaleMode: boolean,
): void {
  const order = { plane: 0, ring: 1, axis: 1, centre: 2 } as const;
  const handles = [...shape.handles].sort((a, b) => order[a.kind] - order[b.kind]);
  for (const handle of handles) drawHandle(context, handle, active, scaleMode);
}
