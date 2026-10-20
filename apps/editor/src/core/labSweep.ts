// SPDX-License-Identifier: Apache-2.0
/**
 * The sweeps of the lab API: the inspect report at many times. The default path is the update-only sweep of the labs
 * core. The page makes the scene input of each time (sweepInput.ts). The core updates the scene at each time without a
 * render and gives all the reports in one answer. The rendered path (`{ render: true }`) seeks the clock and waits for
 * a drawn frame at each time. The two paths give the same reports. After each path, the clock stays at the last time.
 */
import type { InspectReport, SceneInput } from "../plugins";
import type { LaneSample } from "./lanes";
import type { ViewHandle } from "./useLabStats";

/** The options of a sweep of the lab API. */
export interface SweepOptions {
  /** Draw a frame at each time (the rendered path), not the update-only sweep. */
  readonly render?: boolean;
}

/** One time of a sweep: the simulation time of the report and the report (null without the labs renderer). */
export interface SweepReport {
  readonly simMs: number | null;
  readonly report: InspectReport | null;
}

/** What a sweep needs of the lab page. */
export interface SweepParts {
  readonly view: () => ViewHandle | null;
  /** The scene input at a time, or null when the lab cannot make it (a live session of the mock engine). */
  readonly inputAt: ((at: number) => SceneInput) | null;
  /** Seek the clock to a time and give the scene the lab state of that time. */
  readonly seek: (at: number) => void;
  /** Wait for a frame at the time of the clock. The result is the time of the drawn frame. */
  readonly drawn: () => Promise<number | null>;
}

/** The times of a sweep from `from` to `to` at `step` (at least 10 ms). */
export function sweepTimes(from: number, to: number, step: number): number[] {
  const times: number[] = [];
  for (let at = from; at <= to; at += Math.max(10, step)) times.push(at);
  return times;
}

/** The catalog clip and the family of each member that shows in a report (a sample of the clip lanes). */
export function laneSample(at: number, report: InspectReport | null): LaneSample {
  const members = (report?.members ?? [])
    .filter((member) => member.visible)
    .map((member) => ({ id: member.id, clip: member.clip, family: member.family, layers: member.layers }));
  // The other people of the scene have lanes too.
  const people = (report?.people ?? []).map((person) => ({ ...person, family: "person" }));
  return { at, members: [...members, ...people] };
}

/** The rendered path: a seek, a drawn frame and its report at each time. */
async function renderedReports(parts: SweepParts, times: readonly number[]): Promise<SweepReport[]> {
  const out: SweepReport[] = [];
  for (const at of times) {
    parts.seek(at);
    const simMs = await parts.drawn();
    const report = (await parts.view()?.inspect()) ?? null;
    out.push({ simMs, report });
  }
  return out;
}

/**
 * The inspect report at each time from the update-only sweep of the labs core. The rendered path occurs with
 * `render`, when the view has no sweep (the runtime renderer, `runtime=1`), or when the lab cannot make the inputs. It
 * also occurs when the sweep gives no reports. The clock stays at the last time.
 */
export async function reportsAt(
  parts: SweepParts,
  times: readonly number[],
  options: SweepOptions = {},
): Promise<SweepReport[]> {
  const view = parts.view();
  const inputAt = parts.inputAt;
  if (options.render !== true && view?.sweep !== undefined && inputAt !== null && times.length > 0) {
    const reports = await view.sweep(times.map((at) => ({ simMs: at, input: inputAt(at) })));
    if (reports !== null && reports.length === times.length) {
      const last = times.at(-1);
      if (last !== undefined) parts.seek(last);
      return reports.map((report) => ({ simMs: report.simMs, report }));
    }
  }
  return renderedReports(parts, times);
}
