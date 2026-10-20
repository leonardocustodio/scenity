// SPDX-License-Identifier: Apache-2.0
/**
 * The samples of the metrics graph in the lab page. The source is the frame index of the lab page alone when it has
 * the metrics of the take of the page (its key input: index/frameInput.ts). Else the source is the update-only sweep
 * of the lab API (`measureAt`). The sweep moves the clock. After the sweep, the clock returns to its time. A running
 * clock goes to the time that it would have without the sweep. The data of one take stays until the take, its events
 * or the content hash changes.
 */
import { shallowRef, type ShallowRef } from "vue";
import { openBrowserIndex } from "../index/browserIndex";
import { contentHash } from "../index/contentHash";
import { labFrameInput, type LabKeyState } from "../index/frameInput";
import type { LabEvent, PresetName } from "../sequence";
import type { LabClock } from "../useLabClock";
import { loadGraph, type GraphData } from "./graphData";
import { samplesOfManifest, type MetricSample } from "./series";
import { t } from "../../texts";

export interface LabGraphParts {
  readonly clock: LabClock;
  readonly base: () => PresetName | null;
  readonly events: () => readonly LabEvent[];
  /** What the frames of the page depend on (the key of the index), or null: no index (a view track). */
  readonly keyState: () => LabKeyState | null;
}

export interface LabGraphData {
  readonly data: ShallowRef<GraphData | null>;
  readonly loading: ShallowRef<boolean>;
  /** The data of the current take: from the memory when nothing changed, else a new load (`force`: always load). */
  load(force?: boolean): Promise<GraphData>;
}

let browserIndex: ReturnType<typeof openBrowserIndex> | null = null;

/** The metrics of the take of the page in the index of the lab page alone, or null. */
async function indexSamples(state: LabKeyState): Promise<MetricSample[] | null> {
  browserIndex ??= openBrowserIndex().catch(() => null);
  const opened = await browserIndex;
  if (opened === null) return null;
  return samplesOfManifest(await opened.store.manifest(labFrameInput(state, 0, "overview", contentHash.value)));
}

export function useLabGraphData(parts: LabGraphParts): LabGraphData {
  const data = shallowRef<GraphData | null>(null);
  const loading = shallowRef(false);
  let key: readonly unknown[] = [];
  let pending: Promise<GraphData> | null = null;

  /** The metrics at the times through the lab API. The clock returns to its time after the sweep. */
  async function measureAt(times: number[]) {
    const api = globalThis.__room3dLab;
    if (api === undefined) throw new Error(t("graph-lab-not-ready"));
    const { clock } = parts;
    const at = clock.simNow();
    const wall = performance.now();
    const running = clock.running.value;
    try {
      return await api.measureAt(times);
    } finally {
      clock.seek(running ? at + (performance.now() - wall) * clock.speed.value : at);
    }
  }

  async function run(): Promise<GraphData> {
    const take = parts.base();
    const events = parts.events();
    const state = parts.keyState();
    loading.value = true;
    try {
      const next = await loadGraph({
        take,
        events,
        measureAt,
        index: state === null ? null : () => indexSamples(state),
      });
      data.value = next;
      return next;
    } finally {
      loading.value = false;
    }
  }

  return {
    data,
    loading,
    load(force = false) {
      const next = [parts.base(), parts.events(), contentHash.value];
      const same = next.length === key.length && next.every((value, index) => value === key[index]);
      if (!force && same && pending !== null) return pending;
      key = next;
      pending = run();
      return pending;
    },
  };
}
