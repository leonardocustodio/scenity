// SPDX-License-Identifier: Apache-2.0
/**
 * The renderer backend of the lab: the same chooser as the game, with the URL override `backend=webgpu|webgl` (lab
 * only) and no server switch. The renderer starts after the choice, thus the choice can select the renderer entry. The
 * frame statistics and the context packet of the workbench give the backend that runs and its reason.
 */
import { chooseBackend, type BackendChoice } from "@scenity/runtime/backend";
import { workerGpuProbe } from "@scenity/runtime/client";
import { shallowRef, type ShallowRef } from "vue";
import { gpuProbeUrl } from "../workerUrl";

export interface LabBackend {
  /** The choice, or null until the chooser makes it. */
  readonly choice: ShallowRef<BackendChoice | null>;
}

/** Start the choice immediately. `worker`: the renderer draws in a worker, thus the probe worker also checks it. */
export function useLabBackend(params: URLSearchParams, worker: boolean): LabBackend {
  const choice = shallowRef<BackendChoice | null>(null);
  void chooseBackend({
    override: params.get("backend"),
    workerProbe: worker ? workerGpuProbe(gpuProbeUrl) : null,
  }).then((made) => {
    choice.value = made;
  });
  return { choice };
}
