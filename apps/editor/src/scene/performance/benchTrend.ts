// SPDX-License-Identifier: Apache-2.0
/**
 * The trend of the bench runner: the history of the reports of `scenity bench --json`
 * (`scenity.bench/1`), and for each value of the measure (the work, the frame time, the first frame, the draw calls,
 * the triangles) the value of each run of a backend, the oldest first. Pure functions, no DOM.
 */

/** The parts of a bench report that the panel reads. */
export interface BenchReportView {
  readonly date: string;
  readonly scene: string;
  readonly tier: string;
  readonly quick: boolean;
  readonly runs: readonly {
    readonly backend: string;
    readonly status: string;
    readonly note: string | null;
    readonly measure: Readonly<Record<string, unknown>> | null;
    readonly rows: readonly {
      readonly key: string;
      readonly limit: number;
      readonly value: number | null;
      readonly result: string;
    }[];
  }[];
  readonly verdict: { readonly passed: boolean; readonly reasons: readonly string[] };
}

/** The values of the trend, in the order of the panel. */
export const TREND_KEYS = ["workP95", "intervalP95", "firstFrameMs", "drawCalls", "triangles"] as const;
export type TrendKey = (typeof TREND_KEYS)[number];

/** One line of the trend: a value of a backend over the runs. */
export interface TrendLine {
  readonly key: TrendKey;
  readonly backend: string;
  /** The value of each run, the oldest first (null: the run gave no value). */
  readonly values: readonly (number | null)[];
  /** The budget of the value in the last run, or null. */
  readonly limit: number | null;
}

/** True when a value looks like a bench report. */
export function isBenchReport(value: unknown): value is BenchReportView {
  const report = value as Partial<BenchReportView> | null;
  return typeof report === "object" && report !== null && typeof report.date === "string" && Array.isArray(report.runs);
}

/** The trend lines of a history, for each backend of the runs and each trend value. */
export function trendLines(history: readonly BenchReportView[]): TrendLine[] {
  const backends = [...new Set(history.flatMap((report) => report.runs.map((run) => run.backend)))];
  const last = history.at(-1);
  return backends
    .flatMap((backend) =>
      TREND_KEYS.map((key) => {
        const values = history.map((report) => {
          const value = report.runs.find((run) => run.backend === backend)?.measure?.[key];
          return typeof value === "number" ? value : null;
        });
        const row = last?.runs.find((run) => run.backend === backend)?.rows.find((item) => item.key === key);
        return { key, backend, values, limit: row?.limit ?? null };
      }),
    )
    .filter((line) => line.values.some((value) => value !== null));
}

/** The points of a sparkline of the values (an SVG polyline of `width` by `height`); the limit sets the top too. */
export function sparkPoints(
  values: readonly (number | null)[],
  limit: number | null,
  width = 120,
  height = 28,
): string {
  const known = values.filter((value): value is number => value !== null);
  if (known.length === 0) return "";
  const top = Math.max(...known, limit ?? 0) || 1;
  const step = values.length > 1 ? width / (values.length - 1) : 0;
  return values
    .flatMap((value, index) =>
      value === null ? [] : [`${(index * step).toFixed(1)},${(height - (value / top) * height).toFixed(1)}`],
    )
    .join(" ");
}
