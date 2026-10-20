// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime face of the traffic plugin: the simulation of a road with a
 * pedestrian crossing (simulation.ts), its components, the system `traffic.road` that puts the cars, the walkers and
 * the signal lamps in the scene, and the input map of the button in the play mode. The sample `samples/sim-road` lists
 * the package `@scenity/traffic-runtime`. The builds put it in a chunk of its own.
 */
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { trafficComponents } from "./components";
import { trafficInput } from "./input";
import { trafficSimulation } from "./simulation";
import { roadSystem } from "./systems/road";

export default defineRuntimePlugin({
  id: "traffic",
  components: trafficComponents,
  systems: [roadSystem],
  simulation: trafficSimulation,
  inputMap: trafficInput,
});
