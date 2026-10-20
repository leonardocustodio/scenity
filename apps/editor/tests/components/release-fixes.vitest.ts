// SPDX-License-Identifier: Apache-2.0
// The release check panel: the findings of the gate by asset (the project first, then the assets with the most errors),
// and the panel that fixes each check.
import { describe, expect, it } from "vitest";
import type { ReleaseFindingInfo } from "../../src/assetBrowser/assetTypes";
import { releaseFix, releaseGroups } from "../../src/assetBrowser/release/releaseFixes";

const finding = (check: ReleaseFindingInfo["check"], assets: string[], level: "error" | "warning" = "error") =>
  ({ level, check, subject: assets[0] ?? "register", assets, message: `${check} ${assets.join(",")}` }) as const;

describe("the release check panel", () => {
  it("groups the findings by asset and gives each check its fix", () => {
    const groups = releaseGroups([
      finding("approval", ["B"]),
      finding("rights", ["A", "B"]),
      finding("licence", []),
      finding("tag", ["A"], "warning"),
    ]);
    expect(groups.map((group) => [group.id, group.errors, group.findings.length])).toEqual([
      [null, 1, 1],
      ["B", 2, 2],
      ["A", 1, 2],
    ]);
    expect(releaseFix({ check: "licence" }).panel).toBe("rights");
    expect(releaseFix({ check: "approval" }).panel).toBe("approvals");
    expect(releaseFix({ check: "record" }).panel).toBe("project");
  });
});
