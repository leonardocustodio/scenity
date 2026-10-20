// SPDX-License-Identifier: Apache-2.0
/**
 * The rows of the rules panel: one row for each rule. A row has the source file, the scope and the level of the rule,
 * the provisional and known marks, the value and the limit of its worst time, and its result. The scene page makes
 * the rows from the results of `evaluateRules` (`rowOf`). A plugin can make them from its own checks (the layout
 * checks of the lab). The panel groups the rows by source and filters them.
 *
 * No Vue import: the panel, the pages and the tests read it. The words are Fluent messages of
 * `src/i18n/en-US/rules.ftl`. The limit text and the words of a result come from `@scenity/rules` in English.
 */
import type { Rule, RuleLevel, RuleScope } from "@scenity/scene";
import type { MetricLimit, RuleResult, RuleStatus, RuleTimeResult } from "@scenity/rules";
import { limitText } from "@scenity/rules";
import { t } from "../../texts";

export type { RuleStatus };

/** One row of the rules panel. */
export interface RuleRow {
  readonly id: string;
  /** The file of the rule (a scene, a sequence, a rules file or the project file). */
  readonly source: string;
  /** The scope in words: `scene`, `sequence pickup`, `marker pickup`, `entity ottoman`. */
  readonly scope: string;
  readonly level: RuleLevel;
  readonly provisional: boolean;
  /** The reason of a known gap, or null. */
  readonly known: string | null;
  readonly status: RuleStatus;
  /** The value of the worst time, or null (no value). */
  readonly value: number | null;
  readonly unit: string | null;
  /** The limit in words (`max 0.45 m`), or an empty text. */
  readonly limit: string;
  /** The words of the result (the reason). */
  readonly detail: string;
  readonly note: string | null;
  /** The entities of the rule: a click on the row selects them. */
  readonly entities: readonly string[];
  /** The time of the worst result (ms), or null: a scene time. A click on the row seeks there. */
  readonly worst: number | null;
  /** The sequence of the scope, or null for a scene or entity scope. The graph plots a rule with a sequence. */
  readonly sequence: string | null;
}

/** The filter of the panel: only the failed rules (fail, error), and one level or both. */
export interface RowFilter {
  readonly failedOnly: boolean;
  readonly level: RuleLevel | "all";
}

export const NO_FILTER: RowFilter = { failedOnly: false, level: "all" };

/** The rows of one source file. */
export interface RowGroup {
  readonly source: string;
  readonly rows: readonly RuleRow[];
}

/** The scope of a rule in words. */
export function scopeWords(scope: RuleScope | undefined): string {
  if (scope === undefined || scope.kind === "scene") return t("rules-scope-scene");
  if (scope.kind === "entity") return t("rules-scope-entity", { entities: [scope.entity].flat().join(", ") });
  if (scope.kind === "sequence") {
    const sequence = scope.sequence ?? "";
    return sequence === "" ? t("rules-scope-sequence-open") : t("rules-scope-sequence", { sequence });
  }
  if (scope.kind === "range") return t("rules-scope-range", { from: String(scope.from), to: String(scope.to) });
  return t("rules-scope-marker", { markers: [scope.marker].flat().join(", ") });
}

/** The message ID of each level of a rule. */
const LEVEL_IDS: Readonly<Record<RuleLevel, string>> = { block: "rules-level-block", warn: "rules-level-warn" };

/** The level of a rule in words. */
export function levelWord(level: RuleLevel): string {
  return t(LEVEL_IDS[level]);
}

/** The sequence of a scope, or null. */
export function scopeSequence(scope: RuleScope | undefined): string | null {
  if (scope === undefined || scope.kind === "scene" || scope.kind === "entity") return null;
  return scope.sequence ?? null;
}

const RANK: Readonly<Record<RuleStatus, number>> = { "n/a": 0, pass: 1, known: 2, fail: 3, error: 4 };

/** How far a value is out of a limit (more is worse; a value in the limit gives zero or less). */
function margin(value: number, limit: MetricLimit | null): number {
  if (limit === null) return 0;
  const over = limit.max === undefined ? Number.NEGATIVE_INFINITY : value - limit.max;
  const under = limit.min === undefined ? Number.NEGATIVE_INFINITY : limit.min - value;
  return Math.max(over, under);
}

/** The worst time of a result: the worst status, then the value furthest out of the limit, then the first time. */
export function worstTime(result: RuleResult): RuleTimeResult | null {
  let kept: RuleTimeResult | null = null;
  for (const time of result.times) {
    if (kept === null || RANK[time.status] > RANK[kept.status]) {
      kept = time;
      continue;
    }
    if (RANK[time.status] < RANK[kept.status] || time.value === null) continue;
    if (kept.value === null || margin(time.value, result.limit) > margin(kept.value, result.limit)) kept = time;
  }
  return kept;
}

