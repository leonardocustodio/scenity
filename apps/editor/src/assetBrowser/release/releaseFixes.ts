// SPDX-License-Identifier: Apache-2.0
/**
 * The groups and the fixes of the release check panel: the findings of the release gate by
 * asset (the findings of the project come first), and for each check the panel that fixes it: the Rights panel for
 * a rights record or a licence, the Approvals panel for an approval, the asset browser for a record or a tag. Pure
 * functions, no DOM.
 */
import type { ReleaseFindingInfo } from "../assetTypes";

/** The findings of one asset, or of the project (`id` null: a finding that stops no asset). */
export interface ReleaseGroup {
  readonly id: string | null;
  readonly findings: readonly ReleaseFindingInfo[];
  readonly errors: number;
}

/** The findings by asset: a finding that stops many assets is in the group of each one. */
export function releaseGroups(findings: readonly ReleaseFindingInfo[]): ReleaseGroup[] {
  const groups = new Map<string | null, ReleaseFindingInfo[]>();
  for (const finding of findings) {
    const ids = finding.assets.length === 0 ? [null] : finding.assets;
    for (const id of ids) groups.set(id, [...(groups.get(id) ?? []), finding]);
  }
  return [...groups]
    .map(([id, list]) => ({ id, findings: list, errors: list.filter((each) => each.level === "error").length }))
    .sort((a, b) => (a.id === null ? -1 : b.id === null ? 1 : b.errors - a.errors || a.id.localeCompare(b.id)));
}

/** The fix of a check: the panel that fixes it and the Fluent ID of its button. */
export interface ReleaseFix {
  readonly panel: "rights" | "approvals" | "project";
  readonly label: string;
}

/** The fix of a finding. */
export function releaseFix(finding: Pick<ReleaseFindingInfo, "check">): ReleaseFix {
  switch (finding.check) {
    case "rights":
    case "licence":
      return { panel: "rights", label: "release-fix-rights" };
    case "approval":
      return { panel: "approvals", label: "release-fix-approval" };
    case "record":
    case "tag":
      return { panel: "project", label: "release-fix-asset" };
  }
}
