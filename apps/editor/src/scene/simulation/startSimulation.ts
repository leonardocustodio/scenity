// SPDX-License-Identifier: Apache-2.0
/**
 * The Simulation panel of the editor window: the states of the simulations from the dev core
 * of the page (`__scenity.simulations`), the time of the clock, and the recorded streams of the project.
 */
import type { StudioShell } from "../../studio/shell/shell";
import { devServerFiles } from "../projectWindow/projectFiles";
import type { SceneFilePort } from "../sceneFiles";
import SimulationPanel from "./SimulationPanel.vue";

/** Start the Simulation panel. */
export function startSimulation(shell: Pick<StudioShell, "setPanel">, project: string, files: SceneFilePort): void {
  shell.setPanel("simulation", {
    component: SimulationPanel,
    props: {
      states: () => globalThis.__scenity?.simulations?.() ?? Promise.resolve(null),
      time: () => globalThis.__scenity?.time?.() ?? 0,
      streams: async () => {
        const found = await devServerFiles(`/projects/${project}/`)
          .list()
          .catch(() => []);
        return found.map((file) => file.path).filter((path) => path.endsWith(".stream.jsonl"));
      },
      read: async (path: string) => (await files.read(path)).text,
    },
  });
}
