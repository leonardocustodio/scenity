// SPDX-License-Identifier: Apache-2.0
/** The results and the summary of a run of the agent benchmark. */
import type { Category } from "./case";

export interface CaseResult {
  readonly id: string;
  readonly category: Category;
  readonly pass: boolean;
  readonly detail: string;
  readonly durationMs: number | null;
  readonly costUsd: number | null;
  readonly turns: number | null;
  readonly toolCalls: number | null;
  readonly model: string | null;
  readonly error: string | null;
  /** The approval cards that the person answered (the studio adapter), or null with no review. */
  readonly reviews?: number | null;
}

function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? (sorted[mid] ?? 0) : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
}

const number = (value: number | null, digits = 0): string => (value === null ? "—" : value.toFixed(digits));

/** The totals of a run: the share of passed cases, the median time and the cost. */
export function totals(results: readonly CaseResult[]): {
  passed: number;
  total: number;
  medianS: number | null;
  costUsd: number;
} {
  const durations = results.map((r) => r.durationMs).filter((d): d is number => d !== null);
  const median_ = median(durations);
  return {
    passed: results.filter((r) => r.pass).length,
    total: results.length,
    medianS: median_ === null ? null : median_ / 1000,
    costUsd: results.reduce((sum, r) => sum + (r.costUsd ?? 0), 0),
  };
}

/** The summary of a run as Markdown. */
export function summary(results: readonly CaseResult[], title: string): string {
  const t = totals(results);
  const categories = [...new Set(results.map((r) => r.category))];
  const lines = [
    `# ${title}`,
    "",
    `Passed: ${String(t.passed)} of ${String(t.total)}. Median time: ${number(t.medianS, 1)} s. Cost: $${t.costUsd.toFixed(2)}.` +
      (results.some((r) => typeof r.reviews === "number")
        ? ` Review steps: ${String(results.reduce((sum, r) => sum + (r.reviews ?? 0), 0))}.`
        : ""),
    "",
    "| Category | Passed |",
    "| -------- | ------ |",
    ...categories.map((c) => {
      const of = results.filter((r) => r.category === c);
      return `| ${c} | ${String(of.filter((r) => r.pass).length)} of ${String(of.length)} |`;
    }),
    "",
    "| Case | Pass | Time (s) | Cost ($) | Turns | Tool calls | Detail |",
    "| ---- | ---- | -------- | -------- | ----- | ---------- | ------ |",
    ...results.map(
      (r) =>
        `| ${r.id} | ${r.pass ? "yes" : "no"} | ${number(r.durationMs === null ? null : r.durationMs / 1000, 1)} | ${number(r.costUsd, 2)} | ${number(r.turns)} | ${number(r.toolCalls)} | ${(r.error ?? r.detail).replaceAll("|", "/").replaceAll("\n", " ").slice(0, 120)} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
