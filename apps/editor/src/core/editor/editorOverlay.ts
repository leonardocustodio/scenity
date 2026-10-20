// SPDX-License-Identifier: Apache-2.0
/**
 * The shapes of the editor overlay: the snap target of a drag and the measurements. The shapes are the lines, dots and
 * labels that the labs core draws (`@scenity/runtime-dev` `overlay.ts`). The overlay reads the snap result and the
 * measurements of the page. It keeps no state, and it is not an input of a frame.
 *
 * - A surface: the outline of its rectangle at its height. A wall: a frame 1 m wide and 1.2 m high on the wall at the
 *   prop. A rail: its segment. A socket and an anchor: a dot and a short line up from it. Each target has a label.
 * - A measurement: the line between its ends, a dot at each end, the horizontal and the vertical parts as two thin
 *   lines, and a label with the distance. A first pick that waits for the second shows as a dot.
 *
 * No Vue import: the tests read it.
 */
import type { Vec3 } from "@scenity/character";
import type { OverlayLabel, OverlayLine, OverlayDot, OverlaySpec } from "@scenity/runtime-dev";
import { measureLabel, type Measurement } from "./measure";
import type { Snapped } from "./snapPlace";
import { frameAt, isPoint, type SnapTarget, type SurfaceTarget } from "./snapTypes";

/** The shapes of one part of the overlay. */
interface Shapes {
  readonly lines: OverlayLine[];
  readonly dots: OverlayDot[];
  readonly labels: OverlayLabel[];
}

const empty = (): Shapes => ({ lines: [], dots: [], labels: [] });
/** A little over a surface, so its outline does not sink into the top. */
const LIFT = 0.004;

function surfaceShapes(surface: SurfaceTarget, out: Shapes): void {
  const { rect, frame } = surface;
  const corner = (x: number, z: number): Vec3 => {
    const at = frameAt(frame, [x, 0, z]);
    return [at[0], surface.y + LIFT, at[2]];
  };
  // The floor has no outline: its rectangle is the room.
  if (surface.owner === null) return;
  out.lines.push({
    points: [
      corner(rect.minX, rect.minZ),
      corner(rect.maxX, rect.minZ),
      corner(rect.maxX, rect.maxZ),
      corner(rect.minX, rect.maxZ),
    ],
    tone: "snap",
    closed: true,
  });
  out.labels.push({
    at: corner((rect.minX + rect.maxX) / 2, (rect.minZ + rect.maxZ) / 2),
    text: surface.label,
    tone: "snap",
  });
}

/** The shapes of a wall, a rail, a socket or an anchor at the place of the prop. */
function targetShapes(target: Exclude<SnapTarget, SurfaceTarget>, at: Vec3, out: Shapes): void {
  if (isPoint(target)) {
    const top: Vec3 = [target.at[0], target.at[1] + 0.15, target.at[2]];
    out.dots.push({ at: target.at, tone: "snap" });
    out.lines.push({ points: [target.at, top], tone: "snap" });
    out.labels.push({ at: top, text: target.label, tone: "snap" });
    return;
  }
  if (target.kind === "rail") {
    out.lines.push({ points: [target.a, target.b], tone: "snap" });
    out.labels.push({ at: target.a, text: target.label, tone: "snap" });
    return;
  }
  const [ux, uz] = [target.b[0] - target.a[0], target.b[2] - target.a[2]];
  const length = Math.hypot(ux, uz) || 1;
  const along = ((at[0] - target.a[0]) * ux + (at[2] - target.a[2]) * uz) / length;
  const point = (offset: number, y: number): Vec3 => [
    target.a[0] + (ux / length) * (along + offset),
    y,
    target.a[2] + (uz / length) * (along + offset),
  ];
  out.lines.push({
    points: [point(-0.5, 0.01), point(0.5, 0.01), point(0.5, 1.2), point(-0.5, 1.2)],
    tone: "snap",
    closed: true,
  });
  out.labels.push({ at: point(0, 1.2), text: target.label, tone: "snap" });
}

/** The shapes of a snap result of a drag: the surface that the prop sits on, and the target that changed the place. */
export function snapShapes(snapped: Snapped | null): Shapes {
  const out = empty();
  if (snapped === null) return out;
  if (snapped.surface !== null) surfaceShapes(snapped.surface, out);
  const target = snapped.target;
  if (target !== null && target.kind !== "surface") targetShapes(target, snapped.place.at, out);
  return out;
}

/** The shapes of the measurements, and of a first pick that waits for its second pick. */
export function measureShapes(measurements: readonly Measurement[], waiting: Vec3 | null): Shapes {
  const out = empty();
  for (const item of measurements) {
    const [a, b] = [item.from.at, item.to.at];
    // The corner of the two parts: the horizontal part at the height of `a`, then the vertical part up or down to `b`.
    const corner: Vec3 = [b[0], a[1], b[2]];
    out.lines.push({ points: [a, b], tone: "measure" }, { points: [a, corner, b], tone: "part" });
    out.dots.push({ at: a, tone: "measure" }, { at: b, tone: "measure" });
    const middle: Vec3 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2];
    out.labels.push({ at: middle, text: measureLabel(item, true), tone: "measure" });
  }
  if (waiting !== null) out.dots.push({ at: waiting, tone: "measure" });
  return out;
}

/** The overlay of the page: the snap shapes and the measurement shapes together. */
export function overlaySpec(
  snapped: Snapped | null,
  measurements: readonly Measurement[],
  waiting: Vec3 | null,
): OverlaySpec {
  const snapPart = snapShapes(snapped);
  const measurePart = measureShapes(measurements, waiting);
  return {
    lines: [...snapPart.lines, ...measurePart.lines],
    dots: [...snapPart.dots, ...measurePart.dots],
    labels: [...snapPart.labels, ...measurePart.labels],
  };
}
