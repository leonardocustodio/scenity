// SPDX-License-Identifier: Apache-2.0
// The domain word lint.
import { describe, expect, test } from "bun:test";
import { compare, countHits, readAllowlist, scan, areaOf, updated, type Allowlist } from "./domain-words";

describe("countHits", () => {
  test("counts each word part of a camel case name", () => {
    expect(countHits("const bedRelease = patientPose(cprDepth);")).toBe(3);
  });

  test("counts a word at the start of a word part only", () => {
    expect(countHits("embedded bedrock")).toBe(1);
    expect(countHits("ivory IV iv_pole ivLine")).toBe(3);
    expect(countHits('"hex": "#bedfff", "#BED"')).toBe(0);
  });

  test("gives 0 for generic code", () => {
    expect(countHits("const scene = loadScene(document);")).toBe(0);
  });
});

describe("compare", () => {
  const allow: Allowlist = { files: { "a.ts": { hits: 2, area: "packages/room3d" } } };

  test("accepts the counts of the allowlist", () => {
    expect(compare(new Map([["a.ts", 2]]), allow)).toEqual([]);
  });

  test("refuses a new hit and a new file", () => {
    expect(compare(new Map([["a.ts", 3]]), allow)).toHaveLength(1);
    expect(
      compare(
        new Map([
          ["a.ts", 2],
          ["b.ts", 1],
        ]),
        allow,
      ),
    ).toHaveLength(1);
  });

  test("refuses a stale entry", () => {
    expect(compare(new Map([["a.ts", 1]]), allow)[0]?.message).toContain("stale");
    expect(compare(new Map(), allow)[0]?.message).toContain("stale");
  });
});

describe("updated", () => {
  const allow: Allowlist = { files: { "a.ts": { hits: 2, area: "packages/room3d" } } };

  test("shrinks the list and keeps the area", () => {
    const result = updated(new Map([["a.ts", 1]]), allow, false);
    expect(result).toEqual({ allow: { files: { "a.ts": { hits: 1, area: "packages/room3d" } } } });
  });

  test("refuses a count that goes up", () => {
    expect("refusal" in updated(new Map([["a.ts", 3]]), allow, true)).toBe(true);
  });

  test("accepts a move only with --moved", () => {
    expect("refusal" in updated(new Map([["b.ts", 2]]), allow, false)).toBe(true);
    expect(updated(new Map([["packages/room3d/b.ts", 2]]), allow, true)).toEqual({
      allow: { files: { "packages/room3d/b.ts": { hits: 2, area: "packages/room3d" } } },
    });
  });
});

test("areaOf names the package or the app of a file", () => {
  expect(areaOf("packages/room3d/src/model/bed.ts")).toBe("packages/room3d");
  expect(areaOf("apps/editor/src/lab/lab.ts")).toBe("apps/editor");
  expect(areaOf("tools/shape-exceptions.json")).toBe("tools");
});

test("the engine files agree with the allowlist", () => {
  expect(compare(scan(), readAllowlist())).toEqual([]);
});
