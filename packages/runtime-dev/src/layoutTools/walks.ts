// SPDX-License-Identifier: Apache-2.0
/**
 * The walk tool: the planned walk paths of the entities with a `locomotion` component (the generic walk plan of
 * `@scenity/character`, around the `obstacle` components to the stand points), with the `routeClear` and `walkway`
 * metrics of each leg. A scene with no walker gives the floor path between two selected entities (or two points) around
 * the obstacles.
 *
 * - A leg with a solid nearer than `margin` (default 0.1 m) is red; a leg narrower than `walkway` (default 0.6 m) is
 *   yellow. The parts of a route near its ends do not count (the default of the metrics): a stand point is near its
 *   table.
 */
import type { LocomotionValue } from "@scenity/scene/components";
import type { MetricContext, PointArg, Vec3 } from "@scenity/rules";
import {
  emptyShapes,
  entityRef,
  lengthText,
  noInput,
  pointWords,
  runMetric,
  type LayoutToolResult,
  type Shapes,
  type ToolMetric,
  type WalkRequest,
} from "./shared";

/** The defaults of the walk tool (m). */
export const WALK_TOOL_DEFAULTS = { margin: 0.1, walkway: 0.6 } as const;

/** The height of a path line over the floor (m). */
const LIFT = 0.02;
/** The parts of a route near its ends that do not count (m): the default of the walkway metric. */
const SKIP_ENDS = 0.35;

const lifted = (points: readonly Vec3[]): Vec3[] => points.map(([x, , z]) => [x, LIFT, z]);

/** The length of a polyline. */
function lengthOf(points: readonly Vec3[]): number {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const [a, b] = [points[index - 1], points[index]];
    if (a !== undefined && b !== undefined) total += Math.hypot(b[0] - a[0], b[2] - a[2]);
  }
  return total;
}

/** The entities of the scene with a `locomotion` component, in the order of the facts. */
function walkersOf(ctx: MetricContext): string[] {
  return ctx.entities().flatMap((entity) => {
    const value = ctx.scene?.entities[entity.id]?.components.locomotion as LocomotionValue | undefined;
    return value === undefined ? [] : [entity.id];
  });
}

/** The shapes, the metrics and the line of one route. */
function routeOf(
  ctx: MetricContext,
  shapes: Shapes,
  route: { readonly key: string; readonly arg: unknown; readonly points: readonly Vec3[] },
  limits: { readonly margin: number; readonly walkway: number },
): { metrics: ToolMetric[]; line: string } {
  const clear = runMetric(ctx, "routeClear", { route: route.arg, margin: limits.margin, skipEnds: SKIP_ENDS });
  const width = runMetric(ctx, "walkway", { route: route.arg, skipEnds: SKIP_ENDS });
  const near = clear.result?.value ?? 0;
  const free = width.result?.value ?? null;
  const tone = near > 0 ? "blocked" : free !== null && free < limits.walkway ? "narrow" : "walk";
  const points = lifted(route.points);
  const [first, last] = [points[0], points[points.length - 1]];
  shapes.lines.push({ points, tone });
  if (first !== undefined) shapes.dots.push({ at: first, tone: "place" });
  if (last !== undefined) shapes.dots.push({ at: last, tone: "place" });
  const words = [
    `${lengthText(lengthOf(points))} long`,
    free === null ? "no part to measure between the ends" : `${lengthText(free)} free`,
    near > 0 ? (clear.result?.detail ?? `${String(near)} solids near`) : `no solid within ${lengthText(limits.margin)}`,
  ];
  if (last !== undefined) shapes.labels.push({ at: last, text: `${route.key}: ${words[1] ?? ""}`, tone });
  return { metrics: [clear, width], line: `${route.key}: ${words.join(", ")}` };
}

/** The floor path between two ends around the obstacles, for a scene with no walker. */
function pathTool(ctx: MetricContext, from: PointArg, to: PointArg, limits: { margin: number; walkway: number }) {
  const a = ctx.point(from);
  const b = ctx.point(to);
  if (a === null || b === null) return noInput("walk", `No point for ${pointWords(a === null ? from : to)}.`);
  const plan = ctx.planPath([a[0], a[2]], [b[0], b[2]]).map(([x, z]): Vec3 => [x, 0, z]);
  const shapes = emptyShapes();
  const key = `path ${pointWords(from)} to ${pointWords(to)}`;
  const made = routeOf(ctx, shapes, { key, arg: { from, to }, points: plan }, limits);
  return {
    tool: "walk",
    ok: true,
    reason: null,
    subjects: [],
    metrics: made.metrics,
    lines: [made.line],
    overlay: shapes,
  } as const;
}

export function walkTool(ctx: MetricContext, request: WalkRequest): LayoutToolResult {
  const limits = {
    margin: request.margin ?? WALK_TOOL_DEFAULTS.margin,
    walkway: request.walkway ?? WALK_TOOL_DEFAULTS.walkway,
  };
  const all = walkersOf(ctx);
  const selected = request.selection ?? [];
  const chosen = request.entities ?? selected.filter((id) => all.includes(id));
  const walkers = chosen.length > 0 ? chosen : selected.length === 0 ? all : [];
  if (walkers.length === 0) {
    const from = request.from ?? (selected[0] === undefined ? undefined : entityRef(selected[0]));
    const to = request.to ?? (selected[1] === undefined ? undefined : entityRef(selected[1]));
    if (from !== undefined && to !== undefined) return pathTool(ctx, from, to, limits);
    const reason =
      all.length === 0
        ? "Walk needs an entity with a locomotion component, or two entities for a path around the obstacles."
        : `No selected entity has a locomotion component (the walkers: ${all.join(", ")}).`;
    return noInput("walk", reason);
  }
  const shapes = emptyShapes();
  const metrics: ToolMetric[] = [];
  const lines: string[] = [];
  for (const id of walkers) {
    const legs = ctx.walks(id).filter((path) => path.length > 1);
    if (legs.length === 0) lines.push(`${id}: no walk to a stand point`);
    legs.forEach((path, leg) => {
      const points = path.map(([x, z]): Vec3 => [x, 0, z]);
      const made = routeOf(ctx, shapes, { key: `${id} leg ${String(leg)}`, arg: { walk: id, leg }, points }, limits);
      metrics.push(...made.metrics);
      lines.push(made.line);
    });
  }
  return { tool: "walk", ok: true, reason: null, subjects: walkers, metrics, lines, overlay: shapes };
}
