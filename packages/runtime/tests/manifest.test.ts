// SPDX-License-Identifier: Apache-2.0
// Manifest 2: the run-time check of the generic records, the budgets by tag and by kind, the tag values and
// the levels of detail. The built manifest of the showroom (samples/showroom/build/manifest.json) passes.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  ASSET_MANIFEST_FORMAT,
  lodOf,
  parseAssetManifest,
  tagValues,
  type AssetManifest,
  type AssetRecord,
} from "../src/manifest";

const SHA = "a".repeat(64);

const chair: AssetRecord = {
  id: "01J9Z6Q3R9",
  kind: "model",
  lods: [
    { tier: "high", file: "01J9Z6Q3R9.high.glb", triangles: 900, meshes: 1, maxTextureSize: 1024 },
    { tier: "low", file: "01J9Z6Q3R9.low.glb", triangles: 400, meshes: 1, maxTextureSize: 512 },
  ],
  files: [
    { file: "01J9Z6Q3R9.high.glb", bytes: 300, sha256: SHA },
    { file: "01J9Z6Q3R9.low.glb", bytes: 100, sha256: SHA },
  ],
  bytes: 400,
  sha256: SHA,
  stats: {},
  tags: ["furniture", "acme.slot:corner"],
};

const step: AssetRecord = {
  id: "step_clip",
  kind: "animation",
  lods: [],
  files: [{ file: "step_clip.glb", bytes: 50, sha256: SHA }],
  bytes: 50,
  sha256: SHA,
  stats: { duration: 1.5, loop: true, bones: ["hips", "spine"] },
  tags: ["clip"],
};

const MANIFEST: AssetManifest = { format: ASSET_MANIFEST_FORMAT, tiers: ["high", "low"], records: [chair, step] };

/** A copy of the manifest with its first record changed. */
function withChair(change: Partial<AssetRecord> | Record<string, unknown>): unknown {
  return { ...MANIFEST, records: [{ ...chair, ...change }, step] };
}

describe("parseAssetManifest", () => {
  it("accepts a valid manifest and the built manifest of the showroom", () => {
    expect(parseAssetManifest(MANIFEST)).toEqual(MANIFEST);
    const showroom: unknown = JSON.parse(
      readFileSync(join(import.meta.dir, "../../../samples/showroom/build/manifest.json"), "utf8"),
    );
    const parsed = parseAssetManifest(showroom);
    expect(parsed.records.length).toBeGreaterThan(0);
    expect(parsed.records.every((record) => record.files.length > 0)).toBe(true);
  });

  it("accepts the sound files of an asset build (the build of the characters sample)", () => {
    const sound = (file: string): AssetRecord => ({
      id: "chirp",
      kind: "audio",
      lods: [],
      files: [{ file, bytes: 10, sha256: SHA }],
      bytes: 10,
      sha256: SHA,
      stats: { duration: 0.24 },
      tags: [],
    });
    for (const file of ["chirp.wav", "chirp.ogg", "chirp.mp3"]) {
      expect(parseAssetManifest({ ...MANIFEST, records: [sound(file)] }).records[0]?.files[0]?.file).toBe(file);
    }
    expect(() => parseAssetManifest({ ...MANIFEST, records: [sound("chirp.exe")] })).toThrow("files[0].file");
  });

  it("refuses a bad format, a path in a file name, a level with no file, a wrong sum and a duplicate ID", () => {
    expect(() => parseAssetManifest({ ...MANIFEST, format: "scenity.manifest/1" })).toThrow("format");
    const path = { ...chair.files[0], file: "../x.glb" };
    expect(() => parseAssetManifest(withChair({ files: [path, chair.files[1]] }))).toThrow("files[0].file");
    expect(() => parseAssetManifest(withChair({ files: [chair.files[0]], bytes: 300 }))).toThrow("is not in files");
    expect(() => parseAssetManifest(withChair({ bytes: 401 }))).toThrow("not the sum of the files");
    expect(() => parseAssetManifest({ ...MANIFEST, records: [chair, chair] })).toThrow("two times");
    expect(() => parseAssetManifest(withChair({ stats: { size: { x: 1 } } }))).toThrow("stats.size");
    const level = { ...chair.lods[0], tier: "far" };
    expect(() => parseAssetManifest(withChair({ lods: [level] }))).toThrow("far is not a tier");
  });

  it("reads the dependencies of a record and a material file", () => {
    const material: AssetRecord = {
      id: "01M51H7Y9ZE026AZ1AQJ288Y3V",
      kind: "material",
      lods: [],
      files: [{ file: "01M51H7Y9ZE026AZ1AQJ288Y3V.material.json", bytes: 20, sha256: SHA }],
      bytes: 20,
      sha256: SHA,
      stats: { type: "standard" },
      tags: [],
      dependencies: ["01J9Z6Q3R9"],
    };
    const manifest = { ...MANIFEST, records: [chair, step, material] };
    expect(parseAssetManifest(manifest)).toEqual(manifest);
    const bad = { ...manifest, records: [chair, step, { ...material, dependencies: ["../x"] }] };
    expect(() => parseAssetManifest(bad)).toThrow("records[2].dependencies[0]");
  });

  it("checks the budget of the first tag that has one, else of the kind", () => {
    expect(() => parseAssetManifest(MANIFEST, { model: { high: { triangles: 800 } } })).toThrow(
      "01J9Z6Q3R9.high.glb triangles: 900 is over the budget 800",
    );
    expect(() => parseAssetManifest(MANIFEST, { furniture: { low: { bytes: 99 } } })).toThrow(
      "01J9Z6Q3R9.low.glb bytes: 100 is over the budget 99",
    );
    // A tag budget takes the place of the kind budget.
    expect(() =>
      parseAssetManifest(MANIFEST, { model: { high: { triangles: 1 } }, furniture: { high: { triangles: 900 } } }),
    ).not.toThrow();
    // A file that is not a level takes the byte limit of the first tier.
    expect(() => parseAssetManifest(MANIFEST, { clip: { high: { bytes: 49 } } })).toThrow("step_clip.glb bytes: 50");
    expect(() => parseAssetManifest(MANIFEST, { clip: { low: { bytes: 49 } } })).not.toThrow();
  });

  it("gives the tag values and the level of a tier", () => {
    expect(tagValues(chair, "acme.slot:")).toEqual(["corner"]);
    expect(tagValues(chair, "acme.npc:")).toEqual([]);
    expect(lodOf(chair, "low")?.file.bytes).toBe(100);
    expect(lodOf(step, "high")).toBeNull();
  });
});
