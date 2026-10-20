// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime face of the probe plugin of the physics sample: the component `probe.drop` and its system. The
 * system casts rays through the queries of the physics plugin, so the sample lists the physics plugin first.
 */
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { dropComponent } from "./component";
import { dropSystem } from "./systems/drop";

export default defineRuntimePlugin({
  id: "probe",
  components: [dropComponent],
  systems: [dropSystem],
});
