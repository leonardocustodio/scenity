// SPDX-License-Identifier: Apache-2.0
/**
 * The review queue of one approval role: the assets that the role applies to. The assets to review are first (no
 * approval, a stale approval after a source change, a verdict that is not "approved"). The current assets are last.
 * The name of the reviewer stays in the browser storage. Pure functions and no DOM, but the functions use the storage.
 */
import type { ApprovalAsset, ApprovalCell, ApprovalQueue, ApprovalStateName } from "../assetTypes";

/** The order of the states in the queue: the work first. */
const ORDER: Readonly<Record<ApprovalStateName, number>> = { stale: 0, missing: 1, refused: 2, current: 3 };

/** One row of the queue of a role. */
export interface QueueRow {
  readonly asset: ApprovalAsset;
  readonly cell: ApprovalCell;
}

/** The rows of the queue of a role: the assets that it applies to, the work first, then by name. */
export function queueOf(queue: ApprovalQueue | null, role: string): QueueRow[] {
  return (queue?.assets ?? [])
    .flatMap((asset) => {
      const cell = asset.roles[role];
      return cell === undefined ? [] : [{ asset, cell }];
    })
    .sort((a, b) => ORDER[a.cell.state] - ORDER[b.cell.state] || a.asset.name.localeCompare(b.asset.name));
}

/** The count of the rows that wait for a review (all rows other than the current rows). */
export function waiting(rows: readonly QueueRow[]): number {
  return rows.filter((row) => row.cell.state !== "current").length;
}

/** The storage key of the name of the reviewer. */
export const REVIEWER_KEY = "scenity.approvals.reviewer";

export function readReviewer(): string {
  try {
    return localStorage.getItem(REVIEWER_KEY) ?? "";
  } catch {
    return "";
  }
}

export function writeReviewer(name: string): void {
  try {
    localStorage.setItem(REVIEWER_KEY, name);
  } catch {
    // A page with no storage asks for the name again.
  }
}
