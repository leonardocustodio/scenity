// SPDX-License-Identifier: Apache-2.0
/**
 * The objective of the layout search: a score from the rule margins and the move cost of a candidate. A lower score is
 * better. A null score puts the candidate out.
 *
 * The margin of a rule is the distance of its value from its limit, in the unit of the rule: `value − min`, or
 * `max − value`, the smaller of the two for a range. A negative margin is a failure.
 */
import type { Rule } from "@scenity/scene";
import type { RuleResult } from "./gate";

/** What the objective reads of a candidate. */
export interface ObjectiveInput {
  readonly rules: readonly Rule[];
  /** The results of the rules, in the order of the rules. */
  readonly results: readonly RuleResult[];
  /** The move cost: the sum of the distances of the moved groups from their start. */
  readonly move: number;
}

/** A score of a candidate (lower is better), or null when the candidate is out. */
export type SearchObjective = (input: ObjectiveInput) => number | null;

/** The smallest margin of a rule over the times of its result, or null with no limit or no value. */
export function ruleMargin(rule: Rule, result: RuleResult): number | null {
  let least: number | null = null;
  for (const time of result.times) {
    if (time.value === null) continue;
    const parts: number[] = [];
    if (rule.min !== undefined) parts.push(time.value - rule.min);
    if (rule.max !== undefined) parts.push(rule.max - time.value);
    if (parts.length === 0) return null;
    const margin = Math.min(...parts);
    least = least === null ? margin : Math.min(least, margin);
  }
  return least;
}

export interface MarginObjectiveOptions {
  /**
   * The margin under which a rule that passes is tight, in the unit of the rule, or a function of the rule (null:
   * the rule is never tight). Default 0: no rule is tight.
   */
  readonly tight?: number | ((rule: Rule) => number | null);
  /** The score of one unit of move cost (default 0.5; a tight rule scores 1). */
  readonly moveWeight?: number;
}

/**
 * The objective from the rule margins: a `block` rule that fails (or has an error) puts the candidate out. Each
 * tight rule that passes and each `warn` rule that fails scores 1. The move cost scores `moveWeight` per unit.
 */
export function marginObjective(options: MarginObjectiveOptions = {}): SearchObjective {
  const { tight = 0, moveWeight = 0.5 } = options;
  const tightOf = typeof tight === "number" ? () => tight : tight;
  return ({ rules, results, move }) => {
    let count = 0;
    for (const [index, result] of results.entries()) {
      const rule = rules[index];
      if (rule === undefined) continue;
      const failed = result.status === "fail" || result.status === "error";
      if (failed && rule.level === "block") return null;
      if (failed) count += 1;
      else if (result.status === "pass") {
        const limit = tightOf(rule);
        const margin = ruleMargin(rule, result);
        if (limit !== null && margin !== null && margin < limit) count += 1;
      }
    }
    return count + moveWeight * move;
  };
}
