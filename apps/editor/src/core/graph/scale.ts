// SPDX-License-Identifier: Apache-2.0
/**
 * The scales of the metrics graph: the time of a take to x in px, a value to y in px, the value range of a lane (the
 * data and the limits), the ticks, and the sample under the pointer. The functions are pure.
 */
import type { MetricBands, MetricSeries } from "./series";

/** The plot area of one lane in CSS px, and the time and value ranges that it shows. */
export interface PlotFrame {
  readonly x0: number;
  readonly x1: number;
  /** The top (the largest value) and the bottom (the smallest value) in px. */
  readonly y0: number;
  readonly y1: number;
  readonly t0: number;
  readonly t1: number;
  readonly v0: number;
  readonly v1: number;
}

/** The left gutter of a lane for the value ticks (px), and the right margin. */
export const GUTTER_PX = 44;
export const MARGIN_PX = 8;

export function xOf(frame: PlotFrame, time: number): number {
  const span = frame.t1 - frame.t0 || 1;
  return frame.x0 + ((time - frame.t0) / span) * (frame.x1 - frame.x0);
}

/** The time at x (clamped to the time range). */
export function timeOf(frame: PlotFrame, x: number): number {
  const width = frame.x1 - frame.x0 || 1;
  const share = Math.min(1, Math.max(0, (x - frame.x0) / width));
  return frame.t0 + share * (frame.t1 - frame.t0);
}

export function yOf(frame: PlotFrame, value: number): number {
  const span = frame.v1 - frame.v0 || 1;
  const share = (value - frame.v0) / span;
  return frame.y1 - share * (frame.y1 - frame.y0);
}

/** A round step for approximately `count` ticks across a range: 1, 2 or 5 times a power of 10. */
export function niceStep(span: number, count: number): number {
  const raw = Math.abs(span) / Math.max(1, count);
  if (raw === 0 || !Number.isFinite(raw)) return 1;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  return (unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10) * power;
}

/** The ticks from `lo` to `hi` at a round step (each a multiple of the step). */
export function ticksOf(lo: number, hi: number, count: number): number[] {
  const step = niceStep(hi - lo, count);
  const out: number[] = [];
  for (let value = Math.ceil(lo / step) * step; value <= hi + step * 1e-9; value += step) {
    out.push(Number(value.toPrecision(12)));
  }
  return out;
}

/**
 * The value range of a lane: all values of the series and all finite limits of its checks, so a limit line always
 * shows. A distance starts at 0. An angle gets a margin of 0.1 of its range. The ends are multiples of a round step.
 */
export function valueRange(series: MetricSeries, bands: MetricBands): [number, number] {
  let lo = Number.POSITIVE_INFINITY;
  let hi = Number.NEGATIVE_INFINITY;
  for (const line of series.lines) {
    for (const value of line.values) {
      if (Number.isNaN(value)) continue;
      lo = Math.min(lo, value);
      hi = Math.max(hi, value);
    }
  }
  for (const limit of bands.limits) {
    lo = Math.min(lo, limit.value);
    hi = Math.max(hi, limit.value);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi)) return [0, 1];
  if (series.unit === "m") lo = Math.min(0, lo);
  const pad = series.unit === "m" ? (hi - lo) * 0.1 : Math.max(1, (hi - lo) * 0.1);
  if (series.unit === "deg") lo -= pad;
  hi += pad;
  if (hi - lo < 1e-6) hi = lo + (series.unit === "m" ? 0.01 : 1);
  const step = niceStep(hi - lo, 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** The index of the sample time nearest to a time (binary search; -1 for no times). */
export function nearestIndex(times: readonly number[], time: number): number {
  if (times.length === 0) return -1;
  let lo = 0;
  let hi = times.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if ((times[mid] ?? 0) <= time) lo = mid;
    else hi = mid;
  }
  return Math.abs((times[hi] ?? 0) - time) < Math.abs((times[lo] ?? 0) - time) ? hi : lo;
}

/** The time of a click at x: the nearest sample time, so the seek shows a frame of the graph (and of the index). */
export function seekTimeAt(frame: PlotFrame, x: number, times: readonly number[]): number {
  const time = timeOf(frame, x);
  const index = nearestIndex(times, time);
  return index < 0 ? Math.round(time) : (times[index] ?? Math.round(time));
}

/** The value of each line of a series at the sample nearest to a time (without the lines that have no value there). */
export function valuesAt(
  series: MetricSeries,
  time: number,
): { at: number; values: { member: string | null; value: number }[] } | null {
  const index = nearestIndex(series.times, time);
  if (index < 0) return null;
  const values = series.lines.flatMap((line) => {
    const value = line.values[index] ?? Number.NaN;
    return Number.isNaN(value) ? [] : [{ member: line.member, value }];
  });
  return { at: series.times[index] ?? time, values };
}

/** The value as text with its unit: metres in cm below 1 m, degrees as whole numbers. */
export function valueText(value: number, unit: "m" | "deg"): string {
  if (unit === "deg") return `${value.toFixed(0)}°`;
  return Math.abs(value) < 1 ? `${(value * 100).toFixed(1)} cm` : `${value.toFixed(2)} m`;
}
