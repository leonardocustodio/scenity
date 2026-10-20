// SPDX-License-Identifier: Apache-2.0
/**
 * The ease curves of the sequence keys. An ease maps the fraction `u` of a segment (0..1) to the fraction of
 * the value change. Each curve gives exactly 0 at `u = 0` and exactly 1 at `u = 1`. The names `in`, `out` and `inOut`
 * are the CSS curves `ease-in`, `ease-out` and `ease-in-out`.
 */
import type { Ease, EaseName } from "../schema/sequence";

type Bezier = readonly [number, number, number, number];

/** The control points of the named curves (the CSS values). */
export const EASE_BEZIERS: Readonly<Record<Exclude<EaseName, "step" | "linear">, Bezier>> = {
  in: [0.42, 0, 1, 1],
  out: [0, 0, 0.58, 1],
  inOut: [0.42, 0, 0.58, 1],
};

/** One coordinate of the cubic Bézier curve from 0 to 1 with the inner control values p1 and p2. */
function cubic(p1: number, p2: number, s: number): number {
  const r = 1 - s;
  return 3 * r * r * s * p1 + 3 * r * s * s * p2 + s * s * s;
}

function cubicSlope(p1: number, p2: number, s: number): number {
  const r = 1 - s;
  return 3 * r * r * p1 + 6 * r * s * (p2 - p1) + 3 * s * s * (1 - p2);
}

/**
 * The value of a CSS cubic Bézier curve at `u`. The function finds the curve parameter for `u` with Newton steps,
 * and then with bisection when a step fails. With x1 and x2 in 0..1, x increases with the parameter. Thus there is
 * one answer.
 */
export function bezierEase(points: Bezier, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  const [x1, y1, x2, y2] = points;
  let s = u;
  for (let step = 0; step < 8; step += 1) {
    const error = cubic(x1, x2, s) - u;
    if (Math.abs(error) < 1e-9) return cubic(y1, y2, s);
    const slope = cubicSlope(x1, x2, s);
    if (Math.abs(slope) < 1e-9) break;
    s -= error / slope;
    if (s < 0 || s > 1) break;
  }
  let low = 0;
  let high = 1;
  s = u;
  for (let step = 0; step < 50; step += 1) {
    const x = cubic(x1, x2, s);
    if (Math.abs(x - u) < 1e-9) break;
    if (x < u) low = s;
    else high = s;
    s = (low + high) / 2;
  }
  return cubic(y1, y2, s);
}

/** The value of an ease at `u`. The value of `u` is clamped to 0..1. `step` gives 0 until `u` is 1. */
export function applyEase(ease: Ease | undefined, u: number): number {
  if (u <= 0) return 0;
  if (u >= 1) return 1;
  if (ease === undefined || ease === "linear") return u;
  if (ease === "step") return 0;
  if (typeof ease === "string") return bezierEase(EASE_BEZIERS[ease], u);
  return bezierEase(ease.bezier, u);
}
