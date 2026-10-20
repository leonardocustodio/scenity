// SPDX-License-Identifier: Apache-2.0
/**
 * The metrics of the project: `triangleBudget`, the triangles of the scene or of entities against a budget,
 * and `assetRights`, the assets that the scene uses with no rights record that allows the release.
 *
 * | Metric | Value | Limit from the data |
 * | --- | --- | --- |
 * | `triangleBudget` | The triangles of one copy of each mesh of the entities and their subtrees, or of the scene | `max`: the budget, or the scene budget of the tier in the project |
 * | `assetRights` | The count of the assets with no record, or with a record that the release gate refuses | `max`: 0 |
 */
import { z } from "zod";
import { projectBudget } from "@scenity/scene/project";
import type { MetricContext } from "../context";
import { defineMetric } from "../registry";
import type { MetricLimit } from "../types";
import { notApplied, selectorArg } from "./common";

/** The triangles of the entities of a selector and of their subtrees, each entity one time. */
function trianglesOf(ctx: MetricContext, ids: readonly string[]): number {
  let total = 0;
  for (const entity of ctx.entities()) {
    if (ids.some((id) => ctx.holds(id, entity.id))) total += entity.stats.triangles;
  }
  return total;
}

export const triangleBudget = defineMetric({
  id: "triangleBudget",
  label: "Triangle budget",
  unit: "triangles",
  args: z.strictObject({
    /** The entities (with their subtrees). Default: the whole scene. */
    entity: selectorArg.optional(),
    /** The budget (triangles). */
    budget: z.number().int().positive().optional(),
    /** The tier of the scene budget of the project (`quality.budgets.scene.<tier>.triangles`), with no `budget`. */
    tier: z.string().min(1).optional(),
  }),
  evaluate(ctx, args) {
    const value = args.entity === undefined ? ctx.totals().triangles : trianglesOf(ctx, ctx.select(args.entity));
    const project = ctx.project;
    const fromProject =
      args.tier === undefined || project === null ? undefined : projectBudget(project, "scene", args.tier)?.triangles;
    const budget = args.budget ?? fromProject;
    if (budget === undefined) return { value, unit: "triangles", detail: `${String(value)} triangles, no budget` };
    const limit: MetricLimit = { max: budget };
    const share = Math.round((value / budget) * 100);
    return { value, unit: "triangles", detail: `${String(value)} of ${String(budget)} (${String(share)} %)`, limit };
  },
});

export const assetRights = defineMetric({
  id: "assetRights",
  label: "Asset rights",
  unit: "count",
  args: z.strictObject({
    /** The asset IDs. Default: the assets that the scene document names. */
    assets: z.array(z.string().min(1)).optional(),
  }),
  evaluate(ctx, args) {
    const statuses = ctx.assets();
    if (statuses === null) return notApplied("count", "the context has no asset records");
    const byId = new Map(statuses.map((status) => [status.id, status]));
    const items = (args.assets ?? ctx.usedAssets()).map((id) => {
      const status = byId.get(id);
      if (status === undefined) return { subject: id, value: 1, detail: "no asset record" };
      return status.allowed
        ? { subject: id, value: 0, detail: "allowed" }
        : { subject: id, value: 1, detail: status.problems.join("; ") || "the release gate refuses it" };
    });
    const value = items.reduce((sum, item) => sum + item.value, 0);
    const detail = `${String(value)} of ${String(items.length)} assets cannot go into a release`;
    return { value, unit: "count", detail, items, limit: { max: 0 } };
  },
});
