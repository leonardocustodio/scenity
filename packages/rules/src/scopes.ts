// SPDX-License-Identifier: Apache-2.0
/**
 * The scopes of the rules: the times of a rule from its scope and the sequence documents, the default scope of the
 * rules of a document, and the items of a metric for the entities of an entity scope.
 *
 * | Scope | Times |
 * | --- | --- |
 * | `scene`, `entity` | One time with no sequence |
 * | `sequence` | Each marker and each key time of the sequence, in order, each time one time |
 * | `range` | `from`, then a step of `step` ms to `to` (and `to`) |
 * | `marker` | The time of each marker |
 */
import type { Rule, RuleScope } from "@scenity/scene";
import type { MetricContext } from "./context";
import type { MetricItem } from "./types";

/** A sequence as the scopes read it: its ID, its duration, its markers and the key times of its tracks. */
export interface RuleSequence {
  readonly id: string;
  readonly duration: number;
  readonly markers?: Readonly<Record<string, number>> | undefined;
  readonly tracks: readonly { readonly keys: readonly { readonly t: number }[] }[];
}

/** A time of a rule: no sequence (the scene), or a time of a sequence with the name of its marker. */
export interface RuleTime {
  readonly sequence: string | null;
  readonly t: number | null;
  readonly marker?: string;
}

/** The times of a scope, or the reason that the scope has no times. */
export type ScopeTimes =
  { readonly ok: true; readonly times: readonly RuleTime[] } | { readonly ok: false; readonly reason: string };

/** The time of the scene: no sequence. */
export const SCENE_TIME: RuleTime = { sequence: null, t: null };

/** The most times of one rule (a range with a small step). */
export const MAX_RULE_TIMES = 2000;

/**
 * The rules of a document with a scope each: a rule with no scope gets `scene`, or `sequence` in a sequence document;
 * a sequence scope with no `sequence` gets the sequence of the document.
 */
export function documentRules(rules: readonly Rule[] | undefined, sequence?: string): Rule[] {
  return (rules ?? []).map((rule) => {
    const scope = rule.scope ?? (sequence === undefined ? { kind: "scene" } : { kind: "sequence" });
    if (sequence === undefined || scope.kind === "scene" || scope.kind === "entity" || scope.sequence !== undefined) {
      return { ...rule, scope };
    }
    return { ...rule, scope: { ...scope, sequence } };
  });
}

function timeOf(sequence: RuleSequence, at: number | string): number | null {
  if (typeof at === "number") return at;
  return sequence.markers?.[at] ?? null;
}

/** The markers and the key times of a sequence, in time order; a time with a marker has its name. */
function sequenceTimes(sequence: RuleSequence): RuleTime[] {
  const names = new Map<number, string>();
  for (const [name, t] of Object.entries(sequence.markers ?? {})) if (!names.has(t)) names.set(t, name);
  const times = new Set<number>(names.keys());
  for (const track of sequence.tracks) for (const key of track.keys) times.add(key.t);
  if (times.size === 0) times.add(0);
  return [...times]
    .sort((a, b) => a - b)
    .map((t) => {
      const marker = names.get(t);
      return marker === undefined ? { sequence: sequence.id, t } : { sequence: sequence.id, t, marker };
    });
}

/** The times of a range scope of a sequence. */
function rangeTimes(sequence: RuleSequence, scope: Extract<RuleScope, { kind: "range" }>): ScopeTimes {
  const from = timeOf(sequence, scope.from);
  const to = timeOf(sequence, scope.to);
  if (from === null || to === null) {
    return {
      ok: false,
      reason: `the sequence "${sequence.id}" has no marker "${String(from === null ? scope.from : scope.to)}"`,
    };
  }
  if (to < from)
    return { ok: false, reason: `the range ends (${String(to)} ms) before it starts (${String(from)} ms)` };
  if ((to - from) / scope.step + 2 > MAX_RULE_TIMES) {
    return { ok: false, reason: `the range has more than ${String(MAX_RULE_TIMES)} times: use a larger step` };
  }
  const times: RuleTime[] = [];
  for (let t = from; t < to; t += scope.step) times.push({ sequence: sequence.id, t });
  times.push({ sequence: sequence.id, t: to });
  return { ok: true, times };
}

/** The times of a scope. `sequences` gives the sequence documents by ID. */
export function scopeTimes(scope: RuleScope, sequences: Readonly<Record<string, RuleSequence>>): ScopeTimes {
  if (scope.kind === "scene" || scope.kind === "entity") return { ok: true, times: [SCENE_TIME] };
  if (scope.sequence === undefined) return { ok: false, reason: `a ${scope.kind} scope names no sequence` };
  const sequence = sequences[scope.sequence];
  if (sequence === undefined) return { ok: false, reason: `no sequence "${scope.sequence}"` };
  if (scope.kind === "sequence") return { ok: true, times: sequenceTimes(sequence) };
  if (scope.kind === "range") return rangeTimes(sequence, scope);
  const names = typeof scope.marker === "string" ? [scope.marker] : scope.marker;
  const times: RuleTime[] = [];
  for (const marker of names) {
    const t = sequence.markers?.[marker];
    if (t === undefined) return { ok: false, reason: `the sequence "${sequence.id}" has no marker "${marker}"` };
    times.push({ sequence: sequence.id, t, marker });
  }
  return { ok: true, times };
}

/** True when an item is about one of the entities: the entity, a sub-target `id#sub`, or a pair `a+b` with it. */
function itemOf(item: MetricItem, ids: ReadonlySet<string>): boolean {
  const parts = item.subject.split("+").map((part) => part.split("#")[0] ?? part);
  return parts.some((part) => ids.has(part));
}

/** The items of a metric for the entities of a selector, or null when the metric gives no items. */
export function entityItems(
  ctx: MetricContext,
  selector: string | readonly string[],
  items: readonly MetricItem[] | undefined,
): MetricItem[] | null {
  if (items === undefined) return null;
  const ids = new Set(ctx.select(selector));
  return items.filter((item) => itemOf(item, ids));
}

/** The words of a time: `scene`, `4500 ms`, or `4500 ms (reach)`. */
export function timeText(at: RuleTime): string {
  if (at.t === null) return "scene";
  return at.marker === undefined ? `${String(at.t)} ms` : `${String(at.t)} ms (${at.marker})`;
}
