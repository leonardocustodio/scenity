// SPDX-License-Identifier: Apache-2.0
/**
 * The rows of the rules panel of the scene page from the results of the rule check of the core, and the request of the
 * metric graph of one rule. No Vue import: the panel and the tests read it.
 */
import type { Rule, SceneDocument } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { RuleResult } from "@scenity/rules";
import type { SceneRuleVerdict } from "@scenity/cli/sceneFileContract";
import { rowOf, ruleEntities, type RuleRow } from "../../core/rules/ruleRows";
import { samplingRules, seriesOf, type RuleSeries } from "../../core/rules/ruleSeries";
import type { PageRuleSet } from "../pageRules";
import { t } from "../../texts";

/** The tags of each entity of a scene that has tags. */
function tagsOf(doc: SceneDocument): Map<string, readonly string[]> {
  const tags = new Map<string, readonly string[]>();
  for (const [id, entity] of Object.entries(doc.entities)) if (entity.tags !== undefined) tags.set(id, entity.tags);
  return tags;
}

/** The rows of the results of a rule set; `problems` are the rules files that do not read (an error row each). */
export function sceneRuleRows(
  set: PageRuleSet,
  results: readonly RuleResult[],
  doc: SceneDocument,
  problems: readonly SceneRuleVerdict[] = [],
): RuleRow[] {
  const ids = Object.keys(doc.entities);
  const tags = tagsOf(doc);
  const rows = set.rules.flatMap(({ rule, source }, index): RuleRow[] => {
    const result = results[index];
    return result === undefined ? [] : [rowOf(result, rule, source, ruleEntities(rule, ids, tags))];
  });
  const broken = problems.map((problem): RuleRow => ({
    id: problem.id,
    source: problem.id,
    scope: t("rules-scope-file"),
    level: problem.level,
    provisional: false,
    known: null,
    status: problem.status,
    value: null,
    unit: null,
    limit: "",
    detail: problem.detail ?? "",
    note: null,
    entities: [],
    worst: null,
    sequence: null,
  }));
  return [...rows, ...broken];
}

/** The rule of a row ID in a rule set, or undefined. */
export function ruleOfRow(set: PageRuleSet, id: string): Rule | undefined {
  return set.rules.find((item) => item.rule.id === id)?.rule;
}

/** The rules of the graph request of a rule: the rule and its sampling copies over the sequence. */
export function graphRules(rule: Rule, sequence: SequenceDocument): Rule[] {
  return [rule, ...samplingRules(rule, sequence)];
}

/** The graph data from the results of a graph request (the first result is the rule itself). */
export function graphSeries(results: readonly RuleResult[], sequence: SequenceDocument): RuleSeries | null {
  const [own, ...samples] = results;
  return own === undefined ? null : seriesOf(own, samples, sequence, own.limit);
}
