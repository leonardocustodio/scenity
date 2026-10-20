// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sourceOf, trimmedGltfLoader } from "../src/build/trimGltf";

/** The copy of the workspace: the render package vendors it (`bun run check:assets` keeps it current). */
const TARGET = join(import.meta.dir, "..", "..", "render", "src", "vendor", "GLTFLoader.js");
const source = readFileSync(sourceOf(TARGET), "utf8");

describe("the trimmed GLTFLoader", () => {
  it("is current: the vendored copy is the output of the script", () => {
    expect(readFileSync(TARGET, "utf8")).toBe(trimmedGltfLoader(source));
  });

  it("has no plugin of an unused extension and no MeshPhysicalMaterial", () => {
    const trimmed = trimmedGltfLoader(source);
    expect(trimmed).not.toContain("MeshPhysicalMaterial");
    expect(trimmed).not.toContain("GLTFDracoMeshCompressionExtension");
    expect(trimmed).not.toContain("GLTFLightsExtension");
    expect([...trimmed.matchAll(/this\.register\( function/g)]).toHaveLength(2);
  });

  it("stops when a part of the source is not there (a three.js update)", () => {
    expect(() => trimmedGltfLoader(source.replace("class GLTFMaterialsSheenExtension {", "class Sheen {"))).toThrow(
      /GLTFMaterialsSheenExtension/,
    );
    expect(() => trimmedGltfLoader(source.replace("// Use DRACO geometry if available\n", ""))).toThrow(
      /Draco geometry found 0 times/,
    );
    expect(() => trimmedGltfLoader(`${source}\nclass GLTFMaterialsNewExtension {\n}\n`)).toThrow(
      /GLTFMaterialsNewExtension/,
    );
  });
});
