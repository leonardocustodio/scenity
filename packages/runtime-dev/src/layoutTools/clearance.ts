// SPDX-License-Identifier: Apache-2.0
/**
 * The clearance tool: the gap between each chosen entity and its nearest neighbours, the `overlap` metric of the pairs
 * and, between two floor obstacles, the `walkway` metric through the gap.
 *
 * - **The neighbours** are the visible entities with a box, not in the subtree of the entity or above it, within
 *   `radius` (default 1.5 m), the nearest `count` (default 6) first. A support (a box under the entity, as the floor)
 *   and a load (a box on top of it) are not neighbours: they touch it by design.
 * - **The gap** is the distance between the boxes over the floor (default) or in space. A gap under `walkway`
 *   (default 0.6 m) is narrow; an overlap is red.
 * - **The walkway** between two obstacles is the free width across a short route through the middle of the gap, so the
 *   value counts the other obstacles too.
 */
import type { Box, MetricContext, Vec3 } from "@scenity/rules";
import {
  boxLines,
  emptyShapes,
  lengthText,
  middle,
  noInput,
  runMetric,
  type ClearanceRequest,
  type LayoutToolResult,
  type Shapes,
  type ToolMetric,
} from "./shared";

/** The defaults of the clearance tool (m). */
export const CLEARANCE_DEFAULTS = { radius: 1.5, count: 6, walkway: 0.6 } as const;

/** A support or a load touches the entity by design: 2 cm of play. */
const TOUCH = 0.02;
/** The height of a floor gap line over the floor (m). */
const FLOOR_LIFT = 0.02;

/** A neighbour of an entity: its gap, the nearest points of the two boxes and the overlap depth. */
export interface Neighbour {
  readonly id: string;
  readonly gap: number;
  readonly from: Vec3;
  readonly to: Vec3;
}

/** The nearest points of two intervals on one axis: the faces, or the middle of the common part. */
function nearestOnAxis(aMin: number, aMax: number, bMin: number, bMax: number): [number, number] {
  if (aMax < bMin) return [aMax, bMin];
  if (bMax < aMin) return [aMin, bMax];
  const mid = (Math.max(aMin, bMin) + Math.min(aMax, bMax)) / 2;
  return [mid, mid];
}

/** The gap between two boxes and their nearest points, over the floor (x, z) or in space. */
export function boxGap(a: Box, b: Box, plane: "floor" | "space"): { gap: number; from: Vec3; to: Vec3 } {
  const axes = [0, 1, 2].map((axis) =>
    nearestOnAxis(a.min[axis] ?? 0, a.max[axis] ?? 0, b.min[axis] ?? 0, b.max[axis] ?? 0),
  );
  const [x, y, z] = axes as [[number, number], [number, number], [number, number]];
  const flat = plane === "floor";
  const from: Vec3 = [x[0], flat ? FLOOR_LIFT : y[0], z[0]];
  const to: Vec3 = [x[1], flat ? FLOOR_LIFT : y[1], z[1]];
  const gap = Math.hypot(x[1] - x[0], flat ? 0 : y[1] - y[0], z[1] - z[0]);
  return { gap, from, to };
}

/** True when `other` is under the box of the entity (a support) or on top of it (a load) and their floor areas meet. */
function touches(box: Box, other: Box): boolean {
  const meet =
    other.min[0] < box.max[0] && other.max[0] > box.min[0] && other.min[2] < box.max[2] && other.max[2] > box.min[2];
  return meet && (other.max[1] <= box.min[1] + TOUCH || other.min[1] >= box.max[1] - TOUCH);
}

/** The nearest neighbours of an entity, nearest first. */
export function neighboursOf(
  ctx: MetricContext,
  id: string,
  options: { radius: number; count: number; plane: "floor" | "space"; skip: readonly string[] },
): Neighbour[] {
  const box = ctx.entity(id)?.bounds ?? null;
  if (box === null) return [];
  const out: Neighbour[] = [];
  for (const other of ctx.entities()) {
    const bounds = other.bounds;
    if (bounds === null || !other.visible || options.skip.includes(other.id)) continue;
    if (ctx.holds(id, other.id) || ctx.holds(other.id, id) || touches(box, bounds)) continue;
    const found = boxGap(box, bounds, options.plane);
    if (found.gap <= options.radius) out.push({ id: other.id, ...found });
  }
  return out.sort((a, b) => a.gap - b.gap || a.id.localeCompare(b.id)).slice(0, options.count);
}

