// SPDX-License-Identifier: Apache-2.0
/**
 * The values of the status bar of the editor window from the scene page. They are the save state (a press saves) and
 * the selection count (a press frames the selection). They also include the backend, the tier and the frame rate,
 * from a poll of the frame statistics (a press opens the Performance panel). The Problems panel gives the problem
 * counts (problems/startProblems.ts). The jobs (jobs/startJobs.ts) and the agent (agent/followView.ts) give their
 * items.
 */
import type { RuleResult } from "@scenity/rules";
import type { StudioShell } from "../studio/shell/shell";
import type { WindowStatus } from "../studio/shell/status";
import { t } from "../texts";

/** The wait between two polls of the frame statistics (ms). */
const STATS_MS = 2000;

/** The problem counts of rule results: a failed block rule, and a failed warning. */
export function problemCounts(results: readonly Pick<RuleResult, "level" | "status">[]): {
  fail: number;
  warn: number;
} {
  let fail = 0;
  let warn = 0;
  for (const result of results) {
    if (result.status !== "fail" && result.status !== "error") continue;
    if (result.level === "warn") warn += 1;
    else fail += 1;
  }
  return { fail, warn };
}

/** The frames per second of a frame interval (ms), or null with no frames. */
export function fpsOf(intervalMs: number | null | undefined): number | null {
  return intervalMs === null || intervalMs === undefined || intervalMs <= 0 ? null : Math.round(1000 / intervalMs);
}

/** The text of a save state for the status bar, and whether it is an error. */
export function saveStatus(text: string, dirty: boolean): { text: string; dirty: boolean; error: boolean } {
  const known = [t("scene-state-saved"), t("scene-state-unsaved"), t("scene-state-saving")];
  return { text, dirty, error: !known.includes(text) };
}

export interface StatusParts {
  readonly save: () => void;
  readonly selection?: {
    readonly ids: readonly string[];
    listen(listener: (ids: readonly string[]) => void): () => void;
  };
  readonly frame?: () => void;
  readonly stats?: () => Promise<{ readonly backend?: string; readonly tier: string; readonly intervalP50: number }>;
  readonly openPerformance?: () => void;
}

/** Fill the status bar of the shell from the page. The result stops the polls and the listeners. */
export function startStatus(
  shell: Pick<StudioShell, "showPanel"> & { status: WindowStatus },
  parts: StatusParts,
): () => void {
  const { status } = shell;
  const stops: (() => void)[] = [status.onPress("save", parts.save, "file.save")];
  if (parts.selection !== undefined) {
    status.set("selection", parts.selection.ids.length);
    stops.push(parts.selection.listen((ids) => status.set("selection", ids.length)));
    if (parts.frame !== undefined) stops.push(status.onPress("selection", parts.frame, "view.frame"));
  }
  if (parts.stats !== undefined) stops.push(pollStats(status, parts.stats));
  if (parts.openPerformance !== undefined)
    stops.push(status.onPress("render", parts.openPerformance, "panel.open.performance"));
  return () => {
    for (const stop of stops) stop();
  };
}

/** The backend, the tier and the frame rate of the core, a poll at a time. */
function pollStats(status: WindowStatus, stats: NonNullable<StatusParts["stats"]>): () => void {
  let stopped = false;
  const poll = async (): Promise<void> => {
    const value = await stats().catch(() => null);
    if (stopped) return;
    if (value !== null)
      status.set("render", { backend: value.backend ?? "webgl", tier: value.tier, fps: fpsOf(value.intervalP50) });
    setTimeout(() => void poll(), STATS_MS);
  };
  void poll();
  return () => {
    stopped = true;
  };
}
