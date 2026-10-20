// SPDX-License-Identifier: Apache-2.0
/**
 * The motion checks of the editor. The plugin gives the checks of each take and their time spans. It also gives the
 * order of the metrics and of the members in the graph, and the report of the checks of a take on its samples
 * (`EditorPlugin.checks`, the rules of `labs motion`). The graph, the overview marks of the timeline and the script API
 * read them here.
 *
 * This module has no Vue import, because the tools and the tests read it. A function reads the plugin when it runs,
 * never when the module loads.
 */
import type { MetricName, MetricValue } from "../plugins";
import { editorPlugin } from "./plugin";

/** A motion check: a limit of a metric over a time range of a take. */
export interface MotionCheck {
  readonly metric: MetricName;
  /** A moment of the take or a time (ms). Absent: the time range of `during`, else the span of the take. */
  readonly at?: string | number;
  readonly during?: readonly [number, number];
  /** Only the values of this member (a member ID). */
  readonly member?: string;
  /** The worst value must be at most this (metres or degrees). */
  readonly max?: number;
  /** The worst value must be at least this (degrees: an angle at a joint). */
  readonly min?: number;
  /** The reason of a check that fails at this time, and the work that will repair it. */
  readonly known?: string;
}

/** A check that fails at the times: its worst value, its member, its limit and its time. */
export interface LabCheckFailure {
  /** The check as `labs motion` prints it, for example `ik.reachError (ada)` or `feet.belowFloor at press`. */
  readonly check: string;
  readonly metric: string;
  /** The member of the worst value (two members of an overlap: `a+b`). */
  readonly member: string | null;
  readonly value: number;
  /** The limit, for example `max 0.03` or `min 60`. */
  readonly limit: string;
  /** The time of the worst value (ms). */
  readonly at: number;
  /** The reason of a known gap (`MotionCheck.known`). */
  readonly known?: string;
}

/** The worst value of one check at the times (null: no value in its time range). */
export interface LabCheckWorst {
  readonly check: string;
  readonly limit: string;
  readonly value: number | null;
  readonly member: string | null;
  readonly at: number | null;
  readonly pass: boolean;
  readonly known?: string;
}

export interface LabCheckReport {
  /** False for a view track, the mock engine or a take without checks. `reason` gives the cause. */
  readonly applies: boolean;
  readonly reason?: string;
  /** The source of the views (`take`, `track:<name>`, `mock`). */
  readonly source: string;
  /** The take of the checks, or null. */
  readonly take: string | null;
  /** The times of the samples (ms). */
  readonly times: readonly number[];
  /** The events of the panel after the take. With events, the scene is not the plain take of `labs motion`. */
  readonly panelEvents: number;
  /** The checks that fail (`FAIL` of `labs motion`). */
  readonly failures: readonly LabCheckFailure[];
  /** The checks that fail with a known reason (`KNOWN` of `labs motion`). They do not count as failures. */
  readonly known: readonly LabCheckFailure[];
  /** The worst value of each check. */
  readonly worst: readonly LabCheckWorst[];
  /** One line: the counts of pass, fail and known, as `labs motion` prints them. */
  readonly summary: string;
}

/** The metrics at one time. */
export interface CheckSample {
  readonly at: number;
  readonly values: readonly MetricValue[];
}

/** The motion checks of a plugin. */
export interface EditorChecks {
  /** The checks of all takes, and the checks of each take by its name. */
  readonly common: readonly MotionCheck[];
  readonly byTake: Readonly<Record<string, readonly MotionCheck[]>>;
  /** The time span of the checks of each take (ms). */
  readonly spans: Readonly<Record<string, readonly [number, number]>>;
  /** The order of the metrics in the graph. */
  readonly metricOrder: readonly MetricName[];
  /** The members in the order of the colors of the graph (slots 1 to 4). */
  readonly memberOrder: readonly string[];
  /** The take of the checks of a lab take (no take: the take without events), or null for a take without checks. */
  takeOf(base: string | null): string | null;
  /** The report of the checks of a take on its samples (the verdicts of `labs motion`). */
  report(take: string, samples: readonly CheckSample[]): LabCheckReport;
}

const checks = (): EditorChecks => editorPlugin().checks;

export function checkTake(base: string | null): string | null {
  return checks().takeOf(base);
}

export function checkReport(take: string, samples: readonly CheckSample[]): LabCheckReport {
  return checks().report(take, samples);
}

/** The checks of a take: the common checks and the checks of the take. */
export function takeChecks(take: string): MotionCheck[] {
  return [...checks().common, ...(checks().byTake[take] ?? [])];
}

/** The time span of the checks of a take, or null for a take without a span. */
export function checkSpan(take: string): readonly [number, number] | null {
  return checks().spans[take] ?? null;
}

export function metricOrder(): readonly MetricName[] {
  return checks().metricOrder;
}

export function memberOrder(): readonly string[] {
  return checks().memberOrder;
}
