// SPDX-License-Identifier: Apache-2.0
// The generic release gate: the showroom passes with its rights record; a licence out of the rules, a
// missing rights record, a refused tag, a missing, refused or stale approval and a bad approval record fail it. The
// tests change copies of the showroom in temp folders.
import { afterEach, describe, expect, it } from "bun:test";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson, type ReleaseConfig } from "@scenity/scene";
import { runCli } from "../src/cli";
import { AssetDatabase } from "../src/database";
import { readAssetRecord, writeAssetRecord } from "../src/record";
import {
  approvalState,
  readApprovalText,
  releaseCheck,
  writeApprovalRecord,
  type ApprovalRecord,
  type ReleaseReport,
} from "../src/release";
import { copyShowroom, put, putAsset, removeTemps, SHOWROOM, tempProject } from "./helpers";

afterEach(removeTemps);

const SHELF = "assets/sources/Shelf_01/Shelf_01_1k.gltf";
const FURNITURE = 6;

function setRelease(dir: string, release: ReleaseConfig | undefined): void {
  const path = join(dir, "scenity.project.json");
  const project = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  writeFileSync(path, canonicalJson({ ...project, release }));
}

/** Add approval record paths to the record of a source. */
function listApprovals(dir: string, source: string, approvals: string[]): void {
  const path = join(dir, `${source}.meta.json`);
  const read = readAssetRecord(readFileSync(path, "utf8"));
  if (!read.ok) throw new Error("bad record");
  writeFileSync(path, writeAssetRecord({ ...read.record, approvals }));
}

async function shelf(dir: string): Promise<{ id: string; hash: string }> {
  const entry = (await AssetDatabase.open(dir)).findByPath(SHELF);
  if (entry?.hash == null) throw new Error("no shelf");
  return { id: entry.id, hash: entry.hash };
}

function approval(fields: Partial<ApprovalRecord> & Pick<ApprovalRecord, "asset" | "sourceHash">): ApprovalRecord {
  return {
    format: "scenity.approval/1",
    role: "art",
    reviewer: "A. Reviewer",
    date: "2026-10-15",
    verdict: "approved",
    ...fields,
  };
}

function errorsOf(report: ReleaseReport): string[] {
  return report.findings.filter((finding) => finding.level === "error").map((finding) => finding.message);
}

/** The asset IDs that an error stops. */
function stopped(report: ReleaseReport): Set<string> {
  return new Set(report.findings.filter((finding) => finding.level === "error").flatMap((finding) => finding.assets));
}

describe("the release gate of the showroom", () => {
  it("passes with the CC0 rights record and no approval roles", async () => {
    const report = await releaseCheck(SHOWROOM);
    expect(report).toMatchObject({ project: "showroom", assets: 7, passed: true });
    expect(report.findings).toEqual([]);
  });

  it("runs as release-check in the CLI", async () => {
    const result = await runCli(["release-check", SHOWROOM]);
    expect(result.code).toBe(0);
    expect(result.out.at(-1)).toBe("release gate showroom: 7 assets, 0 errors, 0 warnings: passed");
    expect((await runCli(["release-check"])).code).toBe(2);
    expect((await runCli(["release-check", join(SHOWROOM, "nothing")])).code).toBe(2);
  });

  it("fails when the project does not allow the licence, or gives no licence rule", async () => {
    const dir = copyShowroom();
    setRelease(dir, { licences: { allow: ["CC-BY-4.0"] } });
    const report = await releaseCheck(dir);
    expect(report.passed).toBe(false);
    expect(stopped(report).size).toBe(7);
    expect(errorsOf(report)).toEqual([
      "rights record polyhaven: the record has the SPDX ID CC0-1.0; the project allows CC-BY-4.0",
    ]);
    setRelease(dir, undefined);
    expect(errorsOf(await releaseCheck(dir))[0]).toContain("the project allows no licence");
    const cli = await runCli(["release-check", dir, "--json"]);
    expect(cli.code).toBe(1);
    expect((JSON.parse(cli.out[0] ?? "{}") as ReleaseReport).passed).toBe(false);
  });

  it("fails for a missing rights record and for a refused tag", async () => {
    const dir = copyShowroom();
    setRelease(dir, { licences: { allow: ["CC0-1.0"] }, denyTags: ["studio"] });
    const read = readAssetRecord(readFileSync(join(dir, `${SHELF}.meta.json`), "utf8"));
    if (!read.ok) throw new Error("bad record");
    writeFileSync(join(dir, `${SHELF}.meta.json`), writeAssetRecord({ ...read.record, rights: "nothing.yaml" }));
    const report = await releaseCheck(dir);
    expect(report.findings.map((finding) => `${finding.check} ${finding.subject}`).sort()).toEqual([
      "rights nothing",
      "tag 01M4ZPXYG6S1R09H3MDXC5VXKQ",
    ]);
    expect(stopped(report)).toEqual(new Set([read.record.id, "01M4ZPXYG6S1R09H3MDXC5VXKQ"]));
  });
});

