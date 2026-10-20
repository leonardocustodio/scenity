// SPDX-License-Identifier: Apache-2.0
/**
 * The shared parts of the built-in metrics: the schemas of a point, a selector and a floor rectangle, and the
 * result of a list of items (the worst item is the value).
 */
import { z } from "zod";
import type { MetricItem, MetricResult, MetricUnit } from "../types";

// The pages of Scenity have a strict CSP with Trusted Types. Without this setting, zod calls `Function("")`
// when it makes an object schema, and the page reports a CSP violation. A plugin metric module can load before the
// schema modules of @scenity/scene (packages/scene/src/schema/common.ts), so the library sets it too.
z.config({ jitless: true });

export const vec3Arg = z.tuple([z.number(), z.number(), z.number()]);

/** A point: a reference (`entity:<id>`, `entity:<id>#<socket, bone or path.N>`) or a world point. */
export const pointArg = z.union([z.string().regex(/^entity:/, "a reference starts with entity:"), vec3Arg]);

/** Entities: an ID, `tag:<tag>`, `component:<id>`, `*`, or a list of them. */
export const selectorArg = z.union([z.string().min(1), z.array(z.string().min(1)).min(1)]);

export const floorRectArg = z.strictObject({
  minX: z.number(),
  maxX: z.number(),
  minZ: z.number(),
  maxZ: z.number(),
});

/** A number rounded to 0.1 mm (or 0.0001 of a unit), with no negative zero. */
export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4 + 0;
}

/** The text of a length in centimetres. */
export function cm(metres: number): string {
  return `${(metres * 100).toFixed(1)} cm`;
}

/**
 * The result of a list of items: the worst item is the value (`max`: the largest, `min`: the smallest). No item: the
 * metric does not apply, and `none` says why.
 */
export function fromItems(
  items: readonly MetricItem[],
  unit: MetricUnit,
  worst: "max" | "min",
  none: string,
): MetricResult {
  if (items.length === 0) return { value: null, unit, detail: none };
  const best = items.reduce((kept, item) =>
    (worst === "max" ? item.value > kept.value : item.value < kept.value) ? item : kept,
  );
  const detail = `${best.subject}: ${best.detail ?? String(round4(best.value))}`;
  // The values stay as they are: a rule compares the exact value, as the checks of the first plugin do.
  return { value: best.value, unit, detail, items };
}

/** A metric with no value, and the reason. */
export function notApplied(unit: MetricUnit, detail: string): MetricResult {
  return { value: null, unit, detail };
}
