// SPDX-License-Identifier: Apache-2.0
/**
 * The check job of the page: `scenity check --json` on the dev server (scripts/checkApi.ts). The rows that do not pass
 * go into the Problems panel; the Rules panel compares the status of each rule of the open scene with the status of the
 * page check.
 */
import { ref, shallowRef } from "vue";
import { IMPORT_HEADER } from "../../assetBrowser/assetTypes";
import { t } from "../../texts";
import type { Problem } from "./problemList";

/** One row of `scenity check --json`: one rule of one scene at one time of its scope. */
export interface CheckRow {
  readonly scene: string;
  readonly sequence: string | null;
  readonly rule: string;
  readonly metric: string;
  readonly level: "block" | "warn";
  readonly status: string;
  readonly scope: string;
  readonly time: string;
  readonly value: number | null;
  readonly unit: string | null;
  readonly limit: string | null;
  readonly detail: string;
}

/** The last report of the page, or null before the first run. */
export const checkReport = shallowRef<{ readonly rows: readonly CheckRow[]; readonly code: number } | null>(null);
export const checkBusy = ref(false);

/** Run the check job for the project folder `base`. The result is null, or the reason of a run with no report. */
export async function runCheckJob(base: string): Promise<string | null> {
  checkBusy.value = true;
  try {
    const response = await fetch(`${base}check.run`, { method: "POST", headers: { [IMPORT_HEADER]: "1" } });
    const answer = (await response.json()) as {
      ok: boolean;
      reason?: string;
      code?: number;
      report?: { rows?: CheckRow[] };
    };
    if (!answer.ok) return answer.reason ?? t("check-failed");
    checkReport.value = { rows: answer.report?.rows ?? [], code: answer.code ?? 1 };
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  } finally {
    checkBusy.value = false;
  }
}

/** The order of the statuses from the worst: the status of a rule over its times is the worst one. */
const ORDER = ["error", "fail", "known", "pass", "n/a"];
const rank = (status: string): number => (ORDER.includes(status) ? ORDER.indexOf(status) : 0);

/** The status of each rule of a scene over its times (the worst one). */
export function ruleStatuses(rows: readonly CheckRow[], scene: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const row of rows) {
    if (row.scene !== scene) continue;
    const old = out.get(row.rule);
    if (old === undefined || rank(row.status) < rank(old)) out.set(row.rule, row.status);
  }
  return out;
}

/** The rules of the scene whose status in the check differs from the status of the page. */
export function differences(
  rows: readonly CheckRow[],
  scene: string,
  page: readonly { readonly id: string; readonly status: string }[],
): string[] {
  const cli = ruleStatuses(rows, scene);
  const ids = new Set([...cli.keys(), ...page.map((row) => row.id)]);
  const pageStatus = new Map(page.map((row) => [row.id, row.status]));
  return [...ids].filter((id) => cli.get(id) !== pageStatus.get(id)).sort();
}

/** The rows of the check that do not pass, as problems. */
export function checkProblems(rows: readonly CheckRow[]): Problem[] {
  return rows
    .filter((row) => row.status === "fail" || row.status === "error")
    .map((row) => ({
      key: `check:${row.scene}:${row.rule}:${row.time}`,
      kind: "rule" as const,
      level: row.level === "block" || row.status === "error" ? ("error" as const) : ("warn" as const),
      title: t("problem-check", { rule: row.rule, scene: row.scene, time: row.time }),
      detail: row.detail,
      entities: [],
      time: null,
      file: row.scene,
      fixes: [],
    }));
}
