// SPDX-License-Identifier: Apache-2.0
/**
 * The stills of the asset browser: the state of the still of each asset (the stills plan of the source), and the
 * "Make stills" command. "Make stills" draws the missing and stale stills in sequence in the page. A new import gets
 * its still the same way, with no command line.
 */
import { computed, ref, shallowRef } from "vue";
import { t } from "../texts";
import type { AssetSource } from "./assetClient";
import type { StillJobInfo, StillState } from "./assetTypes";

/** The state of the stills of one browser. `done` runs after the stills change (the browser reads its list again). */
export function useAssetStills(source: AssetSource, status: { value: string }, done: () => Promise<void>) {
  const jobs = shallowRef<readonly StillJobInfo[]>([]);
  const drawing = ref(0);
  /** It changes after each make step, so the tiles load their stills again. */
  const version = ref(0);
  const states = computed(() => new Map<string, StillState>(jobs.value.map((job) => [job.id, job.status])));
  /** The stills that the page can draw and that are not current. */
  const open = computed(() => jobs.value.filter((job) => job.status !== "current" && job.input !== null));

  async function read(): Promise<void> {
    jobs.value = (await source.stills?.()) ?? [];
  }

  /**
   * Draw the stills of the IDs (default: each still that is not current). `quiet`: the status line keeps its text
   * unless a still fails (the still of a new import follows the note of the import).
   */
  async function make(ids?: readonly string[], quiet = false): Promise<void> {
    if (source.makeStill === undefined) return;
    await read();
    const chosen = ids === undefined ? open.value : jobs.value.filter((job) => ids.includes(job.id));
    if (chosen.length === 0) return;
    drawing.value += 1;
    const failed: string[] = [];
    try {
      for (const [index, job] of chosen.entries()) {
        if (!quiet) status.value = t("assets-stills-drawing", { index: index + 1, count: chosen.length });
        const result = await source.makeStill(job);
        if (!result.ok) failed.push(`${job.id}: ${result.reason}`);
      }
    } finally {
      drawing.value -= 1;
      version.value += 1;
      if (failed.length > 0) {
        const note = t("assets-stills-failed", { reasons: failed.join("; ") });
        status.value = quiet && status.value !== "" ? `${status.value} · ${note}` : note;
      } else if (!quiet) status.value = t("assets-stills-made", { count: chosen.length });
    }
    await read();
    await done();
  }

  return { jobs, states, open, drawing, version, read, make };
}
