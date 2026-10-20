// SPDX-License-Identifier: Apache-2.0
// The build state of each asset: built, stale after a change of the record or the source,
// unbuilt, and failed after a build with errors.
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AssetDatabase } from "../src/database";
import { assetBuildStates, writeBuildState } from "../src/build/buildState";

const dirs: string[] = [];
afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

const ID = "01ABCDEFGHJKMNPQRSTVWXYZ00";

function project(): string {
  const dir = mkdtempSync(join(tmpdir(), "scenity-build-state-"));
  dirs.push(dir);
  writeFileSync(
    join(dir, "scenity.project.json"),
    JSON.stringify({ format: "scenity.project/1", id: "p", name: "P", assets: ["."], scenes: [] }),
  );
  writeFileSync(join(dir, "a.png"), "png bytes");
  const record = {
    format: "scenity.asset/1",
    id: ID,
    kind: "texture",
    source: "a.png",
    importer: "png",
    settings: {},
    rights: "rights.yaml",
    tags: [],
  };
  writeFileSync(join(dir, "a.png.meta.json"), JSON.stringify(record));
  return dir;
}

describe("the build state of each asset", () => {
  test("gives unbuilt, built, stale and failed", async () => {
    const dir = project();
    let db = await AssetDatabase.open(dir);
    expect(assetBuildStates(db, new Set()).map((each) => each.state)).toEqual(["unbuilt"]);
    // A build output from before the state file: built.
    expect(assetBuildStates(db, new Set([ID]))[0]?.state).toBe("built");
    writeBuildState(db, []);
    expect(assetBuildStates(db, new Set([ID]))[0]?.state).toBe("built");
    writeFileSync(join(dir, "a.png"), "new png bytes");
    db = await AssetDatabase.open(dir);
    const stale = assetBuildStates(db, new Set([ID]))[0];
    expect(stale?.state).toBe("stale");
    expect(stale?.reason).toContain("changed after the build");
    writeBuildState(db, [{ level: "error", asset: ID, message: "the texture does not read" }]);
    expect(assetBuildStates(db, new Set([ID]))[0]).toEqual({
      id: ID,
      state: "failed",
      reason: "the texture does not read",
    });
    writeBuildState(db, [{ level: "warning", asset: ID, message: "large" }]);
    expect(assetBuildStates(db, new Set([ID]))[0]?.state).toBe("built");
  });
});
