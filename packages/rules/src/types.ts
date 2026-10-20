// SPDX-License-Identifier: Apache-2.0
/**
 * The contracts of the metric library. A metric is an ID, a zod schema of its arguments and a function from a metric
 * context and the arguments to a value with a unit. A rule names a metric by its ID, gives its arguments as data and
 * puts a limit on its value.
 *
 * - The value is null when the metric does not apply to the scene or the frame (no entity of the arguments, no hand
 *   goal with a weight). A rule then has no verdict at that frame.
 * - A metric that measures many subjects (members of a set, pairs, legs of a walk) gives each subject as an item. The
 *   value is the worst item: the largest or the smallest (`worst`). A rule with an entity scope reads the items.
 * - A metric can give a limit from the data (a budget of the project). A rule with no limit of its own uses it.
 */
import type { z } from "zod";
import type { MetricContext } from "./context";

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];

/** A box with the axes of the world. */
export interface Box {
  readonly min: Vec3;
  readonly max: Vec3;
}

/** The units of the built-in metrics. A plugin metric can use another unit. */
export type MetricUnit = "m" | "deg" | "share" | "count" | "triangles" | (string & {});

/** The value of one subject of a metric: an entity, a pair `a+b`, a leg of a walk or an asset. */
export interface MetricItem {
  readonly subject: string;
  readonly value: number;
  readonly detail?: string;
}

/** A limit: the value must be at least `min` and at most `max`. */
export interface MetricLimit {
  readonly min?: number;
  readonly max?: number;
}

/** The result of a metric at one frame. */
export interface MetricResult {
  /** The worst item, or the one value; null when the metric does not apply to this scene or frame. */
  readonly value: number | null;
  readonly unit: MetricUnit;
  /** A short reason in words, for a person or an agent. */
  readonly detail?: string;
  readonly items?: readonly MetricItem[];
  /** A limit from the data (a budget of the project). A rule with no limit of its own uses it. */
  readonly limit?: MetricLimit;
}

/** A metric of the library. `Schema` is the zod schema of its arguments. */
export interface MetricDefinition<Schema extends z.ZodType = z.ZodType> {
  /** A built-in metric has a plain word (`distance`); a plugin metric has a dot (`doors.gap`). */
  readonly id: string;
  readonly label: string;
  readonly unit: MetricUnit;
  /** The schema of the arguments. A rule document gives the arguments as data. */
  readonly args: Schema;
  /** The item that is the worst: the largest value (`max`) or the smallest (`min`). Default: `max`. */
  readonly worst?: "max" | "min";
  evaluate(ctx: MetricContext, args: z.output<Schema>): MetricResult;
}
