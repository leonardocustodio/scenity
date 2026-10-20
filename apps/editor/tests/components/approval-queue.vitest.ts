// SPDX-License-Identifier: Apache-2.0
// The review queue of an approval role: the assets of the role. The work comes first (stale, not reviewed, not
// approved), then the approved assets by name.
import { describe, expect, it } from "vitest";
import { queueOf, waiting } from "../../src/assetBrowser/approvals/approvalQueue";
import type { ApprovalCell, ApprovalQueue } from "../../src/assetBrowser/assetTypes";

const cell = (state: ApprovalCell["state"]): ApprovalCell => ({
  state,
  verdict: state === "missing" ? null : state === "refused" ? "changes" : "approved",
  reviewer: null,
  date: null,
  note: null,
});

const QUEUE: ApprovalQueue = {
  roles: [{ role: "art", label: "Art", required: true }],
  assets: [
    { id: "A", name: "chair", kind: "model", roles: { art: cell("current") } },
    { id: "B", name: "lamp", kind: "model", roles: { art: cell("missing") } },
    { id: "C", name: "bench", kind: "model", roles: { art: cell("stale") } },
    { id: "D", name: "sky", kind: "environment", roles: {} },
    { id: "E", name: "armchair", kind: "model", roles: { art: cell("refused") } },
    { id: "F", name: "table", kind: "model", roles: { art: cell("missing") } },
  ],
};

describe("the review queue of a role", () => {
  it("puts the work first and leaves out the assets that the role does not apply to", () => {
    const rows = queueOf(QUEUE, "art");
    expect(rows.map((row) => row.asset.name)).toEqual(["bench", "lamp", "table", "armchair", "chair"]);
    expect(waiting(rows)).toBe(4);
    expect(queueOf(QUEUE, "audio")).toEqual([]);
    expect(queueOf(null, "art")).toEqual([]);
  });
});
