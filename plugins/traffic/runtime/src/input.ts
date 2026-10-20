// SPDX-License-Identifier: Apache-2.0
/**
 * The input map of the traffic plugin: in the play mode, the space bar,
 * the B key or a click on the entity with `traffic.button` presses the button of the crossing. The document core
 * gives the events to the simulation as `traffic.button` action keys (simulation.ts), so a recorded session replays
 * to the same frames.
 */
import { defineInputMap } from "@scenity/runtime/inputMap";

export const trafficInput = defineInputMap({
  keys: { "traffic.button": ["Space", "KeyB"] },
  pointer: { "traffic.button": { component: "traffic.button" } },
});
