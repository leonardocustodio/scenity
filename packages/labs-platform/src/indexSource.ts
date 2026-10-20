// SPDX-License-Identifier: Apache-2.0
/**
 * The source of the frame index: what a project or a plugin gives the index. The index
 * itself (the key, the store, the queue of the host, the fill of the lab page) knows no take, moment, content root or
 * pose family; a source gives them:
 *
 * - `content`: the files that a frame depends on, the asset manifest, the paths to leave out and the pose families of
 *   the family parts (contentHash.ts, contentParts.ts);
 * - `plans()`: the plans that the host fills with no page, in their order. A scene project gives one plan per sequence
 *   and per still scene (projectIndex.ts). The lab of a plugin gives none: the lab page plans its open take
 *   (`index.plan`), with the takes and the moments of the take model of its editor plugin.
 *
 * A plan gives the jobs of the index: each time (the steps of 100 ms and the moments), each view, each size, in that
 * order (`planJobs`). The queue of the host ranks them (packages/workbench-host `index/queue.ts`).
 *
 * The module is pure (no `node:`, `bun:` or DOM import).
 */
import type { ContentConfig } from "./contentHash";
import { frameKey, keyTime, type FrameKeyInput, type FrameView, type RendererBackend } from "./frameKey";

/** The step of the time line of a plan: 100 ms. */
export const PLAN_STEP_MS = 100;

/**
 * The input of the frames of one take or sequence: every input of `FrameKeyInput` but the time, the view and the
 * content hash, with the times and the views to index (`IndexTakePlan` of the host protocol).
 */
export interface IndexPlan {
  /** `take:<name>` or `track:<name>` (the lab), `sequence:<path>` or `scene:<path>` (a scene project). */
  readonly source: string;
  readonly events: readonly unknown[];
  readonly tunes: Readonly<Record<string, unknown>> | readonly unknown[];
  readonly renderer: Readonly<Record<string, unknown>>;
  readonly tier: string;
  readonly backend?: RendererBackend;
  readonly durationMs: number;
  /** The times of the named moments of the take, or the markers and key times of the sequence. */
  readonly moments: readonly number[];
  /** The views to index: the named cameras that the take uses, or the panes of the split screen. */
  readonly views: readonly FrameView[];
  /** The items of the content browser in this take: their windows make the strip of an open item. */
  readonly items?: readonly { readonly id: string; readonly from: number; readonly to: number }[];
  /** The documents of a frame of a scene project (`FrameKeyInput.scene`). */
  readonly scene?: FrameKeyInput["scene"];
}

/** What a project or a plugin gives the frame index. */
export interface FrameIndexSource {
  /** The files that a frame depends on and the pose families of the family parts. */
  readonly content: ContentConfig;
  /** The plans that the host fills with no page, in their order; none for a lab whose page plans its open take. */
  plans(): readonly IndexPlan[];
}

/** A source with only a content config: the lab page plans its open take. */
export function contentSource(content: ContentConfig): FrameIndexSource {
  return { content, plans: () => [] };
}

/** One time of a plan: a step of the time line or a named moment. */
export interface PlanTime {
  readonly time: number;
  readonly moment: boolean;
}

/** The times of a plan: every step of 100 ms (the 1 s steps are among them), then the moments that are not a step. */
export function planTimes(plan: Pick<IndexPlan, "durationMs" | "moments">): PlanTime[] {
  const times = new Map<number, boolean>();
  const end = Math.max(0, keyTime(plan.durationMs));
  for (let time = 0; time <= end; time += PLAN_STEP_MS) times.set(time, false);
  for (const moment of plan.moments) if (moment >= 0 && moment <= end) times.set(keyTime(moment), true);
  return [...times].map(([time, moment]) => ({ time, moment }));
}

/** The frame input of a plan at a time and a view. */
export function planInput(plan: IndexPlan, contentHash: string, timeMs: number, view: FrameView): FrameKeyInput {
  const { source, events, tunes, renderer, tier, backend, scene } = plan;
  return {
    source,
    events,
    timeMs,
    view,
    tunes,
    renderer,
    tier,
    contentHash,
    ...(backend ? { backend } : {}),
    ...(scene === undefined ? {} : { scene }),
  };
}

/** One job of a plan: the frame input, its key, the size, the moment flag and the items whose window holds the time. */
export interface PlanJob {
  readonly input: FrameKeyInput;
  readonly key: string;
  readonly size: number;
  readonly moment: boolean;
  readonly items: readonly string[];
}

/** The jobs of a plan in the order of the queue: each time, each view, each size. */
export function planJobs(plan: IndexPlan, contentHash: string, sizes: readonly number[]): PlanJob[] {
  const jobs: PlanJob[] = [];
  for (const { time, moment } of planTimes(plan)) {
    const items = (plan.items ?? []).filter((item) => time >= item.from && time <= item.to).map((item) => item.id);
    for (const view of plan.views) {
      const input = planInput(plan, contentHash, time, view);
      const key = frameKey(input);
      for (const size of sizes) jobs.push({ input, key, size, moment, items });
    }
  }
  return jobs;
}
