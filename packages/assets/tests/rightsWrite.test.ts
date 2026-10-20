// SPDX-License-Identifier: Apache-2.0
// The writer of a rights record: a record from a form reads again with the problems of the release
// gate; a bad name, a missing field, a bad date and a record that exists are refusals.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRightsFile, rightsSummaries, writeRightsRecord, type RightsInput } from "../src/rights/index";

const temp = mkdtempSync(join(tmpdir(), "scenity-rights-write-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const INPUT: RightsInput = {
  name: "kenney",
  source: "Kenney, https://kenney.nl",
  author: "Kenney",
  licence: "CC0 1.0 Universal",
  spdx: "CC0-1.0",
  licenceDate: "2026-10-18",
  allowedUse: ["web", "public"],
  webDelivery: true,
};

describe("the writer of a rights record", () => {
  test("writes a record that reads again with no problem, and lists it", () => {
    const result = writeRightsRecord(temp, INPUT);
    expect(result).toEqual({ ok: true, path: "rights/kenney.yaml", problems: [] });
    const read = readRightsFile(join(temp, "rights/kenney.yaml"));
    expect(read.record).toMatchObject({
      name: "kenney",
      spdx: "CC0-1.0",
      allowedUse: ["web", "public"],
      webDelivery: true,
    });
    expect(readFileSync(join(temp, "rights/kenney.yaml"), "utf8")).toContain('source: "Kenney, https://kenney.nl"');
    expect(rightsSummaries(temp)).toEqual([
      {
        path: "rights/kenney.yaml",
        name: "kenney",
        licence: "CC0 1.0 Universal",
        spdx: "CC0-1.0",
        source: "Kenney, https://kenney.nl",
        problems: [],
      },
    ]);
  });

  test("gives the problems of the gate, and refuses a bad record", () => {
    const pending = writeRightsRecord(temp, {
      ...INPUT,
      name: "seller",
      allowedUse: ["unreal"],
      webDelivery: "pending",
    });
    expect(pending.ok && pending.problems).toEqual(["rights record seller: allowedUse does not include web"]);
    expect(writeRightsRecord(temp, INPUT)).toEqual({ ok: false, reason: "rights/kenney.yaml exists already" });
    expect(writeRightsRecord(temp, INPUT, true).ok).toBe(true);
    expect(writeRightsRecord(temp, { ...INPUT, name: "Bad Name" }).ok).toBe(false);
    expect(writeRightsRecord(temp, { ...INPUT, name: "x", author: " " })).toEqual({
      ok: false,
      reason: "a rights record needs its author",
    });
    expect(writeRightsRecord(temp, { ...INPUT, name: "y", licenceDate: "18/10/2026" }).ok).toBe(false);
  });
});
