// SPDX-License-Identifier: Apache-2.0
// The input stamps of the pictures that a browser renders: a check warns when the inputs of a picture changed after
// its stamp.
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inputHash, staleness, writeStamp, type StampInputs } from "../src/build/stamps";

const folder = mkdtempSync(join(tmpdir(), "assets-stamps-"));
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

writeFileSync(join(folder, "scene.ts"), "export const scene = 1;\n");
writeFileSync(join(folder, "manifest.json"), JSON.stringify({ props: [{ id: "a" }], clips: [] }));
const INPUTS: StampInputs = {
  root: folder,
  files: ["scene.ts"],
  manifest: join(folder, "manifest.json"),
  models: ["props"],
  make: "bun run make-pictures",
};

describe("the picture stamps", () => {
  it("warns without a stamp", () => {
    expect(staleness(INPUTS, join(folder, "none.json"))).toContain("no input stamp");
  });

  it("is quiet when the inputs did not change", () => {
    const path = join(folder, "stamp.json");
    writeStamp(INPUTS, path);
    expect(staleness(INPUTS, path)).toBeNull();
  });

  it("warns when the inputs changed after the stamp", () => {
    const path = join(folder, "old.json");
    writeFileSync(path, JSON.stringify({ inputs: "0".repeat(64), made: "2026-10-01" }));
    expect(staleness(INPUTS, path)).toContain("the inputs changed after 2026-10-01");
    expect(staleness(INPUTS, path)).toContain("bun run make-pictures");
  });

  it("hashes the files and the named groups of the manifest only", () => {
    expect(inputHash({ ...INPUTS, models: ["clips"] })).not.toBe(inputHash(INPUTS));
    expect(inputHash({ ...INPUTS, models: ["props"] })).toBe(inputHash(INPUTS));
  });
});
