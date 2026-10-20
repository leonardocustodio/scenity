// SPDX-License-Identifier: Apache-2.0
/**
 * The metric `visible`: the share of a rectangle that an eye sees. The rectangle has a middle point, a width
 * and a height in the X-Y plane of a frame entity, and it faces the +Z axis of that entity (a screen faces +Z of its
 * prop). The metric samples a grid of points on the rectangle (2 × 2: the 4 corners) and tests the segment from the
 * eye to each point against the occluders: the boxes of the entities, or their meshes when the host can hit them.
 *
 * - A rectangle that faces away from the eye has the value 0.
 * - The frame entity, the entity of the eye and their subtrees do not block; nor do the entities of `ignore`.
 * - A box is smaller by `margin` on each side: a coarse box does not block near its faces.
 */
import { z } from "zod";
import type { MetricContext } from "../context";
import { rotate } from "../geometry";
import { defineMetric } from "../registry";
import type { Quat, Vec3 } from "../types";
import { notApplied, pointArg } from "./common";

const IDENTITY: Quat = [0, 0, 0, 1];

/** The entity ID of a reference, or null for a world point. */
function entityOf(at: string | Vec3): string | null {
  if (typeof at !== "string") return null;
  const rest = at.slice("entity:".length);
  const hash = rest.indexOf("#");
  return hash < 0 ? rest : rest.slice(0, hash);
}

/**
 * The world points of a grid of `count` × `count` points on a rectangle (the corners for 2). The layout tool of the
 * visibility draws the same points.
 */
export function gridPoints(centre: Vec3, rotation: Quat, size: readonly [number, number], count: number): Vec3[] {
  const right = rotate(rotation, [1, 0, 0]);
  const up = rotate(rotation, [0, 1, 0]);
  const out: Vec3[] = [];
  for (let row = 0; row < count; row += 1) {
    for (let column = 0; column < count; column += 1) {
      const x = (column / (count - 1) - 0.5) * size[0];
      const y = (row / (count - 1) - 0.5) * size[1];
      out.push([
        centre[0] + right[0] * x + up[0] * y,
        centre[1] + right[1] * x + up[1] * y,
        centre[2] + right[2] * x + up[2] * y,
      ]);
    }
  }
  return out;
}

/** The rotation of the frame entity, or the world axes. */
function frameRotation(ctx: MetricContext, frame: string | null): Quat | null {
  if (frame === null) return IDENTITY;
  return ctx.entity(frame)?.transform.rotation ?? null;
}

export const visible = defineMetric({
  id: "visible",
  label: "Visible share",
  unit: "share",
  worst: "min",
  args: z.strictObject({
    /** The eye point (a camera entity, a head bone, a point). */
    eye: pointArg,
    /** The middle of the rectangle. */
    at: pointArg,
    /** The width and the height of the rectangle (m). */
    size: z.tuple([z.number().positive(), z.number().positive()]),
    /** The entity whose axes the rectangle has. Default: the entity of `at`, else the world axes. */
    frame: z.string().min(1).optional(),
    /** The points per side of the sample grid (2: the corners). */
    grid: z.number().int().min(2).max(16).default(2),
    occluders: z.enum(["bounds", "meshes"]).default("bounds"),
    ignore: z.array(z.string().min(1)).default([]),
    margin: z.number().min(0).default(0.01),
  }),
  evaluate(ctx, args) {
    const eye = ctx.point(args.eye);
    const centre = ctx.point(args.at);
    const frame = args.frame ?? entityOf(args.at);
    const rotation = frameRotation(ctx, frame);
    if (eye === null || centre === null || rotation === null) return notApplied("share", "no eye or no rectangle");
    const normal = rotate(rotation, [0, 0, 1]);
    const toEye: Vec3 = [eye[0] - centre[0], eye[1] - centre[1], eye[2] - centre[2]];
    if (normal[0] * toEye[0] + normal[1] * toEye[1] + normal[2] * toEye[2] <= 0) {
      return { value: 0, unit: "share", detail: "the rectangle faces away from the eye" };
    }
    const skip = [frame, entityOf(args.eye), ...args.ignore].filter((id): id is string => id !== null);
    const points = gridPoints(centre, rotation, args.size, args.grid);
    const blockers = new Map<string, number>();
    for (const point of points) {
      const by = ctx.blocker(eye, point, skip, args.occluders, args.margin);
      if (by !== null) blockers.set(by, (blockers.get(by) ?? 0) + 1);
    }
    const hidden = [...blockers.values()].reduce((sum, count) => sum + count, 0);
    const value = (points.length - hidden) / points.length;
    const by = [...blockers].map(([id, count]) => `${String(count)} by ${id}`).join(", ");
    const detail = `${String(points.length - hidden)} of ${String(points.length)} points visible${by === "" ? "" : `; ${by}`}`;
    return { value, unit: "share", detail };
  },
});
