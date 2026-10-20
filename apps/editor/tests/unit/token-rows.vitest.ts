// SPDX-License-Identifier: Apache-2.0
// The rows of the token page of the studio: the studio tokens of the real token reference,
// with a value for each theme variant and no failed check.
import { describe, expect, it } from "vitest";
import reference from "@scenity/tokens/reference.json";
import { isStudioToken, studioTokenRows, type TokenReference } from "../../src/tokens/tokenRows";

const data = reference as unknown as TokenReference;

describe("the token page of the studio", () => {
  it("lists each studio token with a value for each variant", () => {
    const rows = studioTokenRows(data);
    expect(rows.length).toBeGreaterThan(30);
    expect(rows.every((row) => isStudioToken(row.name))).toBe(true);
    for (const row of rows) expect(row.values.filter((value) => value !== "")).toHaveLength(data.variants.length);
    expect(rows.map((row) => row.name)).toContain("color.studio.agent.6");
    expect(rows.map((row) => row.name)).toContain("studio.size.dense.row");
  });

  it("gives the checks of the marks, and none fails", () => {
    const rows = studioTokenRows(data);
    const agent = rows.find((row) => row.name === "color.studio.agent.1");
    expect(agent?.checks).toBeGreaterThan(0);
    expect(rows.reduce((sum, row) => sum + row.failed, 0)).toBe(0);
  });
});
