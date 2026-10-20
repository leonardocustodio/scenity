// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime face of the demo plugin of the spin sample: the component `demo.spin`, its presenter, the
 * system that turns its entities and the input map of the play mode. `samples/spin/scenity.project.json`
 * lists the plugin, so the scene page, the scene worker and the player load it from the plugin module of their build.
 */
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { spinComponent } from "./component";
import { demoInput } from "./input";
import { spinPresenter } from "./presenter";
import { spinSystem } from "./systems/spin";

export default defineRuntimePlugin({
  id: "demo",
  components: [spinComponent],
  presenters: { "demo.spin": spinPresenter },
  systems: [spinSystem],
  // A click stops or starts the turn of a box, and the arrow keys change the speed.
  inputMap: demoInput,
});
