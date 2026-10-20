// SPDX-License-Identifier: Apache-2.0
/**
 * The generic release gate. The project gives the rules (`release` of the project document):
 * the licences that it accepts, the rights review, the refused tags and the approval roles. The caller gives the
 * subjects: the assets with their rights records, and the assets with their approvals. The gate reads the rights
 * records and the licence register, and no other file.
 *
 * The checks:
 * - each rights record reads, allows web delivery and has a licence that the project accepts;
 * - with `rights.review`, each rights record has a reviewer and a done text review;
 * - no asset has a refused tag;
 * - each asset in the scope of a required role has an approval of that role that is approved and current.
 */
import { basename, isAbsolute, resolve } from "node:path";
import type { ApprovalRule, ReleaseConfig } from "@scenity/scene";
import { readRegister, rightsVerdict, type LicenceRegister } from "../rights/licenceRegister";
import { readRightsFile, type RightsRecord } from "../rights/records";
import type { Approval } from "./approval";

/** The check that gives a finding. */
export type ReleaseCheck = "record" | "rights" | "licence" | "tag" | "approval";

export interface ReleaseFinding {
  readonly level: "error" | "warning";
  readonly check: ReleaseCheck;
  /** The thing of the finding: an asset ID, a rights record name or a file. */
  readonly subject: string;
  /** The IDs of the assets that the finding stops. */
  readonly assets: readonly string[];
  readonly message: string;
}

/** An asset with its rights record. */
export interface RightsSubject {
  readonly id: string;
  readonly kind: string;
  readonly tags: readonly string[];
  /** The absolute path of the rights record. */
  readonly rights: string;
}

/** An asset with its approvals. */
export interface ApprovalSubject {
  readonly id: string;
  readonly kind: string;
  readonly tags: readonly string[];
  /** The current source hash of the asset, or null when the asset has no source. */
  readonly hash: string | null;
  readonly approvals: readonly Approval[];
}

/** The state of one role for one asset. Only `current` passes. */
export type ApprovalState = "current" | "missing" | "refused" | "stale";

type Report = (finding: Omit<ReleaseFinding, "level">) => void;

/** True when the rule applies to the asset: the asset matches each list of `appliesTo`. */
export function ruleApplies(rule: ApprovalRule, subject: { kind: string; tags: readonly string[] }): boolean {
  const kinds = rule.appliesTo?.kinds;
  const tags = rule.appliesTo?.tags;
  if (kinds !== undefined && !kinds.includes(subject.kind)) return false;
  return tags === undefined || tags.some((tag) => subject.tags.includes(tag));
}

/** The approval of a role that decides: the one with the latest date (the last one of the list on a tie). */
export function latestApproval(approvals: readonly Approval[], role: string): Approval | null {
  let latest: Approval | null = null;
  for (const approval of approvals) {
    if (approval.role !== role) continue;
    if (latest === null || (approval.date ?? "") >= (latest.date ?? "")) latest = approval;
  }
  return latest;
}

/** The state of a role for an asset: no approval, a verdict that is not `approved`, an old source hash, or current. */
export function approvalState(subject: ApprovalSubject, role: string): ApprovalState {
  const approval = latestApproval(subject.approvals, role);
  if (approval === null) return "missing";
  if (approval.verdict !== "approved") return "refused";
  return subject.hash !== null && approval.sourceHash === subject.hash ? "current" : "stale";
}

