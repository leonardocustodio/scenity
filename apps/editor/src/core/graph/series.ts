// SPDX-License-Identifier: Apache-2.0
/**
 * The data of the metrics graph: the lines of the motion metrics (packages/runtime-dev/src/metrics.ts) across a take,
 * with one line for each metric and member. The limits of the plugin checks show as bands (pass, known gap, fail). The
 * functions are pure. The graph view, the separate graph page and the tests use them.
 *
 * The index manifest keeps the metrics of a frame as the flat record of `@scenity/labs-platform/indexRead`
 * (`metricsRecord`: `<member>|<metric>|<unit>`, the member `scene` for a value of the scene). `flattenMetrics` writes
 * the record of one frame, and `samplesOfManifest` reads the samples from the manifest.
 */
import type { MetricName, MetricValue } from "../../plugins";
import { metricsList, metricsRecord } from "@scenity/labs-platform/indexRead";
import type { TakeManifest } from "@scenity/labs-platform/indexStore";
import { checkSpan, memberOrder, metricOrder, takeChecks, type MotionCheck } from "../checks";
import { momentsOf } from "../sequence";

/** The metrics at one time. */
export interface MetricSample {
  readonly at: number;
  readonly values: readonly MetricValue[];
}

/** One line of a metric: the value of one member at each time of the series (NaN: no value at that time). */
export interface SeriesLine {
  /** The member of the line, `a+b` for two members of an overlap, or null for the scene. */
  readonly member: string | null;
  readonly values: readonly number[];
}

/** The lines of one metric across the take. */
export interface MetricSeries {
  readonly metric: MetricName;
  readonly unit: "m" | "deg";
  /** The sample times (ms), in sequence: the x of each value of each line. */
  readonly times: readonly number[];
  readonly lines: readonly SeriesLine[];
}

/**
 * The color slot of a line (1 to 5). A member keeps its slot in all metrics and all takes. The plugin gives the
 * members of the slots 1 to 4 (`memberOrder`). Other lines get slot 5.
 */
export function colorSlot(member: string | null): number {
  const index = member === null ? -1 : memberOrder().indexOf(member);
  return index < 0 ? 5 : index + 1;
}

function lineOrder(a: string | null, b: string | null): number {
  return colorSlot(a) - colorSlot(b) || String(a).localeCompare(String(b));
}

/** The series of each metric that has a value in the samples, in the metric order of the plugin. */
export function seriesOf(samples: readonly MetricSample[]): MetricSeries[] {
  const times = samples.map((sample) => sample.at);
  const byMetric = new Map<MetricName, { unit: "m" | "deg"; lines: Map<string | null, number[]> }>();
  samples.forEach((sample, index) => {
    for (const value of sample.values) {
      let entry = byMetric.get(value.metric);
      if (entry === undefined) {
        entry = { unit: value.unit, lines: new Map() };
        byMetric.set(value.metric, entry);
      }
      let line = entry.lines.get(value.member);
      if (line === undefined) {
        line = Array.from({ length: samples.length }, () => Number.NaN);
        entry.lines.set(value.member, line);
      }
      // Two values of one member at one time: the graph shows the worse value (metrics.ts does not give this case).
      const old = line[index] ?? Number.NaN;
      const low = value.unit === "deg";
      line[index] = Number.isNaN(old) ? value.value : low ? Math.min(old, value.value) : Math.max(old, value.value);
    }
  });
  const known = metricOrder();
  const order = [...known, ...[...byMetric.keys()].filter((metric) => !known.includes(metric))];
  return order.flatMap((metric) => {
    const entry = byMetric.get(metric);
    if (entry === undefined) return [];
    const members = [...entry.lines.keys()].sort(lineOrder);
    const lines = members.map((member) => ({ member, values: entry.lines.get(member) ?? [] }));
    return [{ metric, unit: entry.unit, times, lines }];
  });
}

// ---------------------------------------------------------------------------------------------
// The bands of the checks.

export type BandKind = "pass" | "known" | "fail";

/** A region of a lane: the values from `lo` to `hi` over the times from `from` to `to` (ms). */
export interface Band {
  readonly kind: BandKind;
  readonly from: number;
  readonly to: number;
  readonly lo: number;
  readonly hi: number;
  /** The member of the checks, or null for all members. */
  readonly member: string | null;
}

/** A limit of a check as a line across its time range. */
export interface LimitLine {
  readonly kind: "fail" | "known";
  readonly value: number;
  readonly from: number;
  readonly to: number;
  readonly member: string | null;
  /** For example `max 0.09 (ada)`, or the reason of a known gap. */
  readonly label: string;
}

export interface MetricBands {
  readonly bands: readonly Band[];
  readonly limits: readonly LimitLine[];
}

/** The half width of the band of a check at one moment (ms). Thus the band is visible at the scale of a take. */
export const MOMENT_HALF_MS = 100;

