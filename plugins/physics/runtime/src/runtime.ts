// SPDX-License-Identifier: Apache-2.0
/**
 * The runtime face of the physics plugin: the components `physics.collider`, `physics.rigidBody` and
 * `physics.character`, the system `physics.world` (a Rapier world in fixed steps), the simulation of the `physics.*`
 * action keys, and the input map of the play mode keys. A project lists the package `@scenity/physics-runtime`. The
 * builds put it in a chunk of its own. The chunk holds the WASM of Rapier, so a project with no physics gets none of it.
 * Other systems cast rays through `@scenity/physics-runtime/queries`.
 */
import { defineRuntimePlugin } from "@scenity/runtime/definePlugin";
import { physicsComponents } from "./components";
import { physicsInput } from "./input";
import { physicsSimulation } from "./sim/simulation";
import { physicsSystem } from "./systems/physics";

export default defineRuntimePlugin({
  id: "physics",
  components: physicsComponents,
  systems: [physicsSystem],
  simulation: physicsSimulation,
  inputMap: physicsInput,
});
