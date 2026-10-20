// SPDX-License-Identifier: Apache-2.0
/**
 * The one gate of the rules. The save of a scene, the CLI (`scenity check`) and the tools of Claude use the same two
 * steps:
 *
 * 1. `evaluateRules(rules, registry, contextAt)`: each rule at each time of its scope. A time gives `pass`, `fail`,
 *    `known` (a failure of a rule with a `known` gap), `n/a` (the metric does not apply, or no context at that time)
 *    or `error` (no metric, bad arguments, another unit, a bad scope). The status of a rule is its worst time.
 * 2. `gateRules(verdicts, reason)`: a `fail` or an `error` of a `block` rule stops the save, unless the owner gives a
 *    reason (the override). A `warn` rule never stops it. A known gap and a provisional limit show in the words.
 */
import type { Rule, RuleLevel } from "@scenity/scene";
import type { MetricContext } from "./context";
import { inLimit, type MetricRegistry } from "./registry";
import { entityItems, SCENE_TIME, scopeTimes, timeText, type RuleSequence, type RuleTime } from "./scopes";
import type { MetricItem, MetricLimit, MetricResult } from "./types";

export type RuleStatus = "pass" | "fail" | "known" | "n/a" | "error";

/** The result of a rule at one time. */
export interface RuleTimeResult {
  readonly at: RuleTime;
  readonly status: RuleStatus;
  readonly value: number | null;
  readonly unit: string | null;
  readonly detail: string;
}

/** The verdict of a rule: the part of a result that the gate reads (the save request carries it). */
export interface RuleVerdict {
  readonly id: string;
  readonly level: RuleLevel;
  readonly status: RuleStatus;
  readonly detail?: string;
  readonly provisional?: boolean;
}

/** The result of a rule over the times of its scope. */
export interface RuleResult extends RuleVerdict {
  readonly metric: string;
  readonly detail: string;
  /** The limit of the rule; null when the rule uses the limit of the metric (the words of each time give it). */
  readonly limit: MetricLimit | null;
  readonly note?: string;
  readonly known?: string;
  readonly times: readonly RuleTimeResult[];
}

/** The metric context of a time, or null when the caller cannot make it (for example: the sequence is not loaded). */
export type RuleContextAt = (at: RuleTime) => MetricContext | null;

export interface EvaluateRulesOptions {
  /** The sequence documents by ID, for the times of the sequence, range and marker scopes. */
  readonly sequences?: Readonly<Record<string, RuleSequence>>;
}

const RANK: Readonly<Record<RuleStatus, number>> = { "n/a": 0, pass: 1, known: 2, fail: 3, error: 4 };

/** The worst of two statuses. */
export function worstStatus(a: RuleStatus, b: RuleStatus): RuleStatus {
  return RANK[b] > RANK[a] ? b : a;
}

function round(value: number): string {
  return String(Math.round(value * 1e4) / 1e4 + 0);
}

/** The words of a limit: `min 0.6 m`, `max 0.45 m`, `0.1 to 0.3 deg`. */
export function limitText(limit: MetricLimit, unit: string | null): string {
  const tail = unit === null ? "" : ` ${unit}`;
  if (limit.min !== undefined && limit.max !== undefined) return `${round(limit.min)} to ${round(limit.max)}${tail}`;
  if (limit.min !== undefined) return `min ${round(limit.min)}${tail}`;
  return limit.max === undefined ? "no limit" : `max ${round(limit.max)}${tail}`;
}

/** The limit of the fields `min` and `max` of a rule. */
function ruleLimitOf(rule: Rule): MetricLimit {
  return { ...(rule.min === undefined ? {} : { min: rule.min }), ...(rule.max === undefined ? {} : { max: rule.max }) };
}

/** The limit of a rule, else the limit of the metric, else null. */
function limitOf(rule: Rule, result: MetricResult): MetricLimit | null {
  if (rule.min !== undefined || rule.max !== undefined) return ruleLimitOf(rule);
  return result.limit ?? null;
}