/** The time range of a check: its moment, its range, else the span of the take. */
export function checkRange(check: MotionCheck, take: string): readonly [number, number] {
  if (check.at !== undefined) {
    const moments = momentsOf(take);
    const at = typeof check.at === "number" ? check.at : (moments[check.at] ?? 0);
    return [at - MOMENT_HALF_MS, at + MOMENT_HALF_MS];
  }
  return check.during ?? checkSpan(take) ?? [0, 0];
}

/** The checks of a take for one metric: the common checks and the checks of the take. */
export function checksOf(take: string, metric: string): MotionCheck[] {
  return takeChecks(take).filter((check) => check.metric === metric);
}

function limitLabel(check: MotionCheck): string {
  const limit = check.max === undefined ? `min ${String(check.min)}` : `max ${String(check.max)}`;
  const member = check.member === undefined ? "" : ` (${check.member})`;
  return check.known === undefined ? `${limit}${member}` : `${limit}${member}, known gap: ${check.known}`;
}

/** The bands of one group of checks (one member, one time range, one direction). */
function groupBands(checks: readonly MotionCheck[], from: number, to: number, member: string | null): Band[] {
  const high = checks.every((check) => check.max !== undefined);
  const limitOf = (check: MotionCheck) => (high ? (check.max ?? 0) : (check.min ?? 0));
  const hard = checks.filter((check) => check.known === undefined).map(limitOf);
  const soft = checks.filter((check) => check.known !== undefined).map(limitOf);
  // The strictest limit of each kind: the smallest maximum, or the largest minimum.
  const pick = (values: number[]) => (values.length === 0 ? null : high ? Math.min(...values) : Math.max(...values));
  const hardLimit = pick(hard);
  const softLimit = pick(soft);
  const bands: Band[] = [];
  const band = (kind: BandKind, a: number, b: number) => {
    bands.push({ kind, from, to, lo: Math.min(a, b), hi: Math.max(a, b), member });
  };
  const outer = high ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;
  const inner = high ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;
  const strictest = pick([...hard, ...soft]) ?? outer;
  band("pass", inner, strictest);
  const knownMatters =
    softLimit !== null && (hardLimit === null || (high ? softLimit < hardLimit : softLimit > hardLimit));
  if (knownMatters) band("known", softLimit, hardLimit ?? outer);
  if (hardLimit !== null) band("fail", hardLimit, outer);
  return bands;
}

/**
 * The bands and the limit lines of a metric in a take. Each group of checks (the same member, time range and
 * direction) gets three regions. The pass region goes to the strictest limit. The known gap is between a limit with
 * `known` and the hard limit. The fail region is after the hard limit.
 */
export function bandsOf(take: string, metric: string): MetricBands {
  const checks = checksOf(take, metric);
  const groups = new Map<string, { checks: MotionCheck[]; from: number; to: number; member: string | null }>();
  for (const check of checks) {
    const [from, to] = checkRange(check, take);
    const member = check.member ?? null;
    const id = `${String(member)}|${String(from)}|${String(to)}|${check.max === undefined ? "min" : "max"}`;
    const group = groups.get(id) ?? { checks: [], from, to, member };
    group.checks.push(check);
    groups.set(id, group);
  }
  const bands = [...groups.values()].flatMap((group) => groupBands(group.checks, group.from, group.to, group.member));
  const limits = checks.map((check): LimitLine => {
    const [from, to] = checkRange(check, take);
    return {
      kind: check.known === undefined ? "fail" : "known",
      value: check.max ?? check.min ?? 0,
      from,
      to,
      member: check.member ?? null,
      label: limitLabel(check),
    };
  });
  return { bands, limits };
}

// ---------------------------------------------------------------------------------------------
// The index manifest.

/** The flat record of the metrics of one frame for the index manifest (`IndexFrame.metrics`, `metricsRecord`). */
export function flattenMetrics(values: readonly MetricValue[]): Record<string, number> {
  return metricsRecord(values);
}

/** The metric values of a flat record of the index manifest (`metricsList`; the member `scene` is null). */
export function unflattenMetrics(record: Readonly<Record<string, number>>): MetricValue[] {
  return metricsList(record).map((item) => {
    const metric = item.metric as MetricName;
    const unit = item.unit === "deg" || item.unit === "m" ? item.unit : metric.startsWith("joints.") ? "deg" : "m";
    return { metric, value: item.value, unit, member: item.member === "scene" ? null : item.member };
  });
}

/** The samples of a take manifest of the index: one for each time with metrics, in time sequence (null: none). */
export function samplesOfManifest(manifest: TakeManifest | null): MetricSample[] | null {
  if (manifest === null) return null;
  const byTime = new Map<number, MetricValue[]>();
  for (const frame of manifest.frames) {
    if (frame.metrics === null || byTime.has(frame.timeMs)) continue;
    byTime.set(frame.timeMs, unflattenMetrics(frame.metrics));
  }
  if (byTime.size === 0) return null;
  return [...byTime].sort(([a], [b]) => a - b).map(([at, values]) => ({ at, values }));
}
