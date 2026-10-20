// SPDX-License-Identifier: Apache-2.0
/**
 * The budgets editor: the rows of `quality.budgets` of the project (a group such as `scene` or `scene.webgpu`, a tier
 * and a budget key) with the limit of the project and the value of the last bench run of that tier, and the edit of a
 * limit. The functions are pure and use no DOM.
 */
import type { BenchReportView } from "../performance/benchTrend";

/** The keys of a quality budget, in the order of the editor. */
export const BUDGET_KEYS = [
  "drawCalls",
  "triangles",
  "workP95Ms",
  "gpuP95Ms",
  "firstFrameMs",
  "bytes",
  "textures",
  "textureBytes",
  "maxTextureSize",
] as const;
export type BudgetKey = (typeof BUDGET_KEYS)[number];

/** The quality budgets of a project: a group, then a tier, then the limit of each key. */
export type QualityBudgets = Readonly<
  Record<string, Readonly<Record<string, Readonly<Partial<Record<BudgetKey, number>>>>>>
>;

/** One row of the editor. */
export interface BudgetRow {
  readonly group: string;
  readonly tier: string;
  readonly key: BudgetKey;
  /** The limit of the project, or null (no budget for the key). */
  readonly limit: number | null;
  /** The value of the last bench run of the tier (its first run with a value), or null. */
  readonly value: number | null;
  /** The result of the last bench run for the key ("pass", "over", "not judged"), or null. */
  readonly result: string | null;
  /** The limit that the last bench run used, or null. */
  readonly benchLimit: number | null;
}

/** The tiers of the editor: the tiers of the project, else the four tiers of the engine. */
export function tiersOf(project: { readonly quality?: { readonly tiers?: readonly string[] } }): string[] {
  return [...(project.quality?.tiers ?? ["ultra", "high", "medium", "low"])];
}

/** The bench value and the result of a key in the last report of a tier (the first run that has the row). */
function lastValue(
  history: readonly BenchReportView[],
  tier: string,
  key: BudgetKey,
): { value: number | null; result: string | null; benchLimit: number | null } {
  const report = [...history].reverse().find((item) => item.tier === tier);
  for (const run of report?.runs ?? []) {
    const row = run.rows.find((item) => item.key === key);
    if (row !== undefined) return { value: row.value, result: row.result, benchLimit: row.limit };
  }
  return { value: null, result: null, benchLimit: null };
}

/** The rows of a group and its tiers: each key of each tier, with the limit and the last bench value. */
export function budgetRows(
  budgets: QualityBudgets,
  group: string,
  tiers: readonly string[],
  history: readonly BenchReportView[],
): BudgetRow[] {
  return tiers.flatMap((tier) =>
    BUDGET_KEYS.map((key) => ({
      group,
      tier,
      key,
      limit: budgets[group]?.[tier]?.[key] ?? null,
      ...lastValue(history, tier, key),
    })),
  );
}

/** A copy of a record without one key, or with a new value of it. */
function withKey<T>(record: Readonly<Record<string, T>>, key: string, value: T | undefined): Record<string, T> {
  const rest = Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

/** The budgets with a new limit of a key (null: no budget for the key). The result has no empty tier or group. */
export function withLimit(
  budgets: QualityBudgets,
  group: string,
  tier: string,
  key: BudgetKey,
  limit: number | null,
): QualityBudgets {
  const tierValue = withKey<number>(budgets[group]?.[tier] ?? {}, key, limit ?? undefined);
  const groupValue = withKey(budgets[group] ?? {}, tier, Object.keys(tierValue).length === 0 ? undefined : tierValue);
  return withKey(budgets, group, Object.keys(groupValue).length === 0 ? undefined : groupValue);
}

/** The groups of the editor: `scene` and the groups of the project. */
export function groupsOf(budgets: QualityBudgets): string[] {
  return [...new Set(["scene", ...Object.keys(budgets)])];
}
