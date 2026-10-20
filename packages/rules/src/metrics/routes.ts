// SPDX-License-Identifier: Apache-2.0
/**
 * The metrics of a route: `walkway`, the narrowest clear width of a route between the floor obstacles, and
 * `routeClear`, the solids that come within a margin of a route. A route is the walk legs of an entity with a
 * `locomotion` component, the `path` component of an entity, a floor path between two points around the obstacles, or
 * a list of points.
 *
 * The width at a point is the free distance across the heading to each side, to the floor obstacles and the edges of
 * the room rectangle, at most `cap` to each side; 0 inside an obstacle. The parts of a route nearer than `skipEnds` to
 * its ends do not count: a stand place is near its table. The maths is the walkway of the layout checks of the first
 * plugin, and those checks use this metric.
 */
import { z } from "zod";
import type { FloorPoint } from "@scenity/character/path";
import type { FloorRect } from "@scenity/character/place";
import type { MetricContext } from "../context";
import { floorRectOf, insidePolygon, pointToBox, rayToPolygon, rectCorners, routeLength, toPolygon } from "../geometry";
import { defineMetric } from "../registry";
import type { Box, MetricItem, Vec3 } from "../types";
import { cm, floorRectArg, fromItems, notApplied, pointArg, vec3Arg } from "./common";

export const routeArg = z.union([
  /** The walk legs of an entity with a `locomotion` component (one leg by its index). */
  z.strictObject({ walk: z.string().min(1), leg: z.number().int().min(0).optional() }),
  /** The points of the `path` component of an entity. */
  z.strictObject({ path: z.string().min(1) }),
  /** The floor path between two points around the obstacles. */
  z.strictObject({ from: pointArg, to: pointArg }),
  z.strictObject({ points: z.array(vec3Arg).min(2) }),
]);
export type RouteArg = z.output<typeof routeArg>;

/** A route of a metric: its key and its points in the world frame. */
export interface Route {
  readonly key: string;
  readonly points: readonly Vec3[];
}

const onFloor = (path: readonly FloorPoint[]): Vec3[] => path.map(([x, z]) => [x, 0, z]);

/** The routes of a route argument. A part that does not resolve gives no route. */
export function routesOf(ctx: MetricContext, arg: RouteArg): Route[] {
  if ("walk" in arg) {
    const legs = ctx.walks(arg.walk).map((path, index) => ({ key: `${arg.walk} leg ${String(index)}`, path }));
    const chosen = arg.leg === undefined ? legs : legs.filter((_leg, index) => index === arg.leg);
    return chosen.filter((leg) => leg.path.length > 1).map((leg) => ({ key: leg.key, points: onFloor(leg.path) }));
  }
  if ("path" in arg) {
    const points = ctx.pathPoints(arg.path);
    return points === null ? [] : [{ key: arg.path, points }];
  }
  if ("from" in arg) {
    const from = ctx.point(arg.from);
    const to = ctx.point(arg.to);
    if (from === null || to === null) return [];
    const path = ctx.planPath([from[0], from[2]], [to[0], to[2]]);
    return [{ key: "path", points: onFloor(path) }];
  }
  return [{ key: "points", points: arg.points }];
}

/** The sample points of a route each `step` metres with their heading, without the parts near the ends. */
function routeSamples(route: Route, step: number, skip: number): { at: Vec3; heading: FloorPoint }[] {
  const total = routeLength(route.points);
  const out: { at: Vec3; heading: FloorPoint }[] = [];
  let run = 0;
  for (let index = 1; index < route.points.length; index += 1) {
    const a = route.points[index - 1] ?? [0, 0, 0];
    const b = route.points[index] ?? [0, 0, 0];
    const length = Math.hypot(b[0] - a[0], b[1] - a[1], b[2] - a[2]);
    if (length === 0) continue;
    const floor = Math.hypot(b[0] - a[0], b[2] - a[2]) || 1;
    const heading: FloorPoint = [(b[0] - a[0]) / floor, (b[2] - a[2]) / floor];
    for (let along = 0; along <= length; along += step) {
      const at = run + along;
      if (at < skip || at > total - skip) continue;
      const share = along / length;
      out.push({
        at: [a[0] + (b[0] - a[0]) * share, a[1] + (b[1] - a[1]) * share, a[2] + (b[2] - a[2]) * share],
        heading,
      });
    }
    run += length;
  }
  return out;
}

/** The free distance from a point along a direction to the edges of the room rectangle (at most `cap`). */
function toRoom(room: FloorRect | null, point: FloorPoint, direction: FloorPoint, cap: number): number {
  if (room === null) return cap;
  const limits: number[] = [];
  const [dx, dz] = direction;
  if (dx > 0) limits.push((room.maxX - point[0]) / dx);
  if (dx < 0) limits.push((room.minX - point[0]) / dx);
  if (dz > 0) limits.push((room.maxZ - point[1]) / dz);
  if (dz < 0) limits.push((room.minZ - point[1]) / dz);
  return Math.max(0, Math.min(cap, ...limits));
}

