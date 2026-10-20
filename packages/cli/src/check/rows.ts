// SPDX-License-Identifier: Apache-2.0
/**
 * The rows of `scenity check`: one row per rule and unit of work, with the worst time of the rule, its value and limit,
 * and the result. The table text and the JSON report use the same rows.
 */
import type { Rule, RuleLevel } from "@scenity/scene";
import { limitText, timeText, type RuleResult, type RuleStatus } from "@scenity/rules";
import type { AssetOrigin } from "./assets";

/** The result of one rule on one scene (and sequence). */
export interface CheckRow {
  /** The scene file (relative to the project folder), or "project" for a problem of the project rules. */
  readonly scene: string;
  /** The ID of the sequence of the scope, or null. */
  readonly sequence: string | null;
  readonly rule: string;
  readonly metric: string;
  readonly level: RuleLevel;
  readonly status: RuleStatus;
  /** The scope words: `scene`, `entity ottoman`, `marker pickup/pickup`, `range walk`, `sequence walk`. */
  readonly scope: string;
  /** The worst time: `scene`, `5000 ms (pickup)`. */
  readonly time: string;
  readonly value: number | null;
  readonly unit: string | null;
  /** The limit words of the rule, or null when the rule uses the limit of the metric. */
  readonly limit: string | null;
  readonly detail: string;
  readonly provisional?: boolean;
  readonly known?: string;
  /** The reason of a logged override that accepts this failed `block` rule. */
  readonly override?: string;
}

/** The report of a check. */
export interface CheckReport {
  /** The ID of the project. */
  readonly project: string;
  /** The project folder (absolute). */
  readonly dir: string;
  /** The assets of the check, or null when the check loads no asset (no rules). */
  readonly assets: { readonly origin: AssetOrigin; readonly tier: string; readonly where: string } | null;
  readonly rows: readonly CheckRow[];
  /** The count of the rows. */
  readonly rules: number;
  /** True when no failed `block` rule is left (a logged override accepts a failure). */
  readonly passed: boolean;
}

/** The scope words of a rule. */
function scopeText(rule: Pick<Rule, "scope">, sequence: string | null): string {
  const scope = rule.scope;
  if (scope === undefined || scope.kind === "scene") return "scene";
  if (scope.kind === "entity")
    return `entity ${typeof scope.entity === "string" ? scope.entity : scope.entity.join(",")}`;
  const name = scope.sequence ?? sequence ?? "?";
  if (scope.kind === "marker")
    return `marker ${name}/${typeof scope.marker === "string" ? scope.marker : scope.marker.join(",")}`;
  return `${scope.kind} ${name}`;
}

/** The row of a rule result: the values of its worst time. */
export function resultRow(
  scene: string,
  sequence: string | null,
  result: RuleResult,
  rule: Pick<Rule, "scope">,
): CheckRow {
  const worst = result.times.find((time) => time.status === result.status) ?? result.times[0];
  return {
    scene,
    sequence,
    rule: result.id,
    metric: result.metric,
    level: result.level,
    status: result.status,
    scope: scopeText(rule, sequence),
    time: worst === undefined ? "scene" : timeText(worst.at),
    value: worst?.value ?? null,
    unit: worst?.unit ?? null,
    limit: result.limit === null ? null : limitText(result.limit, worst?.unit ?? null),
    detail: result.detail,
    ...(result.provisional === true ? { provisional: true } : {}),
    ...(result.known === undefined ? {} : { known: result.known }),
  };
}

/** The error row of a rule that the check could not measure (a scene that does not load, a bad rules file). */
export function failedRow(
  scene: string,
  sequence: string | null,
  rule: Pick<Rule, "id" | "metric" | "level"> & Partial<Pick<Rule, "scope">>,
  detail: string,
): CheckRow {
  return {
    scene,
    sequence,
    rule: rule.id,
    metric: rule.metric,
    level: rule.level,
    status: "error",
    scope: scopeText(rule, sequence),
    time: "scene",
    value: null,
    unit: null,
    limit: null,
    detail,
  };
}

