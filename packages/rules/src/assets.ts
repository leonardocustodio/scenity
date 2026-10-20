// SPDX-License-Identifier: Apache-2.0
/**
 * The release state of the assets for the metric `assetRights`, from the findings of the release gate
 * (`@scenity/assets/release`). The finding type is structural, so this package does not import the asset tools. These
 * tools need Bun and the file system.
 */
import type { AssetStatus } from "./context";

/** A finding of the release gate: its level, the assets that it stops and its message. */
export interface ReleaseFindingLike {
  readonly level: "error" | "warning";
  readonly assets: readonly string[];
  readonly message: string;
}

/** The state of each asset: allowed when no error finding names it. The problems are the messages of the errors. */
export function assetStatuses(ids: readonly string[], findings: readonly ReleaseFindingLike[]): AssetStatus[] {
  return ids.map((id) => {
    const problems = findings
      .filter((finding) => finding.level === "error" && finding.assets.includes(id))
      .map((finding) => finding.message);
    return { id, allowed: problems.length === 0, problems };
  });
}
