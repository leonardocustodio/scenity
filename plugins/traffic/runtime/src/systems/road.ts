// SPDX-License-Identifier: Apache-2.0
/**
 * The system `traffic.road`. Its input is the projection of the traffic
 * simulation (simulation.ts) at the time of the step. The system has no memory: each output is a function of the
 * input and the scene, so a seek gives the frame of a play.
 *
 * - An entity with `traffic.vehicle` or `traffic.pedestrian` goes to the place of the car or the walker with its ID.
 *   While the simulation has no car or walker with that ID, the entity is hidden.
 * - An entity with `traffic.signal` is visible when the phase lights its lamp (`lit: true`) or does not (`lit: false`).
 * - With no input (no simulation in the core), the system changes nothing.
 */
import { defineSystem } from "@scenity/runtime/systems";
import type { SignalValue } from "../components";
import { litLamp } from "../signals";
import type { TrafficInput } from "../simulation";

export const roadSystem = defineSystem<TrafficInput | undefined>({
  id: "traffic.road",
  order: 0,
  reads: ["traffic.signal", "traffic.vehicle", "traffic.pedestrian"],
  update(ctx) {
    const input = ctx.input;
    if (input === undefined) return;
    const entities = ctx.frame.scene.entities;
    for (const id of Object.keys(entities).sort()) {
      const components = entities[id]?.components ?? {};
      const signal = components["traffic.signal"] as SignalValue | undefined;
      if (signal !== undefined) {
        const on = litLamp(signal.head, input.phase) === signal.lamp;
        ctx.out.setVisible(id, on === (signal.lit ?? true));
      }
      const places =
        components["traffic.vehicle"] !== undefined
          ? input.cars
          : components["traffic.pedestrian"] !== undefined
            ? input.walkers
            : null;
      if (places === null) continue;
      const place = places[id];
      if (place === undefined) {
        ctx.out.setVisible(id, false);
        continue;
      }
      ctx.out.setTransform(id, { position: place.position, rotation: place.rotation });
      ctx.out.setVisible(id, true);
    }
  },
});
