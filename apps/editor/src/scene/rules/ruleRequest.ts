// SPDX-License-Identifier: Apache-2.0
/**
 * "Save as a rule": a readout of a layout tool asks the Rules panel to open the rules editor with the draft of a rule
 * (the metric, its arguments and the current value as the limit). The panel shows and reads the
 * request.
 */
import { shallowRef } from "vue";
import { currentShell } from "../../studio/shell/shell";
import { draftFromValue, metricChoices, type RuleDraft } from "./ruleForm";

/** The last request; `count` makes a second request with the same draft a change. */
export const ruleRequest = shallowRef<{ readonly draft: RuleDraft; readonly count: number } | null>(null);

/** Ask for a rule of a metric with the current value. False when the library has no such metric. */
export function askRule(metric: string, args: unknown, value: number): boolean {
  const choice = metricChoices().find((each) => each.id === metric);
  if (choice === undefined) return false;
  ruleRequest.value = { draft: draftFromValue(choice, args, value), count: (ruleRequest.value?.count ?? 0) + 1 };
  currentShell()?.showPanel("rules");
  return true;
}
