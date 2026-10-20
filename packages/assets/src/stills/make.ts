// SPDX-License-Identifier: Apache-2.0
/**
 * The make step of the asset stills. The caller gives a renderer: the editor draws the stills in a browser
 * page with a GPU, and a test gives a fake renderer. The step draws each missing or stale still (or each still with
 * `force`), writes `<stills>/<id>.webp` and its stamp, and removes the still files of IDs that have no still.
 */
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { planStills, STILL_SIZE, type StillJob, type StillMode, type StillPlanOptions, type StillsPlan } from "./plan";
import { readStillStamps, STILL_STAMP_FILE, writeStillStamps } from "./stamps";

/** One still for a renderer to draw. */
export interface StillRenderJob {
  readonly id: string;
  readonly kind: string;
  readonly mode: StillMode;
  /** The file to draw, relative to the project folder. */
  readonly input: string;
  readonly width: number;
  readonly height: number;
}

/** A renderer of stills. `open` runs before the first still and `close` after the last one. */
export interface StillRenderer {
  /** The version of the renderer: a change makes each still stale. */
  readonly version: string;
  open?(projectDir: string): Promise<void>;
  /** The bytes of the WebP image of a still. */
  render(job: StillRenderJob): Promise<Uint8Array>;
  close?(): Promise<void>;
}

export interface MakeStillsOptions extends Omit<StillPlanOptions, "renderer"> {
  /** Draw only these asset IDs (default: all). */
  readonly ids?: readonly string[];
  /** Draw the current stills too. */
  readonly force?: boolean;
  /** The day of the stamps (default: today). */
  readonly today?: Date;
  readonly log?: (line: string) => void;
}

/** The result of a make step. */
export interface MakeStillsReport {
  readonly plan: StillsPlan;
  /** The IDs of the stills that the renderer drew. */
  readonly made: readonly string[];
  /** The stills that the step could not draw, with the reason. */
  readonly failed: readonly { readonly id: string; readonly reason: string }[];
  /** The still files that the step removed, relative to the project folder. */
  readonly removed: readonly string[];
}

/** The jobs of a plan that the step draws. */
export function jobsToDraw(plan: StillsPlan, options: Pick<MakeStillsOptions, "ids" | "force">): StillJob[] {
  const chosen = plan.jobs.filter((job) => options.ids === undefined || options.ids.includes(job.id));
  return chosen.filter((job) => job.status !== "current" || options.force === true);
}

/** Draw the missing and stale stills of a project with a renderer. */
export async function makeStills(
  projectDir: string,
  renderer: StillRenderer,
  options: MakeStillsOptions = {},
): Promise<MakeStillsReport> {
  const plan = await planStills(projectDir, { ...options, renderer: renderer.version });
  const folder = join(plan.dir, plan.stillsDir);
  const stampPath = join(folder, STILL_STAMP_FILE);
  const stamps = readStillStamps(stampPath);
  const made: string[] = [];
  const failed: { id: string; reason: string }[] = [];
  const draw = jobsToDraw(plan, options);
  const day = (options.today ?? new Date()).toISOString().slice(0, 10);
  mkdirSync(folder, { recursive: true });
  let opened = false;
  try {
    for (const job of draw) {
      if (job.input === null) {
        failed.push({ id: job.id, reason: job.problem ?? "no file to draw" });
        continue;
      }
      if (!opened) {
        await renderer.open?.(plan.dir);
        opened = true;
      }
      try {
        const bytes = await renderer.render({ ...job, input: job.input, ...STILL_SIZE });
        writeFileSync(join(plan.dir, job.still), bytes);
        stamps[job.id] = { inputs: job.inputs, renderer: renderer.version, made: day };
        made.push(job.id);
        options.log?.(`${job.id} ${job.kind}: ${String(Math.round(bytes.byteLength / 1024))} KB`);
      } catch (error) {
        failed.push({ id: job.id, reason: error instanceof Error ? error.message : String(error) });
      }
    }
  } finally {
    if (opened) await renderer.close?.();
  }
  for (const path of plan.extra) rmSync(join(plan.dir, path), { force: true });
  const known = new Set(plan.jobs.map((job) => job.id));
  writeStillStamps(stampPath, Object.fromEntries(Object.entries(stamps).filter(([id]) => known.has(id))));
  return { plan, made, failed, removed: plan.extra };
}