/** The free width across a heading at a point: the free distance to each side (0 inside a shape). */
export function widthAt(
  shapes: readonly (readonly FloorPoint[])[],
  room: FloorRect | null,
  point: FloorPoint,
  heading: FloorPoint,
  cap: number,
): number {
  if (shapes.some((shape) => insidePolygon(point, shape))) return 0;
  const side = (direction: FloorPoint): number => {
    let free = toRoom(room, point, direction, cap);
    for (const shape of shapes) {
      const hit = rayToPolygon(point, direction, shape);
      if (hit !== null) free = Math.min(free, hit);
    }
    return free;
  };
  return side([heading[1], -heading[0]]) + side([-heading[1], heading[0]]);
}

/** The room rectangle of an argument: a rectangle, or the floor box of an entity. */
function roomOf(ctx: MetricContext, room: FloorRect | string | undefined): FloorRect | null {
  if (room === undefined || typeof room !== "string") return room ?? null;
  const bounds = ctx.entity(room)?.bounds ?? null;
  return bounds === null ? null : floorRectOf(bounds);
}

export const walkway = defineMetric({
  id: "walkway",
  label: "Walkway width",
  unit: "m",
  worst: "min",
  args: z.strictObject({
    route: routeArg,
    /** The inside of the room: a floor rectangle, or the entity whose box is the floor. */
    room: z.union([floorRectArg, z.string().min(1)]).optional(),
    skipEnds: z.number().min(0).default(0.35),
    step: z.number().positive().default(0.05),
    /** The farthest a free width goes to each side (m). */
    cap: z.number().positive().default(2),
    /** The obstacles of these entities do not narrow the route. */
    ignore: z.array(z.string().min(1)).default([]),
  }),
  evaluate(ctx, args) {
    const room = roomOf(ctx, args.room);
    const shapes = ctx
      .obstacles()
      .filter((obstacle) => !args.ignore.includes(obstacle.entity))
      .map((obstacle) => rectCorners(obstacle.rect));
    const items: MetricItem[] = [];
    for (const route of routesOf(ctx, args.route)) {
      let best: { width: number; at: Vec3 } | null = null;
      for (const sample of routeSamples(route, args.step, args.skipEnds)) {
        const width = widthAt(shapes, room, [sample.at[0], sample.at[2]], sample.heading, args.cap);
        if (best === null || width < best.width) best = { width, at: sample.at };
      }
      if (best === null) continue;
      const where = `(${best.at[0].toFixed(2)}, ${best.at[2].toFixed(2)})`;
      items.push({ subject: route.key, value: best.width, detail: `${cm(best.width)} free at ${where}` });
    }
    return fromItems(items, "m", "min", "no route with a part between its ends");
  },
});

/** The solids of `routeClear`: the floor obstacles (floor distance) or the boxes of entities (distance in space). */
function solidsOf(
  ctx: MetricContext,
  solids: "obstacles" | readonly string[],
  ignore: readonly string[],
): { readonly id: string; distance(point: Vec3): number }[] {
  if (solids === "obstacles") {
    return ctx
      .obstacles()
      .filter((obstacle) => !ignore.includes(obstacle.entity))
      .map((obstacle) => {
        const corners = rectCorners(obstacle.rect);
        return { id: obstacle.entity, distance: (point: Vec3) => toPolygon([point[0], point[2]], corners) };
      });
  }
  return ctx.select(solids).flatMap((id) => {
    const bounds: Box | null = ctx.entity(id)?.bounds ?? null;
    if (bounds === null || ignore.includes(id)) return [];
    return [{ id, distance: (point: Vec3) => pointToBox(point, bounds) }];
  });
}

export const routeClear = defineMetric({
  id: "routeClear",
  label: "Route clear",
  unit: "count",
  worst: "max",
  args: z.strictObject({
    route: routeArg,
    /** A solid within this distance of the route counts (m). */
    margin: z.number().min(0).default(0),
    /** `obstacles`: the floor obstacles; else entities (a selector) and their boxes. */
    solids: z.union([z.literal("obstacles"), z.array(z.string().min(1)).min(1)]).default("obstacles"),
    skipEnds: z.number().min(0).default(0),
    step: z.number().positive().default(0.05),
    ignore: z.array(z.string().min(1)).default([]),
  }),
  evaluate(ctx, args) {
    const routes = routesOf(ctx, args.route);
    if (routes.length === 0) return notApplied("count", "no route");
    const near = new Map<string, number>();
    for (const route of routes) {
      const points = routeSamples(route, args.step, args.skipEnds).map((sample) => sample.at);
      for (const solid of solidsOf(ctx, args.solids, args.ignore)) {
        const clearance = Math.min(...points.map((point) => solid.distance(point)));
        near.set(solid.id, Math.min(near.get(solid.id) ?? Number.POSITIVE_INFINITY, clearance));
      }
    }
    const nearest = [...near].sort((a, b) => a[1] - b[1])[0];
    const items = [...near]
      .filter(([, clearance]) => clearance <= args.margin)
      .map(([id, clearance]) => ({ subject: id, value: clearance, detail: `${cm(clearance)} from the route` }));
    const words = nearest === undefined ? "no solid" : `the nearest solid is ${nearest[0]} at ${cm(nearest[1])}`;
    return {
      value: items.length,
      unit: "count",
      detail: `${String(items.length)} within ${cm(args.margin)}; ${words}`,
      items,
    };
  },
});
