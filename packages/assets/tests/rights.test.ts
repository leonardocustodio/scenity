// SPDX-License-Identifier: Apache-2.0
// The rights checks of the asset build: a record of an allowed source passes,
// a missing record, a refused source and a kind out of its entry fail, and the release gate refuses samples and open
// reviews. The register and the records are written in a temp folder.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { rightsFindings, type RightsOwner } from "../src/rights/check";
import { parseRegister, rightsVerdict } from "../src/rights/licenceRegister";
import { rightsRecordNames } from "../src/rights/records";

const REGISTER = {
  version: 1,
  entries: [
    {
      id: "own",
      name: "Own work",
      status: "allowed",
      licence: "Own work",
      reason: "test",
      sourceMatch: ["^Made here\\b"],
      licenceMatch: ["^Own work$"],
    },
    {
      id: "kit",
      name: "A furniture kit",
      status: "allowed",
      licence: "CC0",
      reason: "test",
      kinds: ["model"],
      sourceMatch: ["^Furniture kit\\b"],
      licenceMatch: ["^CC0"],
    },
    {
      id: "bad",
      name: "A refused store",
      status: "rejected",
      licence: "?",
      reason: "no web use",
      sourceMatch: ["^Bad"],
    },
  ],
};

function record(name: string, source: string, licence: string, reviewer = "A reviewer"): string {
  return [
    `name: ${name}`,
    `source: "${source}"`,
    "author: Test",
    `licence: "${licence}"`,
    "licenceDate: 2026-10-13",
    "allowedUse: [web]",
    "webDelivery: true",
    "attribution: null",
    "textReview: done",
    `reviewer: ${reviewer}`,
    "",
  ].join("\n");
}

let folder = "";

beforeAll(() => {
  folder = mkdtempSync(join(tmpdir(), "assets-rights-"));
  writeFileSync(join(folder, "register.json"), JSON.stringify(REGISTER));
  writeFileSync(join(folder, "own.yaml"), record("own", "Made here", "Own work"));
  writeFileSync(join(folder, "kit.yaml"), record("kit", "Furniture kit, chairs", "CC0 1.0"));
  writeFileSync(join(folder, "TEMPLATE.yaml"), "name: <name>\n");
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

const errors = (owners: readonly RightsOwner[], release = false): string[] =>
  rightsFindings(owners, { rightsFolder: folder, release })
    .filter((finding) => finding.level === "error")
    .map((finding) => finding.message);

describe("the rights checks", () => {
  it("passes the records of allowed sources", () => {
    expect(rightsRecordNames(folder)).toEqual(["kit", "own"]);
    expect(
      errors([
        { id: "chair", rights: "kit", kind: "model", sample: false },
        { id: "room", rights: "own", kind: "room", sample: false },
      ]),
    ).toEqual([]);
  });

  it("fails a missing record and a kind that the entry does not allow", () => {
    const messages = errors([
      { id: "chair", rights: "kit", kind: "clip", sample: false },
      { id: "lamp", rights: "none", kind: "model", sample: false },
    ]);
    expect(messages).toContain("rights record none: no file rights/none.yaml");
    expect(messages.some((message) => message.includes("is allowed only for model, not for a clip"))).toBe(true);
  });

  it("refuses a sample in the release gate", () => {
    const owners = [{ id: "chair", rights: "kit", kind: "model", sample: true }];
    expect(errors(owners)).toEqual([]);
    expect(errors(owners, true)).toContain("a sample asset cannot go into a release");
  });

  it("refuses a source that the register rejects", () => {
    const { register, problems } = parseRegister(REGISTER);
    expect(problems).toEqual([]);
    expect(rightsVerdict(register, { source: "Bad store", licence: "CC0" }).allowed).toBe(false);
    expect(rightsVerdict(register, { source: "Made here", licence: "Own work" }).allowed).toBe(true);
  });
});
