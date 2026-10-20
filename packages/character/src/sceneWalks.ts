// SPDX-License-Identifier: Apache-2.0
/**
 * The walkers of a scene document: each entity with a `locomotion` component walks to the stand points of
 * its walks, around the `obstacle` components of the scene. The walk plan comes from the base scene (the start place,
 * the obstacles and the stand points), so a value that a sequence changes over time does not move a path. `withWalkers`
 * puts the transform of each walker at a time into a scene; the transform of the walker in that scene gives the height
 * and the scale. A transform track of the sequence on a walker has no effect: the walk sets the transform.
 */
import type { LocomotionValue } from "@scenity/scene/components";
import { qconjugate, qfromAxisAngle, qmul, qrotate, vsub, type Quat, type Vec3 } from "@scenity/scene/math";
import { parseRef } from "@scenity/scene/refs";
import type { Entity } from "@scenity/scene/schema/entity";
import { localTransform, worldTransform, type HasEntities } from "@scenity/scene/world";
import { floorObstacles, standPlace, treeOrder, yawOfRotation, type FloorOptions } from "./navigation";
import { planWalks, walkFrame, type WalkFrame, type WalkPlan, type WalkTarget } from "./walkPlan";

/** The values of a `locomotion` component with no stored value (LOCOMOTION_DEFAULTS of `@scenity/scene`). */
export const WALK_DEFAULTS: { readonly speed: number; readonly turnSpeed: number; readonly parameter: string } = {
  speed: 1,
  turnSpeed: 4,
  parameter: "speed",
};

/** One walker of a scene: the entity, its plan, the animator parameter of its walk speed and its world height. */
export interface SceneWalker {
  readonly entity: string;
  readonly plan: WalkPlan;
  readonly parameter: string;
  readonly height: number;
}

/** The walker of one entity, or undefined when the entity has no `locomotion` component. */
function walkerOf(scene: HasEntities, id: string, options: FloorOptions): SceneWalker | undefined {
  const value = scene.entities[id]?.components.locomotion as LocomotionValue | undefined;
  const world = worldTransform(scene, id);
  if (value === undefined || world === undefined) return undefined;
  const targets: WalkTarget[] = [];
  for (const walk of value.walks ?? []) {
    const ref = parseRef(walk.to);
    // A walk to an entity with no stand point has no target: the actor stays.
    const place = ref?.kind === "entity" ? standPlace(scene, ref.id) : undefined;
    if (place !== undefined) targets.push({ t: walk.t, at: place.at, yaw: place.yaw });
  }
  const start = { at: [world.position[0], world.position[2]] as const, yaw: yawOfRotation(world.rotation) };
  const speed = value.speed ?? WALK_DEFAULTS.speed;
  const turnSpeed = value.turnSpeed ?? WALK_DEFAULTS.turnSpeed;
  return {
    entity: id,
    plan: planWalks(start, targets, floorObstacles(scene, options), speed, turnSpeed),
    parameter: value.parameter ?? WALK_DEFAULTS.parameter,
    height: world.position[1],
  };
}

/** The walkers of a scene in tree order. */
export function sceneWalkers(scene: HasEntities, options: FloorOptions = {}): SceneWalker[] {
  return treeOrder(scene).flatMap((id) => {
    const walker = walkerOf(scene, id, options);
    return walker === undefined ? [] : [walker];
  });
}

/**
 * The local transform of a walker at a frame of its plan, in the frame of its parent in `scene`. The scale stays; the
 * rotation is a turn about the world Y axis. The parent must have a uniform scale.
 */
export function walkerTransform(
  scene: HasEntities,
  walker: SceneWalker,
  frame: WalkFrame,
): { position: Vec3; rotation: Quat; scale: Vec3 } {
  const entity = scene.entities[walker.entity];
  const local = entity === undefined ? undefined : localTransform(entity);
  const parent = entity?.parent === null || entity === undefined ? undefined : worldTransform(scene, entity.parent);
  const worldPosition: Vec3 = [frame.at[0], walker.height, frame.at[1]];
  const worldRotation = qfromAxisAngle([0, 1, 0], frame.yaw);
  const scale: Vec3 = local === undefined ? [1, 1, 1] : [...local.scale];
  if (parent === undefined) return { position: worldPosition, rotation: worldRotation, scale };
  const inverse = qconjugate(parent.rotation);
  const offset = qrotate(inverse, vsub(worldPosition, parent.position));
  const [sx, sy, sz] = parent.scale;
  return {
    position: [offset[0] / sx, offset[1] / sy, offset[2] / sz],
    rotation: qmul(inverse, worldRotation),
    scale,
  };
}

/** The scene with the transform of each walker at `t` (ms). The other entities keep their objects. */
export function withWalkers<Doc extends HasEntities>(scene: Doc, walkers: readonly SceneWalker[], t: number): Doc {
  if (walkers.length === 0) return scene;
  const entities: Record<string, Entity> = { ...scene.entities };
  for (const walker of walkers) {
    const entity = entities[walker.entity];
    if (entity === undefined) continue;
    const transform = walkerTransform(scene, walker, walkFrame(walker.plan, t));
    entities[walker.entity] = { ...entity, components: { ...entity.components, transform } };
  }
  return { ...scene, entities };
}