describe("approvals in the release gate", () => {
  const rules: ReleaseConfig = {
    licences: { allow: ["CC0-1.0"] },
    approvals: [{ role: "art", label: "art review", appliesTo: { tags: ["furniture"] } }],
  };

  it("needs a current approval of each required role for each asset in the scope", async () => {
    const dir = copyShowroom();
    setRelease(dir, rules);
    const missing = await releaseCheck(dir);
    expect(missing.passed).toBe(false);
    expect(stopped(missing).size).toBe(FURNITURE);
    expect(errorsOf(missing)).toContain("no approval of the role art review");

    // Only the shelf gets an approval: the other five furniture assets still fail.
    const { id, hash } = await shelf(dir);
    put(dir, "approvals/shelf-art.json", writeApprovalRecord(approval({ asset: id, sourceHash: hash })));
    listApprovals(dir, SHELF, ["../../../approvals/shelf-art.json"]);
    const one = await releaseCheck(dir);
    expect(stopped(one).size).toBe(FURNITURE - 1);
    expect(stopped(one).has(id)).toBe(false);

    // A change of the source makes the approval stale.
    const gltf = join(dir, SHELF);
    writeFileSync(gltf, `${readFileSync(gltf, "utf8")} `);
    const stale = await releaseCheck(dir);
    expect(stopped(stale).has(id)).toBe(true);
    expect(errorsOf(stale).some((message) => message.startsWith("the asset changed after the approval"))).toBe(true);
  });

  it("refuses a verdict that is not approved, and the latest approval decides", async () => {
    const dir = copyShowroom();
    setRelease(dir, { ...rules, approvals: [{ role: "art", appliesTo: { kinds: ["model"] } }] });
    const { id, hash } = await shelf(dir);
    put(dir, "approvals/a.json", writeApprovalRecord(approval({ asset: id, sourceHash: hash, date: "2026-10-01" })));
    put(
      dir,
      "approvals/b.yaml",
      `format: scenity.approval/1\nasset: ${id}\nrole: art\nreviewer: B\ndate: 2026-10-02\nverdict: changes\n` +
        `sourceHash: ${hash}\nnote: The legs float.\n`,
    );
    listApprovals(dir, SHELF, ["../../../approvals/a.json", "../../../approvals/b.yaml"]);
    const report = await releaseCheck(dir);
    expect(errorsOf(report)).toContain("the approval of the role art has the verdict changes (B, 2026-10-02)");
  });

  it("gives warnings only for a role that is not required", async () => {
    const dir = copyShowroom();
    setRelease(dir, { ...rules, approvals: [{ role: "art", required: false }] });
    const report = await releaseCheck(dir);
    expect(report.passed).toBe(true);
    expect(report.findings).toHaveLength(7);
  });

  it("fails for a bad approval record and for an approval of another asset", async () => {
    const dir = copyShowroom();
    setRelease(dir, rules);
    const { hash } = await shelf(dir);
    put(dir, "approvals/other.json", writeApprovalRecord(approval({ asset: "0123456789AB", sourceHash: hash })));
    put(dir, "approvals/bad.json", `{"format":"scenity.approval/1","asset":"x"}`);
    listApprovals(dir, SHELF, ["../../../approvals/other.json", "../../../approvals/bad.json", "../../../none.json"]);
    const errors = errorsOf(await releaseCheck(dir));
    expect(errors).toContain("an approval names the asset 0123456789AB");
    expect(errors.some((message) => message.includes("approvals/bad.json: /asset"))).toBe(true);
    expect(errors.some((message) => message.endsWith("none.json: no file"))).toBe(true);
  });
});

describe("the approval record", () => {
  const hash = "a".repeat(64);

  it("reads YAML and JSON, and writes canonical JSON", () => {
    const record = approval({ asset: "0123456789AB", sourceHash: hash, note: "Fine." });
    const text = writeApprovalRecord(record);
    expect(readApprovalText(text)).toEqual({ record, problems: [] });
    const yaml = `format: scenity.approval/1\nasset: 0123456789AB\nrole: art\nreviewer: A. Reviewer\ndate: 2026-10-15\nverdict: approved\nsourceHash: ${hash}\nnote: Fine.\n`;
    expect(readApprovalText(yaml).record).toEqual(record);
    expect(readApprovalText("verdict: maybe").problems.length).toBeGreaterThan(0);
    expect(() => writeApprovalRecord({ ...record, date: "15.10.2026" })).toThrow("not an approval record");
  });

  it("gives the state of a role: missing, refused, stale or current", () => {
    const subject = { id: "0123456789AB", kind: "model", tags: [], hash, approvals: [] };
    expect(approvalState(subject, "art")).toBe("missing");
    const current = approval({ asset: subject.id, sourceHash: hash });
    expect(approvalState({ ...subject, approvals: [current] }, "art")).toBe("current");
    expect(approvalState({ ...subject, approvals: [current], hash: "b".repeat(64) }, "art")).toBe("stale");
    expect(approvalState({ ...subject, approvals: [{ ...current, verdict: "rejected" }] }, "art")).toBe("refused");
  });
});

describe("a licence register in the release rules", () => {
  it("allows a source and a licence of an allowed register entry", async () => {
    const dir = tempProject();
    const register = {
      version: 1,
      entries: [
        {
          id: "kit",
          name: "A kit",
          status: "allowed",
          licence: "Kit licence",
          reason: "test",
          sourceMatch: ["^Kit shop\\b"],
          licenceMatch: ["^Kit licence$"],
        },
      ],
    };
    put(dir, "rights/register.json", JSON.stringify(register));
    const rights = (source: string): string =>
      `name: kit\nsource: ${source}\nauthor: Test\nlicence: Kit licence\nlicenceDate: 2026-10-15\nallowedUse: [web]\nwebDelivery: true\n`;
    put(dir, "rights/kit.yaml", rights("Kit shop"));
    putAsset(dir, "assets/chair.glb", "0123456789AB", { rights: "../rights/kit.yaml" });
    setRelease(dir, { licences: { register: "rights/register.json" } });
    expect((await releaseCheck(dir)).passed).toBe(true);
    put(dir, "rights/kit.yaml", rights("Other shop"));
    const report = await releaseCheck(dir);
    expect(report.passed).toBe(false);
    expect(errorsOf(report)[0]).toContain('the source "Other shop" is not in the licence register');
  });
});
