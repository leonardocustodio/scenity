// SPDX-License-Identifier: Apache-2.0
/**
 * The system `probe.drop`: for each entity with a `probe.drop` component, it casts a downward ray from the source
 * entity and puts the entity on the hit point. The ray starts at the output place of the source in this frame (the
 * physics system runs first, `PHYSICS_ORDER`), else at its place in the document. The system has no memory.
 */
import { physicsQueries } from "@scenity/physics-runtime/queries";
import { defineSystem, type SystemDefinition } from "@scenity/runtime/systems";
import type { Vec3 } from "@scenity/scene/math";
import { worldTransform } from "@scenity/scene/world";
import { DEFAULT_LIFT, type DropValue } from "../component";

/** The longest ray, in metres. */
const MAX_DISTANCE = 50;
const DOWN: Vec3 = [0, -1, 0];

/** A new drop system for the core of a runner: the core gives the ray casts of its physics world. */
export function dropSystem(core?: unknown): SystemDefinition {
  return defineSystem({
    id: "probe.drop",
    order: 0,
    reads: ["probe.drop", "transform"],
    update(ctx) {
      const queries = physicsQueries(core);
      const scene = ctx.frame.scene;
      for (const id of Object.keys(scene.entities).sort()) {
        const value = scene.entities[id]?.components["probe.drop"] as DropValue | undefined;
        if (value === undefined) continue;
        // The source is a root entity, so its output position is a world position.
        const origin = ctx.out.get(value.source)?.transform?.position ?? worldTransform(scene, value.source)?.position;
        const hit =
          origin === undefined
            ? null
            : (queries?.castRay(origin, DOWN, MAX_DISTANCE, { exclude: value.source }) ?? null);
        ctx.out.setVisible(id, hit !== null);
        if (hit === null) continue;
        const [x, y, z] = hit.point;
        ctx.out.setTransform(id, { position: [x, y + (value.lift ?? DEFAULT_LIFT), z] });
      }
    },
  });
}
