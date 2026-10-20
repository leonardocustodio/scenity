// SPDX-License-Identifier: Apache-2.0
/**
 * The lanes of the metrics graph, from the samples of a take. Each metric has one lane with its series, its bands, its
 * plot frame and the verdict of its checks. The functions are pure. MetricsGraph.vue draws the lanes, and the tests
 * check the scales, the bands and the verdicts without a canvas.
 */
import { checkReport, checkTake, type LabCheckReport } from "../checks";
import { bandsOf, seriesOf, type MetricBands, type MetricSample, type MetricSeries } from "./series";
import { GUTTER_PX, MARGIN_PX, valueRange, type PlotFrame } from "./scale";

/** The height of one lane canvas (CSS px; the class `h-16` of MetricsGraph.vue) and the space around the plot. */
export const LANE_HEIGHT = 64;
const LANE_PAD = 4;

/** The verdict of the checks of a metric: the worst state of its checks. */
export type LaneVerdict = "fail" | "known" | "pass" | "none";

export interface GraphLane {
  readonly series: MetricSeries;
  readonly bands: MetricBands;
  readonly frame: PlotFrame;
  readonly verdict: LaneVerdict;
}

export interface GraphModel {
  readonly lanes: readonly GraphLane[];
  /** The checks of the take on the samples (`labs motion`), or null: a take without checks. */
  readonly report: LabCheckReport | null;
  readonly span: readonly [number, number];
}

const EMPTY_BANDS: MetricBands = { bands: [], limits: [] };

/** The plot frame of a lane of a width. */
export function laneFrame(width: number, span: readonly [number, number], range: [number, number]): PlotFrame {
  return {
    x0: GUTTER_PX,
    x1: Math.max(GUTTER_PX + 1, width - MARGIN_PX),
    y0: LANE_PAD,
    y1: LANE_HEIGHT - LANE_PAD,
    t0: span[0],
    t1: span[1],
    v0: range[0],
    v1: range[1],
  };
}

function verdictOf(report: LabCheckReport | null, metric: string): LaneVerdict {
  const rows = report?.worst.filter((row) => row.check.startsWith(metric)) ?? [];
  if (rows.length === 0) return "none";
  if (rows.some((row) => !row.pass && row.known === undefined)) return "fail";
  if (rows.some((row) => !row.pass)) return "known";
  return "pass";
}

/** The lanes of a take at a width: one lane for each metric with values. */
export function graphModel(
  take: string | null,
  samples: readonly MetricSample[],
  span: readonly [number, number],
  width: number,
): GraphModel {
  const checked = checkTake(take);
  const report = checked === null || samples.length === 0 ? null : checkReport(checked, samples);
  const lanes = seriesOf(samples).map((series): GraphLane => {
    const bands = checked === null ? EMPTY_BANDS : bandsOf(checked, series.metric);
    return {
      series,
      bands,
      frame: laneFrame(width, span, valueRange(series, bands)),
      verdict: verdictOf(report, series.metric),
    };
  });
  return { lanes, report, span };
}
