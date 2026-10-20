// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime face of the test plugin of the inspector: one component and nothing else. The e2e test lists
 * this folder in the `plugins` field of a temporary copy of the showroom.
 */
import { defineRuntimePlugin } from "@scenity/runtime/plugins";
import { beaconComponent } from "./beacon";

export default defineRuntimePlugin({ id: "fixture", components: [beaconComponent] });
