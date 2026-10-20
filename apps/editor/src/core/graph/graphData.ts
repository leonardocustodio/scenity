// SPDX-License-Identifier: Apache-2.0
/**
 * The samples of the metrics graph: the motion metrics of a take at each 100 ms across its span. The graph uses the
 * first source that has them:
 *
 * 1. the frame index: the metrics of the take manifest (`IndexFrame.metrics`), when an indexer kept them;
 * 2. the update-only sweep of the lab (`measureAt`: approximately 1 ms for each time, no render).
 *
 * The span is the span of the motion checks of the take (from the plugin). Else, it goes from 0 to 4 s after the last
 * event, with a minimum of 6 s.
 */
import { checkSpan, checkTake } from "../checks";
import { takeEnd, type LabEvent } from "../sequence";
import type { MetricSample } from "./series";
import type { MetricValue } from "../../plugins";
import { t } from "../../texts";

/** The step of the graph samples: the step of the strip and of the index. */
export const GRAPH_STEP_MS = 100;

/** The source of the samples. */
export type GraphSource = "index" | "sweep" | "link" | "none";

export interface GraphData {
  /** The take of the samples, or null (no take). */
  readonly take: string | null;
  readonly samples: readonly MetricSample[];
  readonly span: readonly [number, number];
  readonly source: GraphSource;
  /** The time to get the samples (ms). */
  readonly loadMs: number;
  readonly error: string | null;
}

/** The time range of the graph of a take. */
export function graphSpan(take: string | null, events: readonly LabEvent[]): readonly [number, number] {
  const checked = checkTake(take);
  const span = checked === null || take === null ? null : checkSpan(checked);
  if (span !== null) return span;
  return [0, Math.max(6_000, Math.ceil((takeEnd(events) + 4_000) / 1_000) * 1_000)];
}

/** The sample times of a span at a step. */
export function graphTimes(span: readonly [number, number], step: number = GRAPH_STEP_MS): number[] {
  const times: number[] = [];
  for (let at = span[0]; at <= span[1]; at += Math.max(10, step)) times.push(at);
  return times;
}

export interface GraphLoad {
  readonly take: string | null;
  readonly events: readonly LabEvent[];
  /** The metrics at each time (the lab API `measureAt`, the update-only sweep), or null without a lab. */
  readonly measureAt: ((times: number[]) => Promise<{ values: readonly MetricValue[] }[]>) | null;
  /** The samples of the frame index for the take, or null when the index has none. */
  readonly index?: (() => Promise<MetricSample[] | null>) | null;
  readonly now?: () => number;
}

function result(load: GraphLoad, span: readonly [number, number], start: number, rest: Partial<GraphData>): GraphData {
  const now = load.now ?? (() => performance.now());
  return {
    take: load.take,
    samples: [],
    span,
    source: "none",
    error: null,
    ...rest,
    loadMs: now() - start,
  };
}

/** The samples of a take: from the index when it has them, else from the sweep. */
export async function loadGraph(load: GraphLoad): Promise<GraphData> {
  const now = load.now ?? (() => performance.now());
  const start = now();
  const span = graphSpan(load.take, load.events);
  try {
    const indexed = (await load.index?.()) ?? null;
    if (indexed !== null && indexed.length > 0) {
      const inSpan = indexed.filter((sample) => sample.at >= span[0] && sample.at <= span[1]);
      if (inSpan.length > 1) return result(load, span, start, { samples: inSpan, source: "index" });
    }
    if (load.measureAt === null) {
      return result(load, span, start, { error: t("graph-no-source") });
    }
    const times = graphTimes(span);
    const measured = await load.measureAt(times);
    const samples = measured.map((item, index) => ({ at: times[index] ?? 0, values: item.values }));
    return result(load, span, start, { samples, source: "sweep" });
  } catch (error) {
    return result(load, span, start, { error: error instanceof Error ? error.message : String(error) });
  }
}
