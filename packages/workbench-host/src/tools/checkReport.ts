// SPDX-License-Identifier: Apache-2.0
/**
 * The lines of a check report of the lab API `check(times?)`: the failures (metric, member, value, limit, time), the
 * known gaps and the worst value of each check. The context packet, the stop gate and the
 * check tool of a plugin use them. `tool` is the name of that check tool for the hint of a cut list.
 */
import { cut, fmt, list, number, record, text } from "./kit";

/** A failure of the check report as text: `FAIL hands.toTarget (bo) 0.19 > max 0.16 at 6350 ms`. */
export function failureLine(value: unknown, verdict = "FAIL"): string {
  const item = record(value);
  const amount = number(item.value);
  const at = number(item.at);
  const member = text(item.member);
  const check = text(item.check) ?? text(item.metric) ?? "?";
  const named = member === null || check.includes(`(${member})`) ? check : `${check} (${member})`;
  const known = text(item.known);
  return [
    `${verdict} ${named} ${amount === null ? "?" : fmt(amount)} vs ${text(item.limit) ?? "?"}`,
    at === null ? "" : ` at ${String(at)} ms`,
    known === null ? "" : ` — known: ${known}`,
  ].join("");
}

/** The report of `check` in short lines: the summary, the failures, the known gaps and the worst values. */
export function checkLines(report: unknown, options: { failures: number; worst: number; tool?: string }): string[] {
  const tool = options.tool ?? "";
  const data = record(report);
  if (data.applies === false) {
    return [`Checks: none (${text(data.reason) ?? "the source has no checks"}).`];
  }
  const failures = list(data.failures);
  const known = list(data.known);
  const worst = list(data.worst).filter((item) => record(item).pass === true && number(record(item).value) !== null);
  const panel = number(data.panelEvents) ?? 0;
  const lines = [`Checks: ${text(data.summary) ?? "no summary"}.`];
  if (panel > 0) lines.push(`Note: ${String(panel)} panel events after the take; labs motion checks the plain take.`);
  lines.push(...cut(failures, options.failures, (item) => `  ${failureLine(item)}`, tool));
  lines.push(...cut(known, 3, (item) => `  ${failureLine(item, "KNOWN")}`, tool));
  if (options.worst > 0 && worst.length > 0) {
    lines.push("Worst values of the checks that pass:");
    lines.push(...cut(worst, options.worst, (item) => `  ${failureLine(item, "ok")}`, tool));
  }
  return lines;
}
