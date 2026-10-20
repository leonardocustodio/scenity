// SPDX-License-Identifier: Apache-2.0
/**
 * The browser path of the frame index in the workbench page: the shadow frame of the lab takes the jobs of the host
 * queue at idle time.
 *
 * - The plan: after each change of the URL state of the visible lab (a take, events, a camera, tunes), the page asks
 *   the visible frame for the plan of its open take (`indexPlan`) and sends it to the host (`index.plan`).
 * - The jobs: one job per idle slot of this page (`startIdleRunner`). A slot has at most 4 ms of page work. The runner
 *   pauses while this page draws below 55 fps or the window is hidden. Before a job, the host starts or keeps the
 *   shadow frame (`index.shadow`). The shadow draws the job without a seek, and the page sends its bytes
 *   (indexJobs.ts).
 * - The readers: after each `index.progress` (at most once per second), the visible frame reads the open take again
 *   (`indexChanged`).
 *
 * The frames are the frames of the index surface: the first surface with the capability `index`. The scene page of a
 * project is also a surface with the bridge. Its shadow frame draws the jobs of the plans of the project (apps/editor
 * `src/scene/sceneIndex.ts`).
 */
import { startIdleRunner, type IdleRunner, type IdleState, type StepResult } from "@scenity/labs-platform/idle";
import { INDEX_CAPABILITY, surfaceWith, type IndexTakePlan } from "@scenity/workbench-host/protocol";
import { computed, getCurrentScope, onScopeDispose, ref, watch, type Ref } from "vue";
import type { HostApi } from "../host/useHost";
import type { SurfaceRelay } from "../surfaces/relay";
import { takeJob, type JobDeps } from "./indexJobs";

/** The quiet time after a change of the visible URL before a new plan (ms). */
export const PLAN_QUIET_MS = 1000;
/** The visible frame reads the index again at most this often (ms). */
export const CHANGED_GAP_MS = 1000;

export interface ShadowIndexer {
  readonly state: Ref<IdleState | "off">;
  readonly jobs: () => number;
  readonly slotTimes: () => readonly number[];
  stop(): void;
}

/** One idle step: no job without queued jobs or a ready shadow; else one job of the queue. */
async function step(deps: JobDeps, relay: SurfaceRelay): Promise<StepResult> {
  const status = await deps.request("index.status", {});
  if (status.queued === 0) return "idle";
  const { ready } = await deps.request("index.shadow", {});
  const surface = relay.idWith(INDEX_CAPABILITY);
  if (!ready || surface === null || !relay.has(surface, "shadow")) return "idle";
  const outcome = await takeJob(deps);
  return outcome === "none" ? "idle" : "more";
}

/** The idle runner of the jobs of the shadow frame. */
function startJobs(deps: JobDeps, relay: SurfaceRelay, state: Ref<IdleState | "off">): IdleRunner {
  return startIdleRunner({
    step: () => step(deps, relay).catch(() => "idle" as const),
    onState: (next) => {
      state.value = next;
    },
  });
}

/**
 * With `jobs: false` (the labs app with an indexer window), the page sends the plans and tells the readers. The
 * indexer window takes the jobs.
 */
export function useShadowIndexer(
  host: HostApi,
  relay: SurfaceRelay,
  options: { readonly jobs?: boolean } = {},
): ShadowIndexer {
  const state = ref<IdleState | "off">("off");
  const lab = computed(() => surfaceWith(host.surfaces.value, INDEX_CAPABILITY));
  /** A call into a frame of the index surface; it fails when the project has none. */
  const callIndex = (where: "visible" | "shadow", call: string, args: readonly unknown[], timeoutMs?: number) =>
    lab.value === null
      ? Promise.reject(new Error("The project has no index surface."))
      : relay.call(lab.value.id, where, call, args, timeoutMs);
  const deps: JobDeps = {
    request: (type, params) => host.request(type, params),
    sendIndexFrame: (job, mime, bytes) => {
      const client = host.client.value;
      if (client === null) throw new Error("The host is not connected.");
      client.sendIndexFrame(job, mime, bytes);
    },
    callFrame: (call, args, timeoutMs) => callIndex("shadow", call, args, timeoutMs),
    renderer: "shadow",
  };

  let planTimer: ReturnType<typeof setTimeout> | null = null;
  async function plan(): Promise<void> {
    planTimer = null;
    if (lab.value === null || !relay.has(lab.value.id, "visible")) return;
    try {
      const takes = (await callIndex("visible", "indexPlan", [])) as IndexTakePlan[];
      if (Array.isArray(takes) && takes.length > 0) await host.request("index.plan", { takes });
      runner?.wake();
    } catch {
      // A lab page without the index (an older checkout, the mock source): no plan.
    }
  }
  const stopUrl = watch(
    () => (lab.value?.server.status === "ready" ? lab.value.url : null),
    (url) => {
      if (url === null) return;
      if (planTimer !== null) clearTimeout(planTimer);
      planTimer = setTimeout(() => void plan(), PLAN_QUIET_MS);
    },
    { immediate: true },
  );

  let lastChanged = 0;
  let changedTimer: ReturnType<typeof setTimeout> | null = null;
  const tellChanged = (): void => {
    changedTimer = null;
    lastChanged = performance.now();
    void callIndex("visible", "indexChanged", []).catch(() => null);
  };
  const stopProgress = watch(
    host.client,
    (client, _old, onCleanup) => {
      const off = client?.on("index.progress", () => {
        if (changedTimer !== null) return;
        const wait = Math.max(0, CHANGED_GAP_MS - (performance.now() - lastChanged));
        changedTimer = setTimeout(tellChanged, wait);
      });
      onCleanup(() => off?.());
    },
    { immediate: true },
  );

  let runner: IdleRunner | null = options.jobs === false ? null : startJobs(deps, relay, state);

  function stop(): void {
    runner?.stop();
    runner = null;
    stopUrl();
    stopProgress();
    if (planTimer !== null) clearTimeout(planTimer);
    if (changedTimer !== null) clearTimeout(changedTimer);
    state.value = "off";
  }
  if (getCurrentScope() !== undefined) onScopeDispose(stop);
  return { state, jobs: () => runner?.jobs() ?? 0, slotTimes: () => runner?.slotTimes() ?? [], stop };
}
