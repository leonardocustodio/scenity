// SPDX-License-Identifier: Apache-2.0
// The hot reload of assets in dev: the event of the dev server, the projects of a test, and the manifest of the page
// after a reload.
import { describe, expect, it } from "vitest";
import { projectsFromEnv, reloadEvent, type ImportedFiles } from "../../scripts/assetReload";
import { reloadedAssets } from "../../src/scene/hotReload";

const ENTRY = { id: "01TABLE", kind: "model", sourcePath: "assets/sources/table.gltf", hash: "ab".repeat(32) };
const IMPORTED: ImportedFiles = {
  key: "cd".repeat(32),
  folder: ".scenity/imports/01TABLE",
  files: ["model.glb"],
  warnings: ["a warning of the import"],
};

describe("the event of the dev server", () => {
  it("names the main file of the import and the import key", () => {
    const event = reloadEvent("hot", ENTRY, IMPORTED, [], 5);
    expect(event).toEqual({
      project: "hot",
      id: "01TABLE",
      kind: "model",
      ms: 5,
      version: "cd".repeat(8),
      file: ".scenity/imports/01TABLE/model.glb",
      warnings: ["a warning of the import"],
    });
  });

  it("names the source when the import failed and the page can load the source", () => {
    const event = reloadEvent("hot", ENTRY, null, ["the import failed: no Blender"], 5);
    expect(event?.file).toBe("assets/sources/table.gltf");
    expect(event?.version).toBe("ab".repeat(8));
    expect(event?.warnings).toEqual(["the import failed: no Blender"]);
  });

  it("gives no event for a source that the page cannot load, or a missing source", () => {
    expect(reloadEvent("hot", { ...ENTRY, sourcePath: "assets/sources/chair.fbx" }, null, [], 5)).toBeNull();
    expect(reloadEvent("hot", { ...ENTRY, hash: null }, null, [], 5)).toBeNull();
  });

  it("reads the projects of a test from the environment", () => {
    expect(projectsFromEnv("hot=/tmp/a, two=/tmp/b")).toEqual({ hot: "/tmp/a", two: "/tmp/b" });
    expect(projectsFromEnv("Bad=/tmp/a,rel=tmp/b,=/tmp/c,none")).toEqual({});
    expect(projectsFromEnv(undefined)).toEqual({});
  });
});

describe("the manifest of the page after a reload", () => {
  it("replaces the built record with one dev record of the new file, with the version in the URL", () => {
    const built = {
      id: "01TABLE",
      kind: "model",
      lods: [{ tier: "high", file: "01TABLE.high.glb", triangles: 1, meshes: 1, maxTextureSize: 1 }],
      files: [{ file: "01TABLE.high.glb", bytes: 10, sha256: "ef".repeat(32) }],
      bytes: 10,
      sha256: "ef".repeat(32),
      stats: {},
      tags: ["furniture"],
    };
    const other = { ...built, id: "01LAMP", tags: [] };
    const assets = {
      manifest: { format: "scenity.manifest/2" as const, tiers: ["high"], records: [built, other] },
      files: { "01TABLE.high.glb": "/projects/hot/build/01TABLE.high.glb" },
    };
    const event = {
      project: "hot",
      id: "01TABLE",
      kind: "model",
      version: "cdcd",
      file: ".scenity/imports/01TABLE/model.glb",
      ms: 5,
      warnings: [],
    };
    const next = reloadedAssets(assets, "/projects/hot/", event);
    const record = next.manifest.records.find((each) => each.id === "01TABLE");
    expect(record).toEqual({
      id: "01TABLE",
      kind: "model",
      lods: [],
      files: [{ file: ".scenity/imports/01TABLE/model.glb", bytes: 0, sha256: "" }],
      bytes: 0,
      sha256: "",
      stats: {},
      tags: ["furniture"],
    });
    expect(next.manifest.records.find((each) => each.id === "01LAMP")).toBe(other);
    expect(next.files[".scenity/imports/01TABLE/model.glb"]).toBe(
      "/projects/hot/.scenity/imports/01TABLE/model.glb?v=cdcd",
    );
    expect(next.files["01TABLE.high.glb"]).toBe("/projects/hot/build/01TABLE.high.glb");
  });
});
