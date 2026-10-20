// SPDX-License-Identifier: Apache-2.0
/**
 * The metrics of place: `distance` between two points, `overlap` of two sets of entities, and `belowFloor`
 * of the low points of an entity.
 *
 * | Metric | Value |
 * | --- | --- |
 * | `distance` | The distance from `from` to `to` (m), in space or over the floor |
 * | `overlap` | The deepest overlap of a pair of entities (m): boxes, mesh part boxes or floor rectangles |
 * | `belowFloor` | How far the lowest joint (else the box bottom) is under the floor height plus a clearance (m) |
 */
import { z } from "zod";
import type { MetricContext } from "../context";
import { boxOverlap, distance as spaceDistance, floorDistance } from "../geometry";
import { defineMetric } from "../registry";
import type { Box, MetricItem } from "../types";
import { cm, fromItems, notApplied, pointArg, selectorArg } from "./common";

export const distance = defineMetric({
  id: "distance",
  label: "Distance",
  unit: "m",
  args: z.strictObject({
    from: pointArg,
    to: pointArg,
    /** `floor`: over the floor (x, z) only. */
    plane: z.enum(["space", "floor"]).default("space"),
  }),
  evaluate(ctx, args) {
    const from = ctx.point(args.from);
    const to = ctx.point(args.to);
    if (from === null || to === null) {
      return notApplied("m", `no point for ${JSON.stringify(from === null ? args.from : args.to)}`);
    }
    const value = args.plane === "floor" ? floorDistance(from, to) : spaceDistance(from, to);
    return { value, unit: "m", detail: `${cm(value)} ${args.plane === "floor" ? "over the floor" : "in space"}` };
  },
});

const OVERLAP_MODES = ["bounds", "meshes", "floor"] as const;

/** The overlap depth of two entities in a mode, or null when one has no geometry. */
function pairDepth(ctx: MetricContext, a: string, b: string, mode: (typeof OVERLAP_MODES)[number]): number | null {
  if (mode === "meshes") {
    const left = ctx.meshBoxes(a);
    const right = ctx.meshBoxes(b);
    if (left.length === 0 || right.length === 0) return null;
    let deepest = 0;
    for (const box of left) for (const other of right) deepest = Math.max(deepest, boxOverlap(box, other));
    return deepest;
  }
  const left: Box | null = ctx.entity(a)?.bounds ?? null;
  const right: Box | null = ctx.entity(b)?.bounds ?? null;
  if (left === null || right === null) return null;
  return boxOverlap(left, right, mode === "floor" ? [0, 2] : [0, 1, 2]);
}

/** The pairs of two sets (or of one set with itself) with no entity in the subtree of the other. */
function pairs(ctx: MetricContext, a: readonly string[], b: readonly string[] | null): [string, string][] {
  const out: [string, string][] = [];
  const seen = new Set<string>();
  for (const left of a) {
    for (const right of b ?? a) {
      const key = [left, right].sort().join("+");
      if (left === right || seen.has(key) || ctx.holds(left, right) || ctx.holds(right, left)) continue;
      seen.add(key);
      out.push([left, right]);
    }
  }
  return out;
}

export const overlap = defineMetric({
  id: "overlap",
  label: "Overlap",
  unit: "m",
  worst: "max",
  args: z.strictObject({
    a: selectorArg,
    /** The second set. Absent: the pairs of `a`. */
    b: selectorArg.optional(),
    /**
     * `bounds`: the boxes of the entities; `meshes`: the boxes of the mesh parts; `floor`: the boxes over the floor.
     */
    mode: z.enum(OVERLAP_MODES).default("bounds"),
    /** An overlap up to this depth counts as none (m): the boxes are coarse. */
    margin: z.number().min(0).default(0),
  }),
  evaluate(ctx, args) {
    const b = args.b === undefined ? null : ctx.select(args.b);
    const items: MetricItem[] = [];
    for (const [left, right] of pairs(ctx, ctx.select(args.a), b)) {
      const depth = pairDepth(ctx, left, right, args.mode);
      if (depth === null) continue;
      const value = depth > args.margin ? depth : 0;
      items.push({ subject: `${left}+${right}`, value, detail: value > 0 ? `${cm(value)} deep` : "apart" });
    }
    return fromItems(items, "m", "max", "no pair of entities with geometry");
  },
});

/** The feet bones of a humanoid (canonical names) and of the first plugin (ankles). */
const FEET = ["leftFoot", "rightFoot", "leftToes", "rightToes", "ankle_l", "ankle_r"];

export const belowFloor = defineMetric({
  id: "belowFloor",
  label: "Below the floor",
  unit: "m",
  worst: "max",
  args: z.strictObject({
    /** The entities. Default: each entity with joints. */
    entity: selectorArg.optional(),
    /** The joints of the low points. Default: the feet; with none of them, the bottom of the box. */
    joints: z.array(z.string().min(1)).min(1).optional(),
    /** The floor height (m), or the entity whose box top is the floor (a step). */
    floor: z.union([z.number(), z.string().min(1)]).default(0),
    /** The low point stays this high over the floor (m). */
    clearance: z.number().default(0),
  }),
  evaluate(ctx, args) {
    const floor = typeof args.floor === "number" ? args.floor : (ctx.entity(args.floor)?.bounds?.max[1] ?? null);
    if (floor === null) return notApplied("m", `no box for the floor entity ${String(args.floor)}`);
    const ids =
      args.entity === undefined
        ? ctx.entities().flatMap((entity) => (entity.joints === null ? [] : [entity.id]))
        : ctx.select(args.entity);
    const items: MetricItem[] = [];
    for (const id of ids) {
      const entity = ctx.entity(id);
      const points = (args.joints ?? FEET).flatMap((name) => {
        const point = entity?.joints?.[name];
        return point === undefined ? [] : [point[1]];
      });
      const low = points.length > 0 ? Math.min(...points) : (entity?.bounds?.min[1] ?? null);
      if (low === null) continue;
      const value = Math.max(0, floor + args.clearance - low);
      items.push({ subject: id, value, detail: `low point at ${cm(low)}, floor ${cm(floor)}` });
    }
    return fromItems(items, "m", "max", "no entity with joints or a box");
  },
});