/** The worst item of a list, or undefined for no item. */
function worstItem(items: readonly MetricItem[], worst: "max" | "min"): MetricItem | undefined {
  return items.reduce<MetricItem | undefined>((kept, item) => {
    if (kept === undefined) return item;
    return (worst === "max" ? item.value > kept.value : item.value < kept.value) ? item : kept;
  }, undefined);
}

/** The value and the words of a metric result in the scope of a rule (an entity scope reads the items). */
function scoped(rule: Rule, registry: MetricRegistry, ctx: MetricContext, result: MetricResult) {
  if (rule.scope?.kind !== "entity") return { value: result.value, detail: result.detail ?? "" };
  const items = entityItems(ctx, rule.scope.entity, result.items);
  if (items === null) return { value: null, detail: "the metric gives no items for an entity scope" };
  const item = worstItem(items, registry.get(rule.metric)?.worst ?? "max");
  if (item === undefined) return { value: null, detail: "no item of the metric is about the entities" };
  return { value: item.value, detail: `${item.subject}: ${item.detail ?? round(item.value)}` };
}

/** The result of a rule at one time. */
function judge(rule: Rule, registry: MetricRegistry, ctx: MetricContext | null, at: RuleTime): RuleTimeResult {
  const none = (status: RuleStatus, detail: string): RuleTimeResult => ({
    at,
    status,
    value: null,
    unit: null,
    detail,
  });
  if (ctx === null) return none("n/a", `no metric context at ${timeText(at)}`);
  const outcome = registry.evaluate(rule.metric, ctx, rule.args ?? {});
  if (!outcome.ok) return none("error", outcome.reason);
  const { result } = outcome;
  if (rule.unit !== undefined && rule.unit !== result.unit) {
    return none("error", `the rule has the unit ${rule.unit}, the metric gives ${result.unit}`);
  }
  const { value, detail } = scoped(rule, registry, ctx, result);
  const base = { at, value, unit: result.unit };
  if (value === null) return { ...base, status: "n/a", detail: detail || "the metric does not apply" };
  const limit = limitOf(rule, result);
  const words = `${round(value)} ${result.unit}${detail === "" ? "" : ` (${detail})`}`;
  if (limit === null) return { ...base, status: "n/a", detail: `${words}; the rule has no limit` };
  if (inLimit(value, limit)) return { ...base, status: "pass", detail: `${words}, ${limitText(limit, result.unit)}` };
  return {
    ...base,
    status: rule.known === undefined ? "fail" : "known",
    detail: `${words}, ${limitText(limit, result.unit)}`,
  };
}

/** The result of one rule from the results of its times. */
function ruleResult(rule: Rule, times: readonly RuleTimeResult[]): RuleResult {
  const worst = times.reduce((kept, item) => (RANK[item.status] > RANK[kept.status] ? item : kept));
  return {
    id: rule.id,
    metric: rule.metric,
    level: rule.level,
    status: worst.status,
    detail: worst.at.t === null ? worst.detail : `at ${timeText(worst.at)}: ${worst.detail}`,
    limit: rule.min === undefined && rule.max === undefined ? null : ruleLimitOf(rule),
    ...(rule.provisional === true ? { provisional: true } : {}),
    ...(rule.note === undefined ? {} : { note: rule.note }),
    ...(rule.known === undefined ? {} : { known: rule.known }),
    times,
  };
}

function timeKey(at: RuleTime): string {
  return `${at.sequence ?? ""}@${String(at.t)}`;
}

/**
 * Evaluate the rules: each rule at each time of its scope. `contextAt` makes the metric context of a time (a page
 * moves its core to the time; a test or a tool makes it from data). A rule with no scope has the scope `scene`; use
 * `documentRules` first for the rules of a sequence.
 *
 * The gate asks for each time one time only, in the order of the first rule that has it, and evaluates each rule of
 * that time before it asks for the next time. Thus a context can read a live scene (its hooks are lazy).
 */
