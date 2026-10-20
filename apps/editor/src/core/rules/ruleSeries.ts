// SPDX-License-Identifier: Apache-2.0
/**
 * The metric graph of a rule over time: the value of a rule with a sequence scope over the sequence time, its limit
 * band and the markers. The page evaluates copies of the rule at the markers and keys of the sequence and at a fixed
 * step (`samplingRules`). Thus a rule with one marker time also gets a line. The times of the rule scope show as check
 * marks on the line.
 *
 * It uses the scales of the metrics graph of the lab (core/graph/scale.ts). Pure: the panel and the tests read it.
 */
import type { Rule } from "@scenity/scene";
import type { MetricLimit, RuleResult, RuleStatus } from "@scenity/rules";
import { niceStep, type PlotFrame } from "../graph/scale";

/** One value of the line: the time, the value (null: no value at that time) and the result there. */
export interface SeriesPoint {
  readonly t: number;
  readonly value: number | null;
  readonly status: RuleStatus;
}

/** A named time of the sequence. */
export interface SeriesMarker {
  readonly t: number;
  readonly label: string;
}

/** The graph data of one rule. */
export interface RuleSeries {
  readonly id: string;
  readonly unit: string | null;
  readonly points: readonly SeriesPoint[];
  readonly limit: MetricLimit | null;
  readonly markers: readonly SeriesMarker[];
  /** The times of the scope of the rule (its own checks). */
  readonly checks: readonly SeriesPoint[];
  readonly duration: number;
}

/** The sequence as the graph reads it. */
export interface SeriesSequence {
  readonly id: string;
  readonly duration: number;
  readonly markers?: Readonly<Record<string, number>> | undefined;
}

/** The most samples of the fixed step over the sequence. */
export const GRAPH_SAMPLES = 60;

/** The suffixes of the IDs of the sampling copies of a rule. */
const KEYS = ".graphKeys";
const STEP = ".graphStep";

/** The copies of a rule that sample its value: at the markers and keys of the sequence, and at a fixed step. */
export function samplingRules(rule: Rule, sequence: SeriesSequence): Rule[] {
  const step = Math.max(50, Math.round(sequence.duration / GRAPH_SAMPLES));
  const base = { ...rule, level: "warn" as const };
  return [
    { ...base, id: `${rule.id}${KEYS}`, scope: { kind: "sequence", sequence: sequence.id } },
    {
      ...base,
      id: `${rule.id}${STEP}`,
      scope: { kind: "range", sequence: sequence.id, from: 0, to: Math.max(0, sequence.duration), step },
    },
  ];
}

/** The points of the sampling results of a rule, in time order, one point for each time. */
function samplePoints(id: string, results: readonly RuleResult[]): SeriesPoint[] {
  const byTime = new Map<number, SeriesPoint>();
  for (const result of results) {
    if (result.id !== `${id}${KEYS}` && result.id !== `${id}${STEP}`) continue;
    for (const time of result.times) {
      if (time.at.t === null || byTime.has(time.at.t)) continue;
      byTime.set(time.at.t, { t: time.at.t, value: time.value, status: time.status });
    }
  }
  return [...byTime.values()].sort((a, b) => a.t - b.t);
}

/**
 * The graph data of a rule: `own` is the result of the rule (its scope times), `samples` the results of the sampling
 * copies. The unit is the unit of the first value.
 */
export function seriesOf(
  own: RuleResult,
  samples: readonly RuleResult[],
  sequence: SeriesSequence,
  limit: MetricLimit | null,
): RuleSeries {
  const points = samplePoints(own.id, samples);
  const checks = own.times.flatMap((time) =>
    time.at.t === null ? [] : [{ t: time.at.t, value: time.value, status: time.status }],
  );
  const unit = [...own.times, ...samples.flatMap((result) => result.times)].find((time) => time.unit !== null);
  const markers = Object.entries(sequence.markers ?? {})
    .map(([label, t]) => ({ label, t }))
    .sort((a, b) => a.t - b.t || a.label.localeCompare(b.label));
  return { id: own.id, unit: unit?.unit ?? null, points, limit, markers, checks, duration: sequence.duration };
}

/** The value range of the graph: every value and each limit, with a margin, at round ends. */
export function seriesRange(series: RuleSeries): [number, number] {
  const values = [...series.points, ...series.checks].flatMap((point) => (point.value === null ? [] : [point.value]));
  if (series.limit?.min !== undefined) values.push(series.limit.min);
  if (series.limit?.max !== undefined) values.push(series.limit.max);
  if (values.length === 0) return [0, 1];
  let lo = Math.min(...values);
  let hi = Math.max(...values);
  if (lo >= 0) lo = 0;
  const pad = (hi - lo) * 0.1 || Math.abs(hi) * 0.1 || 1;
  hi += pad;
  if (lo < 0) lo -= pad;
  const step = niceStep(hi - lo, 4);
  return [Math.floor(lo / step) * step, Math.ceil(hi / step) * step];
}

/** The plot frame of a graph of `width` × `height` px with a gutter at the left for the value ticks. */
export function seriesFrame(series: RuleSeries, width: number, height: number, gutter = 40): PlotFrame {
  const [v0, v1] = seriesRange(series);
  return {
    x0: gutter,
    x1: Math.max(gutter + 1, width - 8),
    y0: 6,
    y1: height - 14,
    t0: 0,
    t1: series.duration,
    v0,
    v1,
  };
}

/** The SVG path of the line: a gap at each point with no value. */
export function seriesPath(points: readonly SeriesPoint[], x: (t: number) => number, y: (v: number) => number): string {
  let path = "";
  let open = false;
  for (const point of points) {
    if (point.value === null) {
      open = false;
      continue;
    }
    path += `${open ? "L" : "M"}${x(point.t).toFixed(1)},${y(point.value).toFixed(1)}`;
    open = true;
  }
  return path;
}
