// SPDX-License-Identifier: Apache-2.0
/**
 * The measure tool: the distance between two points with the `distance` metric, in space and over the floor, and its
 * parts (the run over the floor and the rise). An end is a reference (an entity, a socket, a bone, a path point) or a
 * world point (a pick on the canvas). With no ends the tool takes the first two selected entities.
 */
import type { MetricContext, PointArg, Vec3 } from "@scenity/rules";
import {
  emptyShapes,
  entityRef,
  lengthText,
  middle,
  noInput,
  pointWords,
  refEntity,
  runMetric,
  type LayoutToolResult,
  type MeasureRequest,
} from "./shared";

/** The ends of a measure: the request, else the first two selected entities. */
function endsOf(request: MeasureRequest): [PointArg, PointArg] | null {
  const selected = (request.selection ?? []).map(entityRef);
  const from = request.from ?? selected[0];
  const to = request.to ?? (request.from === undefined ? selected[1] : selected[0]);
  return from === undefined || to === undefined ? null : [from, to];
}

export function measureTool(ctx: MetricContext, request: MeasureRequest): LayoutToolResult {
  const ends = endsOf(request);
  if (ends === null) {
    return noInput("measure", "Measure needs two ends: select two entities, or pick two points on the canvas.");
  }
  const [from, to] = ends;
  const a = ctx.point(from);
  const b = ctx.point(to);
  if (a === null || b === null) return noInput("measure", `No point for ${pointWords(a === null ? from : to)}.`);
  const space = runMetric(ctx, "distance", { from, to });
  const floor = runMetric(ctx, "distance", { from, to, plane: "floor" });
  const rise = Math.abs(b[1] - a[1]);
  const length = space.result?.value ?? 0;
  const run = floor.result?.value ?? 0;
  const shapes = emptyShapes();
  const corner: Vec3 = [b[0], a[1], b[2]];
  shapes.lines.push({ points: [a, b], tone: "measure" });
  shapes.lines.push({ points: [a, corner], tone: "part" }, { points: [corner, b], tone: "part" });
  shapes.dots.push({ at: a, tone: "measure" }, { at: b, tone: "measure" });
  shapes.labels.push({ at: middle(a, b), text: lengthText(length), tone: "measure" });
  const line = `${pointWords(from)} to ${pointWords(to)}: ${lengthText(length)} (floor ${lengthText(run)}, rise ${lengthText(rise)})`;
  const subjects = [refEntity(from), refEntity(to)].filter((id): id is string => id !== null);
  return { tool: "measure", ok: true, reason: null, subjects, metrics: [space, floor], lines: [line], overlay: shapes };
}
