// SPDX-License-Identifier: Apache-2.0
/**
 * The overlay of the layout tools of the scene page: a 2D canvas over the scene canvas with no pointer events, as the
 * gizmo overlay. It projects the lines, the dots and the labels of a tool
 * result (world points) with the camera that draws (dragMath.ts `projectPoint`). The overlay is a view value of the
 * page: it is not part of a frame of the core, a capture, the URL or a file. The tones have the colours of the lab
 * overlay (`@scenity/runtime-dev` overlay.ts).
 */
import type { OverlaySpec, OverlayTone } from "@scenity/runtime-dev/overlay";
import { projectPoint, type CameraView, type CanvasPoint } from "../dragMath";

const TONES: Readonly<Record<OverlayTone, string>> = {
  snap: "#ffb020",
  measure: "#ff3df0",
  part: "#ffa8f6",
  place: "#3ddcff",
  reach: "#2ee6b8",
  walk: "#7dff6a",
  narrow: "#ffe14d",
  blocked: "#ff3030",
  handle: "#f4f4f4",
  ghost: "#8fa8c8",
};

/** What the overlay drew: the counts and the label texts (the script API and the tests read it). */
export interface DrawnOverlay {
  readonly lines: number;
  readonly dots: number;
  readonly labels: readonly string[];
}

/** The overlay canvas of the layout tools: after the scene canvas, so the panels of the page stay over it. */
export function layoutOverlay(scene: HTMLCanvasElement): HTMLCanvasElement {
  const overlay = document.createElement("canvas");
  overlay.id = "scene-layout-overlay";
  overlay.dataset.testid = "scene-layout-overlay";
  overlay.setAttribute("aria-hidden", "true");
  scene.after(overlay);
  return overlay;
}

/** The canvas points of a line; a point behind the camera ends a part of the line. */
function parts(points: readonly CanvasPoint[][]): CanvasPoint[][] {
  return points.filter((part) => part.length > 1);
}

/** Split the projected points of a line at the points behind the camera. */
function project(view: CameraView, points: readonly (readonly [number, number, number])[], size: [number, number]) {
  const out: CanvasPoint[][] = [[]];
  for (const point of points) {
    const at = projectPoint(view, [point[0], point[1], point[2]], size[0], size[1]);
    if (at === null) out.push([]);
    else out[out.length - 1]?.push(at);
  }
  return parts(out);
}

/** A label: the text on a dark plate, in the colour of its tone. */
function drawLabel(context: CanvasRenderingContext2D, at: CanvasPoint, text: string, colour: string): void {
  context.font = "12px system-ui, sans-serif";
  const width = context.measureText(text).width;
  context.fillStyle = "rgb(0 0 0 / 70%)";
  context.fillRect(at.x + 6, at.y - 18, width + 8, 16);
  context.fillStyle = colour;
  context.fillText(text, at.x + 10, at.y - 6);
}

/** Draw the shapes of a tool result with a camera view on a context in CSS pixels. */
export function drawLayout(
  context: CanvasRenderingContext2D,
  spec: OverlaySpec,
  view: CameraView,
  size: [number, number],
): DrawnOverlay {
  let lines = 0;
  context.lineWidth = 2;
  for (const line of spec.lines) {
    const closed =
      line.closed === true && line.points[0] !== undefined ? [...line.points, line.points[0]] : line.points;
    context.strokeStyle = TONES[line.tone];
    for (const part of project(view, closed, size)) {
      context.beginPath();
      part.forEach((point, index) => {
        if (index === 0) context.moveTo(point.x, point.y);
        else context.lineTo(point.x, point.y);
      });
      context.stroke();
      lines += 1;
    }
  }
  let dots = 0;
  for (const dot of spec.dots) {
    const at = projectPoint(view, [dot.at[0], dot.at[1], dot.at[2]], size[0], size[1]);
    if (at === null) continue;
    context.fillStyle = TONES[dot.tone];
    context.beginPath();
    context.arc(at.x, at.y, 4, 0, 2 * Math.PI);
    context.fill();
    dots += 1;
  }
  const labels: string[] = [];
  for (const label of spec.labels) {
    const at = projectPoint(view, [label.at[0], label.at[1], label.at[2]], size[0], size[1]);
    if (at === null) continue;
    drawLabel(context, at, label.text, TONES[label.tone]);
    labels.push(label.text);
  }
  return { lines, dots, labels };
}
