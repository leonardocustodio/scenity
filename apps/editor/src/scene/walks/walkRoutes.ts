// SPDX-License-Identifier: Apache-2.0
/**
 * The routes of the walks of an actor. Each walk of its `locomotion` component goes from the previous place (the
 * actor, or the stand point of the previous walk) to its stand point. The route goes round the obstacles of the scene
 * (`scenePath` of `@scenity/character/navigation`, the routes of the runtime). A move of a stand point or of an
 * obstacle gives different routes. The footprint `bounds` of a model needs the bounds of the model. This pure module
 * does not have them, so such an obstacle does not bend a route here. The module has no DOM.
 */
import { scenePath, standPlace } from "@scenity/character/navigation";
import type { FloorPoint } from "@scenity/character/path";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";

/** The route of one walk: its index, its time, its stand point and the floor points (x, z) of the route. */
export interface WalkRoute {
  readonly index: number;
  readonly t: number;
  readonly to: string;
  readonly points: readonly FloorPoint[];
}

/** The walks of the `locomotion` of an entity (time and stand point ID), in their order. */
export function walksOf(scene: SceneDocument, actor: string): { t: number; to: string }[] {
  const value = scene.entities[actor]?.components.locomotion as { walks?: { t: number; to: string }[] } | undefined;
  return (value?.walks ?? []).flatMap((walk) =>
    walk.to.startsWith("entity:") ? [{ t: walk.t, to: walk.to.slice("entity:".length) }] : [],
  );
}

/** The routes of the walks of an actor. A walk to an entity with no stand point has no route. */
export function walkRoutes(scene: SceneDocument, actor: string): WalkRoute[] {
  const start = worldTransform(scene, actor);
  if (start === undefined) return [];
  let from: FloorPoint = [start.position[0], start.position[2]];
  return walksOf(scene, actor).flatMap((walk, index): WalkRoute[] => {
    const place = standPlace(scene, walk.to);
    if (place === undefined) return [];
    const points = scenePath(scene, from, place.at);
    from = place.at;
    return [{ index, t: walk.t, to: walk.to, points }];
  });
}
