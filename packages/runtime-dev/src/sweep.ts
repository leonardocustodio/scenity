// SPDX-License-Identifier: Apache-2.0
/**
 * The update-only sweep of the labs: the samples that the page gives the labs core, and the comparison of two lists of
 * inspect reports. The core gives the inspect report of each time without a render (the sweep of the dev core); a test
 * compares those reports with the reports of the rendered sweep.
 */
import type { InspectReport } from "./inspect";

/**
 * One time of a sweep: the simulation time and the scene input of the page at that time. `Input` is the scene input of
 * the plugin core.
 */
export interface SweepSample<Input = unknown> {
  readonly simMs: number;
  readonly input: Input;
}

/** A difference between two reports: the path of the value and the two values. */
export interface ReportDifference {
  readonly path: string;
  readonly a: unknown;
  readonly b: unknown;
}

/** Two numbers are equal when both are not finite and the same, or when they differ by at most `tolerance`. */
function sameNumber(a: number, b: number, tolerance: number): boolean {
  if (!Number.isFinite(a) || !Number.isFinite(b)) return Object.is(a, b);
  return Math.abs(a - b) <= tolerance;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Add the differences of two values at `path` to `out` (at most `limit`). */
function diffValues(a: unknown, b: unknown, path: string, tolerance: number, out: ReportDifference[], limit: number) {
  if (out.length >= limit) return;
  if (typeof a === "number" && typeof b === "number") {
    if (!sameNumber(a, b, tolerance)) out.push({ path, a, b });
    return;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) {
      out.push({ path: `${path}.length`, a: a.length, b: b.length });
      return;
    }
    a.forEach((item: unknown, index) => {
      diffValues(item, b[index], `${path}[${String(index)}]`, tolerance, out, limit);
    });
    return;
  }
  if (isRecord(a) && isRecord(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort();
    for (const key of keys) diffValues(a[key], b[key], path === "" ? key : `${path}.${key}`, tolerance, out, limit);
    return;
  }
  if (!Object.is(a, b)) out.push({ path, a, b });
}

/**
 * The differences between two lists of inspect reports: every field of every member, with numbers equal
 * within `tolerance` (metres and radians; default 1e-9). The members are compared by their order in the report. An
 * empty list is equal. At most `limit` differences (default 50).
 */
export function reportDifferences(
  a: readonly (InspectReport | null)[],
  b: readonly (InspectReport | null)[],
  options: DifferenceOptions = {},
): ReportDifference[] {
  return valueDifferences(a, b, options);
}

/** The options of a comparison: the tolerance of the numbers and the most differences to give. */
export interface DifferenceOptions {
  readonly tolerance?: number;
  readonly limit?: number;
}

/** The differences between two plain values (arrays, objects, numbers within the tolerance, other values). */
export function valueDifferences(a: unknown, b: unknown, options: DifferenceOptions = {}): ReportDifference[] {
  const out: ReportDifference[] = [];
  diffValues(a, b, "", options.tolerance ?? 1e-9, out, options.limit ?? 50);
  return out;
}