/** True when a row stops the check: a failed `block` rule that no logged override accepts. */
export function blocks(row: CheckRow): boolean {
  return row.level === "block" && (row.status === "fail" || row.status === "error") && row.override === undefined;
}

/** The value words of a row: the value with at most 4 decimals and its unit, or "-". */
function valueText(row: CheckRow): string {
  if (row.value === null) return "-";
  const value = String(Math.round(row.value * 1e4) / 1e4 + 0);
  return row.unit === null ? value : `${value} ${row.unit}`;
}

/** The result words of a row: `PASS`, `FAIL block`, `FAIL warn`, `KNOWN`, `N/A`, `ERROR block`, `OVERRIDE`. */
function resultText(row: CheckRow): string {
  if (row.override !== undefined) return "OVERRIDE";
  if (row.status === "fail" || row.status === "error") return `${row.status.toUpperCase()} ${row.level}`;
  return row.status === "n/a" ? "N/A" : row.status.toUpperCase();
}

/** The lines of a table with columns of the widths of their longest cell. */
function table(head: readonly string[], cells: readonly (readonly string[])[]): string[] {
  const widths = head.map((title, index) => Math.max(title.length, ...cells.map((row) => row[index]?.length ?? 0)));
  const line = (row: readonly string[]) =>
    row
      .map((cell, index) => cell.padEnd(widths[index] ?? 0))
      .join("  ")
      .trimEnd();
  return [line(head), ...cells.map(line)];
}

/** The words of the failed and known rules; rules with the same words share one line. */
function noteLines(rows: readonly CheckRow[]): string[] {
  const byText = new Map<string, string[]>();
  for (const row of rows) {
    if (row.status !== "fail" && row.status !== "error" && row.status !== "known") continue;
    const known = row.known === undefined ? "" : ` (known: ${row.known})`;
    const text = `${row.detail}${known}${row.override === undefined ? "" : ` (override: ${row.override})`}`;
    byText.set(text, [...(byText.get(text) ?? []), row.rule]);
  }
  const lines = [...byText].map(([text, rules]) => `${rules.join(", ")}: ${text}`);
  return lines.length === 0 ? [] : ["", ...lines];
}

/** The text of a report: a table per scene, the failures with their words, and the decision. */
export function reportText(report: CheckReport): string[] {
  const assets =
    report.assets === null
      ? ""
      : `, ${report.assets.origin} assets${report.assets.where === "" ? "" : ` (${report.assets.where})`}, tier ${report.assets.tier}`;
  const out = [`scenity check ${report.project}${assets}`];
  if (report.rows.length === 0) return [...out, "no rules: the check passes."];
  for (const scene of [...new Set(report.rows.map((row) => row.scene))]) {
    const rows = report.rows.filter((row) => row.scene === scene);
    const cells = rows.map((row) => [
      `${row.rule}${row.provisional === true ? " *" : ""}`,
      row.scope,
      row.time,
      valueText(row),
      row.limit ?? "(metric)",
      resultText(row),
    ]);
    out.push(
      "",
      scene,
      ...table(["rule", "scope", "time", "value", "limit", "result"], cells).map((line) => `  ${line}`),
    );
  }
  out.push(...noteLines(report.rows));
  const failed = report.rows.filter(blocks);
  const count = (n: number, word: string) => `${String(n)} ${word}${n === 1 ? "" : "s"}`;
  const ids = failed.map((row) => row.rule).join(", ");
  out.push(
    "",
    report.passed
      ? `passed: ${count(report.rows.length, "rule")}`
      : `failed: ${count(failed.length, "block rule")} (${ids})`,
  );
  if (report.rows.some((row) => row.provisional === true)) out.push("* a provisional limit");
  return out;
}