/** The checks of the rights records, the licences and the refused tags. `baseDir` resolves the register path. */
export function rightsGate(
  subjects: readonly RightsSubject[],
  config: ReleaseConfig,
  baseDir: string,
): ReleaseFinding[] {
  const findings: ReleaseFinding[] = [];
  const error: Report = (finding) => void findings.push({ level: "error", ...finding });
  const registerPath = config.licences?.register;
  let register: LicenceRegister | null = null;
  if (registerPath !== undefined) {
    const read = readRegister(isAbsolute(registerPath) ? registerPath : resolve(baseDir, registerPath));
    register = read.register;
    for (const message of read.problems) error({ check: "licence", subject: "register", assets: [], message });
  }
  for (const path of [...new Set(subjects.map((subject) => subject.rights))].sort()) {
    const users = subjects.filter((subject) => subject.rights === path);
    const assets = users.map((user) => user.id);
    const { record, problems } = readRightsFile(path);
    const subject = record?.name ?? basename(path).replace(/\.ya?ml$/u, "");
    for (const message of problems) error({ check: "rights", subject, assets, message });
    if (record === null) continue;
    const where = `rights record ${record.name}`;
    if (config.rights?.review === true) {
      if (record.textReview !== "done")
        error({ check: "rights", subject, assets, message: `${where}: the text review is open` });
      if (record.reviewer === null) error({ check: "rights", subject, assets, message: `${where}: no reviewer` });
    }
    if (record.webDelivery === "pending") {
      error({ check: "rights", subject, assets, message: `${where}: web delivery of the files is not confirmed yet` });
    }
    const kinds = [...new Set(users.map((user) => user.kind))].sort();
    const messages = new Set(kinds.flatMap((kind) => licenceProblems(record, kind, config, register)));
    for (const message of messages) error({ check: "licence", subject, assets, message: `${where}: ${message}` });
  }
  const denied = config.denyTags ?? [];
  for (const subject of subjects) {
    const tags = subject.tags.filter((tag) => denied.includes(tag));
    if (tags.length === 0) continue;
    const message = `an asset with the tag ${tags.join(", ")} cannot go into a release`;
    error({ check: "tag", subject: subject.id, assets: [subject.id], message });
  }
  return findings;
}

/**
 * The licence problems of a rights record for one asset kind: none when the SPDX ID of the record is in `allow`, or
 * when the register allows the source and the licence with no open facts.
 */
export function licenceProblems(
  record: RightsRecord,
  kind: string | null,
  config: ReleaseConfig,
  register: LicenceRegister | null,
): string[] {
  const allow = config.licences?.allow ?? [];
  if (record.spdx !== null && allow.includes(record.spdx)) return [];
  if (register === null) {
    if (allow.length === 0) return ["the project allows no licence (release.licences of the project document)"];
    const spdx = record.spdx === null ? "no SPDX ID" : `the SPDX ID ${record.spdx}`;
    return [`the record has ${spdx}; the project allows ${allow.join(", ")}`];
  }
  const verdict = rightsVerdict(register, { source: record.source, licence: record.licence, kind });
  if (!verdict.allowed) return [verdict.reason ?? "the licence register does not allow the record"];
  const problems: string[] = [];
  if (verdict.attribution && record.attribution === null) problems.push("the licence asks for the attribution text");
  if (verdict.open !== null) problems.push(`${verdict.entry ?? ""} is open: ${verdict.open}`);
  return problems;
}

/** The checks of the approvals: each required role of each asset in its scope is approved and current. */
export function approvalGate(subjects: readonly ApprovalSubject[], config: ReleaseConfig): ReleaseFinding[] {
  const findings: ReleaseFinding[] = [];
  const rules = config.approvals ?? [];
  const roles = new Set(rules.map((rule) => rule.role));
  for (const subject of subjects) {
    const report = (level: ReleaseFinding["level"], message: string): void =>
      void findings.push({ level, check: "approval", subject: subject.id, assets: [subject.id], message });
    for (const approval of subject.approvals) {
      if (approval.asset !== subject.id) report("error", `an approval names the asset ${approval.asset}`);
      if (!roles.has(approval.role)) report("warning", `the project has no approval role ${approval.role}`);
    }
    for (const rule of rules.filter((item) => ruleApplies(item, subject))) {
      const level = rule.required === false ? "warning" : "error";
      const message = stateMessage(subject, rule);
      if (message !== null) report(level, message);
    }
  }
  return findings;
}

function stateMessage(subject: ApprovalSubject, rule: ApprovalRule): string | null {
  const role = rule.label ?? rule.role;
  const approval = latestApproval(subject.approvals, rule.role);
  const by = approval === null ? "" : ` (${approval.reviewer}, ${approval.date ?? "no date"})`;
  switch (approvalState(subject, rule.role)) {
    case "current":
      return null;
    case "missing":
      return `no approval of the role ${role}`;
    case "refused":
      return `the approval of the role ${role} has the verdict ${approval?.verdict ?? ""}${by}`;
    case "stale":
      return subject.hash === null
        ? `the asset has no source, so the approval of the role ${role} is not current`
        : `the asset changed after the approval of the role ${role}${by}: review it again`;
  }
}

/** The findings sorted: errors first, then by check, subject and message. */
export function sortReleaseFindings(findings: readonly ReleaseFinding[]): ReleaseFinding[] {
  const key = (finding: ReleaseFinding): string =>
    `${finding.level === "error" ? "0" : "1"}\n${finding.check}\n${finding.subject}\n${finding.message}`;
  return [...findings].sort((a, b) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0));
}
