// SPDX-License-Identifier: Apache-2.0
/**
 * The input map of the demo plugin: the actions of the play mode. A click on an entity with `demo.spin` stops its
 * turn or starts it again. The up arrow doubles the speed of the turns, and the down arrow halves it. The
 * system `demo.spin` reads the events of each step (systems/spin.ts).
 */
import { defineInputMap } from "@scenity/runtime/inputMap";

export const demoInput = defineInputMap({
  keys: { "demo.faster": ["ArrowUp"], "demo.slower": ["ArrowDown"] },
  pointer: { "demo.toggle": { component: "demo.spin" } },
});
