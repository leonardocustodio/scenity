// SPDX-License-Identifier: Apache-2.0
// The problems of the asset database in the Problems panel: a missing source with relink fixes, and a broken reference
// of another document with relink fixes by ID. Also a duplicate ID with a new ID. A broken reference of the open scene
// gives no row, because the asset problems of the page show it.
import { describe, expect, it, vi } from "vitest";
import type { DatabaseProblem } from "../../src/assetBrowser/assetTypes";
import { databaseProblems } from "../../src/scene/problems/databaseProblems";

const problem = (code: string, file: string, extra: Partial<DatabaseProblem> = {}): DatabaseProblem => ({
  code,
  file,
  pointer: null,
  id: null,
  message: `${code} in ${file}`,
  sources: [],
  assets: [],
  ...extra,
});

describe("the problems of the asset database", () => {
  it("gives each problem its fixes", () => {
    const fix = vi.fn();
    const rows = databaseProblems(
      [
        problem("missing-source", "assets/a.png.meta.json", {
          id: "A",
          pointer: "/source",
          sources: ["assets/moved/a.png", "assets/b.png", "assets/c.png", "assets/d.png"],
        }),
        problem("broken-reference", "scenes/other.scene.json", {
          pointer: "/entities/lamp/components/model/asset",
          assets: [{ id: "L", name: "Lamp", kind: "model" }],
        }),
        problem("broken-reference", "scenes/main.scene.json", { pointer: "/entities/x/components/model/asset" }),
        problem("duplicate-id", "assets/copy.png.meta.json", { id: "A" }),
        problem("missing-file", "assets/chair.gltf.meta.json"),
      ],
      "scenes/main.scene.json",
      fix,
    );
    expect(rows.map((row) => [row.title, row.level, row.fixes.length])).toEqual([
      ["The source of the asset record assets/a.png.meta.json is missing", "error", 3],
      ["scenes/other.scene.json uses an asset that the project does not have", "error", 1],
      ["The asset record assets/copy.png.meta.json has the ID of another record", "error", 1],
      ["A file of the source of assets/chair.gltf.meta.json is missing", "warn", 0],
    ]);
    rows[0]?.fixes[0]?.run();
    rows[1]?.fixes[0]?.run();
    rows[2]?.fixes[0]?.run();
    expect(fix.mock.calls).toEqual([
      [{ action: "source", id: "A", source: "assets/moved/a.png" }],
      [
        {
          action: "reference",
          file: "scenes/other.scene.json",
          pointer: "/entities/lamp/components/model/asset",
          id: "L",
        },
      ],
      [{ action: "new-id", file: "assets/copy.png.meta.json" }],
    ]);
    expect(rows[0]?.fixes[0]?.label).toBe("Relink to assets/moved/a.png");
  });
});
