// SPDX-License-Identifier: Apache-2.0
// The generic asset build: the jobs of a caller build the same bytes twice, a budget breach and an export
// without a job are errors, the check mode reads the committed files of a Git LFS pointer, and the written output
// compares equal. The inputs are small glTF files made in code (buildFixtures.ts).
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { cpSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { TierBudget } from "../src/build/checks";
import { compareWithWritten, webpSize, writeOutput } from "../src/build/output";
import { runPipeline, type AssetJob, type PipelineOptions } from "../src/build/pipeline";
import { boxModel, turnClip } from "./buildFixtures";

const BUDGET: Readonly<Record<"high" | "low", TierBudget>> = {
  high: { triangles: 1_000, bytes: 200_000, maxTextureSize: 256 },
  low: { triangles: 400, bytes: 100_000, maxTextureSize: 128 },
};

let folder = "";
let exportFolder = "";

function jobs(): AssetJob<string, string>[] {
  return [
    {
      type: "model",
      id: "box_a",
      entry: "box",
      budgets: BUDGET,
      optimize: { socketNames: ["grip"], generator: "test" },
    },
    { type: "clip", id: "turn_a", entry: "turn", maxBytes: 100_000, generator: "test" },
  ];
}

function options(extra: Partial<PipelineOptions<string, string>> = {}): PipelineOptions<string, string> {
  return { jobs: jobs(), exportFolder, builtFolder: join(folder, "built"), listName: "the test list", ...extra };
}

function errors(findings: readonly { level: string; message: string }[]): string[] {
  return findings.filter((finding) => finding.level === "error").map((finding) => finding.message);
}

beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "assets-pipeline-"));
  exportFolder = join(folder, "export");
  mkdirSync(exportFolder, { recursive: true });
  writeFileSync(join(exportFolder, "box_a.glb"), await boxModel({ boxes: 30, textureSize: 32, sockets: ["grip"] }));
  writeFileSync(join(exportFolder, "turn_a.glb"), await turnClip());
});

afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

describe("the generic asset build", () => {
  it("builds the jobs twice with the same bytes and gives the entries back", async () => {
    const first = await runPipeline(options());
    expect(errors(first.findings)).toEqual([]);
    expect([...first.files.keys()]).toEqual(["box_a.high.glb", "box_a.low.glb", "turn_a.glb"]);
    expect(first.models[0]?.entry).toBe("box");
    expect(first.models[0]?.tiers.low.stats.triangles).toBeLessThan(first.models[0]?.tiers.high.stats.triangles ?? 0);
    expect(first.models[0]?.tiers.high.stats.sockets).toEqual([{ name: "grip", parent: "body" }]);
    expect(first.clips[0]?.built.stats.animations).toEqual(["turn"]);
    const second = await runPipeline(options());
    for (const [name, bytes] of first.files)
      expect(Buffer.from(second.files.get(name) ?? []).equals(Buffer.from(bytes))).toBe(true);
    const output = { files: first.files, manifestText: "{}\n" };
    const built = join(folder, "written");
    const manifest = join(folder, "manifest.json");
    writeOutput(output, built, manifest);
    expect(compareWithWritten(output, built, manifest)).toEqual([]);
    writeFileSync(join(built, "box_a.low.glb"), new Uint8Array([1, 2, 3]));
    expect(compareWithWritten(output, built, manifest)).toEqual(["box_a.low.glb: other bytes"]);
  }, 60_000);

  it("fails a budget breach and an export without a job", async () => {
    const path = join(folder, "big");
    cpSync(exportFolder, path, { recursive: true });
    writeFileSync(join(path, "box_a.glb"), await boxModel({ boxes: 120, textureSize: 32 }));
    writeFileSync(join(path, "box_extra.glb"), await boxModel());
    const result = await runPipeline(options({ exportFolder: path }));
    expect(errors(result.findings)).toContain("high: 1440 triangles (budget 1000)");
    expect(errors(result.findings)).toContain("an exported file without an entry in the test list");
  }, 60_000);

  it("checks the committed built files of an export that is a Git LFS pointer", async () => {
    const built = join(folder, "lfs-built");
    const first = await runPipeline(options({ builtFolder: built }));
    writeOutput({ files: first.files, manifestText: "" }, built, join(folder, "lfs-manifest.json"));
    const path = join(folder, "lfs-export");
    cpSync(exportFolder, path, { recursive: true });
    writeFileSync(join(path, "box_a.glb"), "version https://git-lfs.github.com/spec/v1\noid sha256:00\nsize 7\n");
    let refused: unknown = null;
    try {
      await runPipeline(options({ exportFolder: path, builtFolder: built }));
    } catch (error) {
      refused = error;
    }
    expect(String(refused)).toMatch(/Git LFS pointer/);
    const checked = await runPipeline(options({ exportFolder: path, builtFolder: built, allowLfsPointers: true }));
    expect(errors(checked.findings)).toEqual([]);
    expect(checked.findings.map((finding) => finding.message)).toContain(
      "the export is a Git LFS pointer: checked the built files",
    );
  }, 60_000);

  it("reads the size of a WebP image", () => {
    // A 1x1 lossless WebP.
    const bytes = Uint8Array.from(atob("UklGRhoAAABXRUJQVlA4TA0AAAAvAAAAEAcQERGIiP4HAA=="), (c) => c.charCodeAt(0));
    expect(webpSize(bytes)).toEqual({ width: 1, height: 1 });
    expect(webpSize(new Uint8Array(40))).toBeNull();
  });
});
