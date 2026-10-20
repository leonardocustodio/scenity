// SPDX-License-Identifier: Apache-2.0
/**
 * The eases of the curve editor. The ease of a key gives the curve from the key before it to the key: a name (step,
 * linear, in, out, inOut) or a cubic Bézier `[x1, y1, x2, y2]` as in CSS. The two tangent handles of a Bézier are its
 * control points in the segment between the two keys: x is a share of the time, y a share of the value. A drag of a
 * handle gives a new Bézier; x stays in 0..1. Pure functions, no DOM.
 */
import type { EASE_NAMES, Ease } from "@scenity/scene/sequence";

/** The Bézier of a named ease (the CSS curves); step has none. */
export const NAMED_BEZIER: Readonly<Record<Exclude<(typeof EASE_NAMES)[number], "step">, readonly number[]>> = {
  linear: [0, 0, 1, 1],
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  inOut: [0.42, 0, 0.58, 1],
};

/** The name of an ease for the ease bar: a name, or "bezier". */
export function easeKind(ease: Ease | undefined): (typeof EASE_NAMES)[number] | "bezier" {
  if (ease === undefined) return "linear";
  return typeof ease === "string" ? ease : "bezier";
}

/** The control points of an ease, or null for step. */
export function bezierOf(ease: Ease | undefined): [number, number, number, number] | null {
  if (ease !== undefined && typeof ease !== "string") return [...ease.bezier];
  const name = ease ?? "linear";
  if (name === "step") return null;
  const points = NAMED_BEZIER[name];
  return [points[0] ?? 0, points[1] ?? 0, points[2] ?? 1, points[3] ?? 1];
}

/** A segment of a curve line: from the key before (t0, v0) to the key (t1, v1). */
export interface Segment {
  readonly t0: number;
  readonly v0: number;
  readonly t1: number;
  readonly v1: number;
}

/** The two tangent handles of a Bézier in a segment, as times and values. */
export function handlesOf(segment: Segment, bezier: readonly number[]): { t: number; v: number }[] {
  const dt = segment.t1 - segment.t0;
  const dv = segment.v1 - segment.v0;
  return [0, 2].map((at) => ({
    t: segment.t0 + (bezier[at] ?? 0) * dt,
    v: segment.v0 + (bezier[at + 1] ?? 0) * dv,
  }));
}

const round = (value: number): number => Math.round(value * 1000) / 1000;

/** The Bézier after a drag of handle `which` (0 or 1) to a time and a value; x stays in 0..1. */
export function dragHandle(
  segment: Segment,
  bezier: readonly number[],
  which: 0 | 1,
  t: number,
  v: number,
): { bezier: [number, number, number, number] } {
  const dt = segment.t1 - segment.t0 || 1;
  const dv = segment.v1 - segment.v0 || 1;
  const x = round(Math.min(1, Math.max(0, (t - segment.t0) / dt)));
  const y = round((v - segment.v0) / dv);
  const next = [...bezier] as [number, number, number, number];
  next[which * 2] = x;
  next[which * 2 + 1] = y;
  return { bezier: next };
}

/** The ease argument of `sequence.key.value` for a name or a Bézier. */
export function easeArg(ease: (typeof EASE_NAMES)[number] | { readonly bezier: readonly number[] }): string {
  return typeof ease === "string" ? ease : JSON.stringify({ bezier: ease.bezier });
}
