// SPDX-License-Identifier: Apache-2.0
/**
 * The release gate of a project folder. The asset database gives the assets: the rights record and the
 * approval records of each asset record. The project document gives the rules (`release`). A problem of the asset
 * database (a bad record, a missing source, a broken reference) also stops the release.
 */
import { dirname, join } from "node:path";
import { AssetDatabase } from "../database";
import type { AssetEntry } from "../types";
import { readApprovalFile, type Approval } from "./approval";
import {
  approvalGate,
  rightsGate,
  sortReleaseFindings,
  type ApprovalSubject,
  type ReleaseFinding,
  type RightsSubject,
} from "./gate";

export interface ReleaseReport {
  readonly project: string;
  readonly assets: number;
  /** Sorted: errors first. */
  readonly findings: readonly ReleaseFinding[];
  /** True when no finding is an error. */
  readonly passed: boolean;
}

/** The absolute path of a path that a record names (relative to the record). */
function besideRecord(db: AssetDatabase, entry: AssetEntry, path: string): string {
  return join(db.dir, dirname(entry.recordPath), path);
}

/** The approvals of an asset from the approval records that its record lists. */
async function approvalsOf(db: AssetDatabase, entry: AssetEntry, findings: ReleaseFinding[]): Promise<Approval[]> {
  const approvals: Approval[] = [];
  for (const path of entry.record.approvals ?? []) {
    const where = join(dirname(entry.recordPath), path);
    const { record, problems } = await readApprovalFile(besideRecord(db, entry, path), where);
    for (const message of problems) {
      findings.push({ level: "error", check: "record", subject: entry.id, assets: [entry.id], message });
    }
    if (record !== null) approvals.push(record);
  }
  return approvals;
}

/** Run the release gate of an open asset database. */
export async function releaseCheckOf(db: AssetDatabase): Promise<ReleaseReport> {
  const config = db.project.release ?? {};
  const findings: ReleaseFinding[] = db.problems().map((problem) => ({
    level: "error",
    check: "record",
    subject: problem.id ?? problem.file,
    assets: problem.id === undefined ? [] : [problem.id],
    message: `${problem.code}: ${problem.file}: ${problem.message}`,
  }));
  const entries = db.entries();
  const rights: RightsSubject[] = entries.map((entry) => ({
    id: entry.id,
    kind: entry.kind,
    tags: entry.tags,
    rights: besideRecord(db, entry, entry.record.rights),
  }));
  const approvals: ApprovalSubject[] = [];
  for (const entry of entries) {
    const list = await approvalsOf(db, entry, findings);
    approvals.push({ id: entry.id, kind: entry.kind, tags: entry.tags, hash: entry.hash, approvals: list });
  }
  findings.push(...rightsGate(rights, config, db.dir), ...approvalGate(approvals, config));
  const sorted = sortReleaseFindings(findings);
  return {
    project: db.project.id,
    assets: entries.length,
    findings: sorted,
    passed: !sorted.some((finding) => finding.level === "error"),
  };
}

/** Open the asset database of a project folder and run its release gate. */
export async function releaseCheck(projectDir: string): Promise<ReleaseReport> {
  return releaseCheckOf(await AssetDatabase.open(projectDir));
}