export function evaluateRules(
  rules: readonly Rule[],
  registry: MetricRegistry,
  contextAt: RuleContextAt,
  options: EvaluateRulesOptions = {},
): RuleResult[] {
  const sequences = options.sequences ?? {};
  const scoped = rules.map((rule) => {
    const scope = rule.scope ?? { kind: "scene" as const };
    const found = scopeTimes(scope, sequences);
    // The keys of the times of each rule, so a rule with many times does not search its list at each time.
    const keys = new Set(found.ok ? found.times.map(timeKey) : []);
    return { rule: { ...rule, scope }, found, keys };
  });
  const order = new Map<string, RuleTime>();
  for (const { found } of scoped)
    if (found.ok) for (const at of found.times) order.set(timeKey(at), order.get(timeKey(at)) ?? at);
  const judged = new Map<string, RuleTimeResult>();
  for (const [key, at] of order) {
    const ctx = contextAt(at);
    scoped.forEach(({ rule, keys }, index) => {
      if (keys.has(key)) judged.set(`${String(index)}|${key}`, judge(rule, registry, ctx, at));
    });
  }
  return scoped.map(({ rule, found }, index) => {
    if (!found.ok)
      return ruleResult(rule, [{ at: SCENE_TIME, status: "error", value: null, unit: null, detail: found.reason }]);
    return ruleResult(
      rule,
      found.times.map((at) => judged.get(`${String(index)}|${timeKey(at)}`) ?? judge(rule, registry, null, at)),
    );
  });
}

/** The decision of the gate. */
export interface RuleGate {
  /** True when no `block` rule fails. */
  readonly passed: boolean;
  /** True when the save can go: it passed, or the owner gave a reason. */
  readonly allowed: boolean;
  /** The `block` rules that fail (or have an error). */
  readonly blocks: readonly RuleVerdict[];
  /** The `warn` rules that fail (or have an error). */
  readonly warns: readonly RuleVerdict[];
  /** The rules that fail with a known gap. */
  readonly known: readonly RuleVerdict[];
  /** The reason of the owner when it lets a failed gate go, else null. */
  readonly override: string | null;
  /** The words of the decision, for a person or an agent. */
  readonly message: string;
}

function failed(verdict: RuleVerdict): boolean {
  return verdict.status === "fail" || verdict.status === "error";
}

/** The words of a verdict: `id (provisional): detail`. */
export function verdictText(verdict: RuleVerdict): string {
  const mark = verdict.provisional === true ? " (provisional)" : "";
  return `${verdict.id}${mark}${verdict.detail === undefined || verdict.detail === "" ? "" : `: ${verdict.detail}`}`;
}

/** The decision of the gate over the verdicts of the rules. A reason of the owner lets a failed gate go. */
export function gateRules(verdicts: readonly RuleVerdict[], reason?: string | null): RuleGate {
  const blocks = verdicts.filter((verdict) => verdict.level === "block" && failed(verdict));
  const warns = verdicts.filter((verdict) => verdict.level === "warn" && failed(verdict));
  const known = verdicts.filter((verdict) => verdict.status === "known");
  const given = reason?.replace(/\s+/g, " ").trim() ?? "";
  const passed = blocks.length === 0;
  const override = !passed && given !== "" ? given : null;
  const count = (n: number, word: string) => `${String(n)} ${word} rule${n === 1 ? "" : "s"}`;
  const words = [
    passed ? "The rules pass." : `${count(blocks.length, "block")} fail: ${blocks.map(verdictText).join("; ")}.`,
    warns.length === 0 ? "" : `${count(warns.length, "warn")} fail: ${warns.map(verdictText).join("; ")}.`,
    known.length === 0 ? "" : `Known gaps: ${known.map((verdict) => verdict.id).join(", ")}.`,
    passed ? "" : override === null ? "Give a reason to save anyway." : `Overridden: ${override}`,
  ];
  return {
    passed,
    allowed: passed || override !== null,
    blocks,
    warns,
    known,
    override,
    message: words.filter((word) => word !== "").join(" "),
  };
}