/** The entity IDs of a selector or a point reference (`entity:<id>#<sub>`); `tag:` reads the tags of the entities. */
function selectorIds(value: string, ids: ReadonlySet<string>, tags: ReadonlyMap<string, readonly string[]>): string[] {
  if (value.startsWith("entity:")) {
    const id = value.slice("entity:".length).split("#")[0] ?? "";
    return ids.has(id) ? [id] : [];
  }
  if (value.startsWith("tag:")) {
    const tag = value.slice("tag:".length);
    return [...tags].filter(([, list]) => list.includes(tag)).map(([id]) => id);
  }
  return ids.has(value) ? [value] : [];
}

/**
 * The entities of a rule: the entity IDs and the references in its arguments and in an entity scope, in their order.
 * `component:` selectors and `*` give no entities (they name too many). `tags` gives the tags of each entity.
 */
export function ruleEntities(
  rule: Rule,
  ids: readonly string[],
  tags: ReadonlyMap<string, readonly string[]> = new Map(),
): string[] {
  const known = new Set(ids);
  const values: string[] = [];
  const visit = (value: unknown): void => {
    if (typeof value === "string") values.push(value);
    else if (Array.isArray(value)) value.forEach(visit);
  };
  Object.values(rule.args ?? {}).forEach(visit);
  if (rule.scope?.kind === "entity") visit(rule.scope.entity);
  const out: string[] = [];
  for (const value of values) for (const id of selectorIds(value, known, tags)) if (!out.includes(id)) out.push(id);
  return out;
}

/** The row of a rule result. `rule` is the rule with its scope; `entities` are its entities in the scene. */
export function rowOf(result: RuleResult, rule: Rule, source: string, entities: readonly string[]): RuleRow {
  const worst = worstTime(result);
  const unit = worst?.unit ?? rule.unit ?? null;
  return {
    id: result.id,
    source,
    scope: scopeWords(rule.scope),
    level: result.level,
    provisional: result.provisional === true,
    known: result.known ?? null,
    status: result.status,
    value: worst?.value ?? null,
    unit,
    limit: result.limit === null ? "" : limitText(result.limit, unit),
    detail: result.detail,
    note: result.note ?? null,
    entities,
    worst: worst?.at.t ?? null,
    sequence: scopeSequence(rule.scope),
  };
}

/** True when a row failed: a `fail` or an `error` (a known gap is not a failure). */
export function failedRow(row: RuleRow): boolean {
  return row.status === "fail" || row.status === "error";
}

/** The rows that the filter keeps, in their order. */
export function filterRows(rows: readonly RuleRow[], filter: RowFilter): RuleRow[] {
  return rows.filter(
    (row) => (!filter.failedOnly || failedRow(row)) && (filter.level === "all" || row.level === filter.level),
  );
}

/** The rows grouped by source file, in the order of the first row of each source. */
export function groupRows(rows: readonly RuleRow[]): RowGroup[] {
  const groups = new Map<string, RuleRow[]>();
  for (const row of rows) {
    const list = groups.get(row.source) ?? [];
    list.push(row);
    groups.set(row.source, list);
  }
  return [...groups].map(([source, list]) => ({ source, rows: list }));
}

/** The value of a row as text with its unit (`0.123 m`; a `count` unit has no word), or a dash for no value. */
export function valueWords(row: Pick<RuleRow, "value" | "unit">): string {
  if (row.value === null) return "—";
  const value = String(Math.round(row.value * 1e4) / 1e4 + 0);
  return row.unit === null || row.unit === "count" ? value : `${value} ${row.unit}`;
}

/** The status word of a row: `ok` for a pass, else the status. */
export function statusWord(status: RuleStatus): string {
  return t("rules-status", { status });
}

/** The main line of a row: the status word, the rule ID, the value and the limit, with the provisional mark. */
export function rowLine(row: Pick<RuleRow, "status" | "id" | "value" | "unit" | "limit" | "provisional">): string {
  const args = { status: row.status, id: row.id, value: valueWords(row), limit: row.limit };
  return row.provisional ? t("rules-row-provisional", args) : t("rules-row", args);
}

/** One line of counts: `5 rules: 3 pass, 1 fail, 1 n/a`. */
export function rowsSummary(rows: readonly RuleRow[]): string {
  if (rows.length === 0) return t("rules-summary-none");
  const counts = new Map<RuleStatus, number>();
  for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
  const order: readonly RuleStatus[] = ["pass", "fail", "error", "known", "n/a"];
  const parts = order.flatMap((status) => {
    const count = counts.get(status) ?? 0;
    return count === 0 ? [] : [t("rules-count", { status, count })];
  });
  return t("rules-summary", { count: rows.length, parts: parts.join(", ") });
}
