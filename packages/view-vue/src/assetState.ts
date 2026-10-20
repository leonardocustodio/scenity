// SPDX-License-Identifier: Apache-2.0
/**
 * The asset state of the renderer in SceneView: the fog over the scene while the files load, and the data attributes
 * for the tests. An event of the renderer gives the state
 * after the frame that shows the assets. A renderer without the event gets a read once a second until the assets
 * settle.
 */
import type { SceneClient } from "@scenity/runtime/client";
import type { AssetReport, SceneStats } from "@scenity/runtime/protocol";
import { onBeforeUnmount, onMounted, ref, type Ref, type ShallowRef } from "vue";

/** The asset state of the renderer and the calls of the view. */
export interface AssetState {
  readonly state: Ref<SceneStats["assets"]>;
  /** True after the first statistics of the renderer: before them the state of the files is not known. */
  readonly reported: Ref<boolean>;
  /** The asset event of the renderer: the first event stops the poll. */
  readonly onAssets: (report: AssetReport) => void;
  /** Start the reads again: a new renderer (the main-thread core after a failure of the worker) loads again. */
  readonly watchAssets: () => void;
}

/** The asset state of the renderer. `show` gets each new report (the host reads its own load keys from it). */
export function useAssetState<Input>(
  renderer: ShallowRef<SceneClient<Input> | null>,
  show: (report: AssetReport) => void,
): AssetState {
  const state = ref<SceneStats["assets"]>("none");
  const reported = ref(false);
  let assetTimer: ReturnType<typeof setInterval> | null = null;

  function showAssets(report: AssetReport): void {
    state.value = report.assets;
    reported.value = true;
    show(report);
  }

  function onAssets(report: AssetReport): void {
    if (assetTimer !== null) clearInterval(assetTimer);
    assetTimer = null;
    showAssets(report);
  }

  // The read does not reset the frame window of the statistics.
  function watchAssets(): void {
    if (assetTimer !== null) clearInterval(assetTimer);
    const timer = setInterval(() => {
      const made = renderer.value;
      if (made === null) return;
      void made.stats(false).then((current) => {
        // A renderer that the view replaced (a failed worker) answers with empty statistics; the event stops the poll.
        if (renderer.value !== made || assetTimer !== timer) return;
        showAssets(current);
        if (current.assets !== "loading") {
          clearInterval(timer);
          if (assetTimer === timer) assetTimer = null;
        }
      });
    }, 1000);
    assetTimer = timer;
  }

  onMounted(watchAssets);
  onBeforeUnmount(() => {
    if (assetTimer !== null) clearInterval(assetTimer);
  });

  return { state, reported, onAssets, watchAssets };
}