/** The walkway metric through the gap of two floor obstacles: a short route across the middle of the gap. */
function gapWalkway(ctx: MetricContext, id: string, neighbour: Neighbour): ToolMetric | null {
  const owners = new Set(ctx.obstacles().map((obstacle) => obstacle.entity));
  if (!owners.has(id) || !owners.has(neighbour.id) || neighbour.gap <= 0) return null;
  const [dx, dz] = [neighbour.to[0] - neighbour.from[0], neighbour.to[2] - neighbour.from[2]];
  const length = Math.hypot(dx, dz) || 1;
  const across: [number, number] = [-dz / length, dx / length];
  const mid = middle(neighbour.from, neighbour.to);
  const step = 0.05;
  const points: Vec3[] = [
    [mid[0] - across[0] * step, 0, mid[2] - across[1] * step],
    [mid[0] + across[0] * step, 0, mid[2] + across[1] * step],
  ];
  return runMetric(ctx, "walkway", { route: { points }, skipEnds: 0, step });
}

/** The shapes and the line of one pair. */
function pairShapes(
  shapes: Shapes,
  id: string,
  neighbour: Neighbour,
  walkway: ToolMetric | null,
  narrow: number,
): string {
  const width = walkway?.result?.value ?? null;
  const tone = neighbour.gap <= 0 ? "blocked" : neighbour.gap < narrow ? "narrow" : "measure";
  shapes.lines.push({ points: [neighbour.from, neighbour.to], tone });
  shapes.dots.push({ at: neighbour.from, tone }, { at: neighbour.to, tone });
  const free = width === null ? "" : `, walkway ${lengthText(width)}`;
  const text =
    neighbour.gap <= 0 ? `${neighbour.id}: touch or overlap` : `${neighbour.id}: ${lengthText(neighbour.gap)}${free}`;
  shapes.labels.push({ at: middle(neighbour.from, neighbour.to), text, tone });
  return `${id} to ${text}`;
}

export function clearanceTool(ctx: MetricContext, request: ClearanceRequest): LayoutToolResult {
  const chosen = request.entities ?? request.selection ?? [];
  const entities = chosen.filter((id) => (ctx.entity(id)?.bounds ?? null) !== null);
  if (entities.length === 0) {
    const reason =
      chosen.length === 0 ? "Clearance needs an entity: select one or more." : `${chosen.join(", ")} has no box.`;
    return noInput("clearance", reason);
  }
  const plane = request.plane ?? "floor";
  const narrow = request.walkway ?? CLEARANCE_DEFAULTS.walkway;
  const options = {
    radius: request.radius ?? CLEARANCE_DEFAULTS.radius,
    count: request.count ?? CLEARANCE_DEFAULTS.count,
    plane,
    skip: entities,
  };
  const shapes = emptyShapes();
  const metrics: ToolMetric[] = [];
  const lines: string[] = [];
  const near = new Set<string>();
  for (const id of entities) {
    const box = ctx.entity(id)?.bounds;
    if (box !== undefined && box !== null) shapes.lines.push(...boxLines(box, "place"));
    const neighbours = neighboursOf(ctx, id, options);
    if (neighbours.length === 0) lines.push(`${id}: no neighbour within ${lengthText(options.radius)}`);
    for (const neighbour of neighbours) {
      near.add(neighbour.id);
      const walkway = gapWalkway(ctx, id, neighbour);
      if (walkway !== null) metrics.push(walkway);
      lines.push(pairShapes(shapes, id, neighbour, walkway, narrow));
    }
  }
  if (near.size > 0) {
    const mode = plane === "floor" ? "floor" : "bounds";
    metrics.unshift(runMetric(ctx, "overlap", { a: [...entities], b: [...near], mode, margin: 0.005 }));
  }
  const deepest = metrics[0]?.metric === "overlap" ? (metrics[0].result?.value ?? 0) : 0;
  if (deepest > 0) lines.unshift(`Overlap: ${metrics[0]?.result?.detail ?? lengthText(deepest)}`);
  const subjects = [...entities, ...[...near].filter((id) => !entities.includes(id))];
  return { tool: "clearance", ok: true, reason: null, subjects, metrics, lines, overlay: shapes };
}
