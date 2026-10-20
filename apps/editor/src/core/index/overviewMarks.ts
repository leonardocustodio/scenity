// SPDX-License-Identifier: Apache-2.0
/**
 * The marks of the overview strip: the times of the take where a motion check of the plugin fails. The marks come from
 * the metric values that the index keeps with each frame. The functions of `labs motion` (checks.ts `checkReport`)
 * check each time alone, thus the marks need no sweep and no seek. A known gap (a rule with `known`) is not a failure.
 * No Vue import.
 */
import type { MetricValue } from "../../plugins";
import { metricsList } from "@scenity/labs-platform/indexRead";
import { checkReport, checkTake } from "../checks";

/** A frame of the overview: its time and the metric values of the index, or null. */
export interface OverviewSample {
  readonly timeMs: number;
  readonly metrics: Readonly<Record<string, number>> | null;
}

/** A failing time: the time and the checks that fail there. */
export interface FailingMark {
  readonly timeMs: number;
  readonly checks: readonly string[];
}

/** The metric values of a frame of the index as the samples of `labs motion`. */
export function sampleValues(metrics: Readonly<Record<string, number>> | null): MetricValue[] {
  return metricsList(metrics).map((item) => ({
    metric: item.metric as MetricValue["metric"],
    member: item.member === "scene" ? null : item.member,
    value: item.value,
    unit: item.unit === "deg" ? "deg" : "m",
  }));
}

/** The times of a take where a check fails, from the metrics of its frames in the index. Empty without checks. */
export function failingMarks(take: string | null, samples: readonly OverviewSample[]): FailingMark[] {
  const checked = checkTake(take);
  if (checked === null) return [];
  const marks: FailingMark[] = [];
  for (const sample of samples) {
    if (sample.metrics === null) continue;
    const report = checkReport(checked, [{ at: sample.timeMs, values: sampleValues(sample.metrics) }]);
    if (report.failures.length > 0) {
      marks.push({ timeMs: sample.timeMs, checks: report.failures.map((failure) => failure.check) });
    }
  }
  return marks;
}
