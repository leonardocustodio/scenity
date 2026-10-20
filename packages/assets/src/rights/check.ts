// SPDX-License-Identifier: Apache-2.0
/**
 * The rights checks of the asset build. The project gives the
 * owners of rights records (its assets and rooms, with their kinds) and the rights folder. The checks:
 *
 * - every record that an owner names exists and allows web delivery;
 * - an open text review, a missing reviewer and a pending web delivery are warnings, and errors in the release gate;
 * - the licence register: every record of the folder names an allowed source and licence;
 * - the release gate refuses a sample asset.
 */
import { join } from "node:path";
import type { Finding } from "../build/checks";
import { REGISTER_FILE } from "./licenceRegister";
import { readRights, registerFindings } from "./records";

/** An asset or a room of the project with its rights record. */
export interface RightsOwner {
  readonly id: string;
  readonly rights: string;
  /** The asset kind for the licence register (an entry with `kinds` allows only those kinds). */
  readonly kind: string;
  /** A sample asset: the release gate refuses it. */
  readonly sample: boolean;
}

export interface RightsCheckOptions {
  readonly rightsFolder: string;
  /** The licence register (default `register.json` in the rights folder). */
  readonly registerFile?: string;
  readonly release: boolean;
}

/** The findings of the rights checks, in the order of the checks. */
export function rightsFindings(owners: readonly RightsOwner[], options: RightsCheckOptions): Finding[] {
  const findings: Finding[] = [];
  const error = (asset: string, message: string): void => void findings.push({ level: "error", asset, message });
  const warn = (asset: string, message: string): void => void findings.push({ level: "warning", asset, message });
  const gate = options.release ? error : warn;
  // A record problem is reported once for the record, with the number of assets that use it.
  for (const name of [...new Set(owners.map((owner) => owner.rights))].sort()) {
    const users = owners.filter((owner) => owner.rights === name);
    const where = users.length === 1 ? (users[0]?.id ?? name) : `${name} (${String(users.length)} assets)`;
    const result = readRights(name, options.rightsFolder);
    for (const problem of result.problems) error(where, problem);
    if (result.record === null) continue;
    if (result.record.textReview !== "done") gate(where, `rights record ${name}: the text review is open`);
    if (result.record.reviewer === null) gate(where, `rights record ${name}: no reviewer`);
    if (result.record.webDelivery === "pending") {
      gate(where, `rights record ${name}: web delivery of the files is not confirmed yet`);
    }
  }
  // The licence register: every record of the folder, with the kinds of the assets that use it.
  const kindsOf = (name: string): string[] => [
    ...new Set(owners.filter((owner) => owner.rights === name).map((owner) => owner.kind)),
  ];
  const register = options.registerFile ?? join(options.rightsFolder, REGISTER_FILE);
  for (const finding of registerFindings(kindsOf, options.rightsFolder, register)) {
    (finding.level === "error" ? error : gate)(finding.record, finding.message);
  }
  if (options.release) {
    for (const owner of owners.filter((item) => item.sample))
      error(owner.id, "a sample asset cannot go into a release");
  }
  return findings;
}
