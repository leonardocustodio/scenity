// SPDX-License-Identifier: Apache-2.0
/**
 * The floor of the walks from a scene document: the `obstacle` components as floor rectangles, and the `standPoint`
 * components as places with a facing. `planPath` of path.ts goes around the rectangles, so the walks of a scene come
 * from its document and not from a kit in code.
 *
 * Each footprint becomes the floor rectangle (x, z) around it in the world frame: a `rect` footprint, the points of a
 * `polygon`, or the `bounds` of the entity. The bounds of a `shape` come from its size; the bounds of a model come from
 * the host (`bounds` of the options), because a pure module cannot load a model. A turned footprint gives the
 * rectangle around its turned corners, so no walk goes into the footprint.
 *
 * This module has no navigation grid (a nav mesh) for floors that rectangles do not fit.
 */
import { roundNumber } from "@scenity/scene/canonical";
import type { ObstacleValue, ShapeValue, StandPointValue } from "@scenity/scene/components";
import { childrenMap } from "@scenity/scene/hierarchy";
import { qrotate, transformPoint, type Vec3 } from "@scenity/scene/math";
import type { Entity } from "@scenity/scene/schema/entity";
import { worldTransform, type HasEntities } from "@scenity/scene/world";
import { planPath, type FloorPoint } from "./path";
import type { FloorRect } from "./place";

export interface FloorOptions {
  /** The obstacles of the entities with one of these tags do not block a walk (a plugin marks them). */
  readonly skipTags?: readonly string[];
  /** The floor rectangle of the model of an entity in the world frame, for the footprint `bounds`. */
  bounds?(entity: string): FloorRect | undefined;
}

/** A stand point of a scene: the entity, the place on the floor and the yaw of an actor there. */
export interface StandPlace {
  readonly entity: string;
  readonly at: FloorPoint;
  /** The yaw of an actor at the stand point: 0 faces +z, π/2 faces +x (the frame of `yawTo`). */
  readonly yaw: number;
  readonly role?: string;
}

/** The entity IDs in tree order: parents before children, the children in index order. */
export function treeOrder(scene: HasEntities): string[] {
  const map = childrenMap(scene.entities);
  const out: string[] = [];
  const visit = (id: string): void => {
    out.push(id);
    for (const child of map.get(id) ?? []) visit(child);
  };
  for (const root of map.get("") ?? []) visit(root);
  return out;
}

/** The floor rectangle around points of the frame of an entity, in the world frame, on the number grid. */
function rectAround(scene: HasEntities, id: string, points: readonly (readonly [number, number])[]): FloorRect {
  const matrix = worldTransform(scene, id)?.matrix;
  const world = points.map(([x, z]): Vec3 => (matrix === undefined ? [x, 0, z] : transformPoint(matrix, [x, 0, z])));
  const xs = world.map((point) => point[0]);
  const zs = world.map((point) => point[2]);
  const [minX, maxX, minZ, maxZ] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)].map(
    roundNumber,
  );
  return { minX, maxX, minZ, maxZ } as FloorRect;
}

/** The corners of a rectangle with a centre and a size (x, z). */
function corners(centre: readonly [number, number], size: readonly [number, number]): [number, number][] {
  const [x, z] = centre;
  const [halfX, halfZ] = [size[0] / 2, size[1] / 2];
  return [
    [x - halfX, z - halfZ],
    [x + halfX, z - halfZ],
    [x + halfX, z + halfZ],
    [x - halfX, z + halfZ],
  ];
}

/** The floor rectangle of the obstacle of one entity, or undefined when the footprint has no known size. */
function obstacleRect(scene: HasEntities, id: string, entity: Entity, options: FloorOptions): FloorRect | undefined {
  const footprint = (entity.components.obstacle as ObstacleValue | undefined)?.footprint ?? "bounds";
  if (footprint !== "bounds") {
    const points = footprint.kind === "rect" ? corners(footprint.centre ?? [0, 0], footprint.size) : footprint.points;
    return rectAround(scene, id, points);
  }
  const shape = entity.components.shape as ShapeValue | undefined;
  if (shape === undefined) return options.bounds?.(id);
  const [width, , depth] = shape.size ?? [1, 1, 1];
  // A cylinder and a sphere use X as the diameter; a plane and a box use X and Z.
  const round = shape.kind === "cylinder" || shape.kind === "sphere";
  return rectAround(scene, id, corners([0, 0], [width, round ? width : depth]));
}

/** The floor rectangle of the obstacle of an entity (the metrics name the entity of each rectangle). */
export interface FloorObstacle {
  readonly entity: string;
  readonly rect: FloorRect;
}

/**
 * The floor rectangles of the `obstacle` components of a scene with their entities, in tree order. An entity with a
 * skipped tag, and a `bounds` footprint with no size, give no rectangle.
 */
export function floorObstacleList(scene: HasEntities, options: FloorOptions = {}): FloorObstacle[] {
  const skip = options.skipTags ?? [];
  const out: FloorObstacle[] = [];
  for (const id of treeOrder(scene)) {
    const entity = scene.entities[id];
    if (entity?.components.obstacle === undefined) continue;
    if ((entity.tags ?? []).some((tag) => skip.includes(tag))) continue;
    const rect = obstacleRect(scene, id, entity, options);
    if (rect !== undefined) out.push({ entity: id, rect });
  }
  return out;
}

/** The floor rectangles of the `obstacle` components of a scene, in tree order (`floorObstacleList`). */
export function floorObstacles(scene: HasEntities, options: FloorOptions = {}): FloorRect[] {
  return floorObstacleList(scene, options).map((obstacle) => obstacle.rect);
}

/** The yaw of a world rotation about Y (0 faces +z). */
export function yawOfRotation(rotation: readonly [number, number, number, number]): number {
  const forward = qrotate(rotation as [number, number, number, number], [0, 0, 1]);
  return Math.atan2(forward[0], forward[2]);
}

/**
 * The stand point of an entity, or undefined. The `facing` of a stand point is a yaw where 0 faces -Z (as a camera),
 * so the yaw of an actor there is the facing plus π, plus the yaw of the entity.
 */
export function standPlace(scene: HasEntities, id: string): StandPlace | undefined {
  const value = scene.entities[id]?.components.standPoint as StandPointValue | undefined;
  const world = worldTransform(scene, id);
  if (value === undefined || world === undefined) return undefined;
  const yaw = yawOfRotation(world.rotation) + (value.facing ?? 0) + Math.PI;
  return {
    entity: id,
    at: [world.position[0], world.position[2]],
    yaw: Math.atan2(Math.sin(yaw), Math.cos(yaw)),
    ...(value.role === undefined ? {} : { role: value.role }),
  };
}

/** The stand points of a scene in tree order. */
export function standPlaces(scene: HasEntities): StandPlace[] {
  return treeOrder(scene).flatMap((id) => {
    const place = standPlace(scene, id);
    return place === undefined ? [] : [place];
  });
}

/** The shortest path from `from` to `to` around the obstacles of a scene (planPath over `floorObstacles`). */
export function scenePath(
  scene: HasEntities,
  from: FloorPoint,
  to: FloorPoint,
  options: FloorOptions = {},
): FloorPoint[] {
  return planPath(from, to, floorObstacles(scene, options));
}
