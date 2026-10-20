// SPDX-License-Identifier: Apache-2.0
// The import of a dropped file: a GLB, an FBX, an OBJ and a .blend fixture each become an optimized glTF within the
// prop budget, with the base centre at the origin. The fixtures come from code (no file of another person): a GLB
// with PNG textures from glTF Transform here; an FBX, an OBJ, a .blend and a GLB with a JPEG texture from
// tests/make_drop_fixtures.py in Blender. The Blender cases run where Blender 5.2 is on this machine, as `py:test`.
import { afterAll, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Document } from "@gltf-transform/core";
import { getBounds } from "@gltf-transform/functions";
import { encode } from "fast-png";
import type { TierBudget } from "../src/build/checks";
import { gltfIO, modelStats } from "../src/build/optimize";
import { dropFormat, importDrop, type ImportOptions, type ImportResult } from "../src/blender/importDrop";
import { blenderScript, hasLocalBlender, runBlender } from "../src/blender/run";

/** The budgets of a prop of a room. */
const PROP: Readonly<Record<"high" | "low", Required<TierBudget>>> = {
  high: { triangles: 25_000, bytes: 1_200_000, maxTextureSize: 2048 },
  low: { triangles: 8_000, bytes: 500_000, maxTextureSize: 1024 },
};

/** The import with the budgets of a prop. */
function importProp(options: Omit<ImportOptions, "budgets">): Promise<ImportResult> {
  return importDrop({ ...options, budgets: PROP });
}

const folder = mkdtempSync(join(tmpdir(), "assets-import-drop-"));
afterAll(() => {
  rmSync(folder, { recursive: true, force: true });
});

/** A 0.5 m box with a PNG texture, its base 2 m away from the origin and 1 m above the floor. */
async function glbFixture(): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions: number[] = [];
  const normals: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];
  const faces: readonly [number, number, number][] = [
    [0, 1, 2],
    [0, 2, 1],
    [1, 2, 0],
    [1, 0, 2],
    [2, 0, 1],
    [2, 1, 0],
  ];
  for (const [index, [a, b, n]] of faces.entries()) {
    const sign = index % 2 === 0 ? 1 : -1;
    const base = positions.length / 3;
    for (const [u, v] of [
      [0, 0],
      [1, 0],
      [1, 1],
      [0, 1],
    ] as const) {
      const point: [number, number, number] = [0, 0, 0];
      point[a] = (u - 0.5) * 0.5;
      point[b] = (v - 0.5) * 0.5;
      point[n] = sign * 0.25;
      positions.push(point[0] + 2, point[1] + 1.25, point[2] - 2);
      const normal = [0, 0, 0];
      normal[n] = sign;
      normals.push(...normal);
      uvs.push(u, v);
    }
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  const pixels = new Uint8Array(16 * 16 * 4).map((_, i) => (i % 4 === 3 ? 255 : (i * 7) % 256));
  const texture = document
    .createTexture("color")
    .setImage(encode({ width: 16, height: 16, data: pixels, channels: 4 }))
    .setMimeType("image/png");
  const material = document.createMaterial("box").setBaseColorTexture(texture);
  const primitive = document
    .createPrimitive()
    .setAttribute(
      "POSITION",
      document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer),
    )
    .setAttribute(
      "NORMAL",
      document.createAccessor().setType("VEC3").setArray(new Float32Array(normals)).setBuffer(buffer),
    )
    .setAttribute(
      "TEXCOORD_0",
      document.createAccessor().setType("VEC2").setArray(new Float32Array(uvs)).setBuffer(buffer),
    )
    .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint16Array(indices)).setBuffer(buffer))
    .setMaterial(material);
  const node = document.createNode("box").setMesh(document.createMesh("box").addPrimitive(primitive));
  document.createScene("scene").addChild(node);
  return (await gltfIO()).writeBinary(document);
}

/** The bounds of the normalized model of a result folder. */
async function normalizedBounds(out: string): Promise<{ min: number[]; max: number[] }> {
  const document = await (await gltfIO()).readBinary(readFileSync(join(out, "normalized.glb")));
  const scene = document.getRoot().listScenes()[0];
  if (scene === undefined) throw new Error("no scene");
  return getBounds(scene);
}

/** The checks of every format: in the prop budget, KTX2 textures, the base centre at the origin, the size. */
async function expectProp(result: ImportResult, out: string, height: number): Promise<void> {
  expect(result.pass).toBe(true);
  expect(result.validator.errors).toEqual([]);
  for (const tier of ["high", "low"] as const) {
    const report = result.tiers[tier];
    expect(report.triangles).toBeGreaterThan(0);
    expect(report.triangles).toBeLessThanOrEqual(PROP[tier].triangles);
    expect(report.bytes).toBeLessThanOrEqual(PROP[tier].bytes);
    const document = await (await gltfIO()).readBinary(readFileSync(join(out, report.file)));
    const stats = modelStats(document);
    expect(stats.textures.length).toBeGreaterThan(0);
    expect(stats.textures.every((item) => item.mimeType === "image/ktx2")).toBe(true);
    expect(
      document
        .getRoot()
        .listExtensionsUsed()
        .map((item) => item.extensionName),
    ).toContain("EXT_meshopt_compression");
  }
  const { min, max } = await normalizedBounds(out);
  expect(min[1]).toBeCloseTo(0, 4);
  expect(((min[0] ?? 0) + (max[0] ?? 0)) / 2).toBeCloseTo(0, 4);
  expect(((min[2] ?? 0) + (max[2] ?? 0)) / 2).toBeCloseTo(0, 4);
  expect(result.extent[1]).toBeCloseTo(height, 2);
}

describe("dropFormat", () => {
  test("knows the five formats, in any case", () => {
    expect(dropFormat("Chair.GLB")).toBe(".glb");
    expect(dropFormat("a/b/chair.fbx")).toBe(".fbx");
    expect(dropFormat("x.blend")).toBe(".blend");
    expect(dropFormat("x.stl")).toBeNull();
    expect(dropFormat("noext")).toBeNull();
  });
});

describe("importDrop", () => {
  test("a GLB with PNG textures goes straight on: optimized, in budget, the base at the origin", async () => {
    const input = join(folder, "box.glb");
    await Bun.write(input, await glbFixture());
    const out = join(folder, "glb");
    const result = await importProp({
      input,
      outDir: out,
      blender: () => {
        throw new Error("a GLB with PNG textures needs no Blender");
      },
    });
    expect(result.blender).toBeNull();
    await expectProp(result, out, 0.5);
  });

  test("a model above the triangle budget is simplified into it", async () => {
    // A dense grid: 160 × 160 quads, about 51,000 triangles (budget 25,000).
    const document = new Document();
    const buffer = document.createBuffer();
    const n = 160;
    const positions: number[] = [];
    const indices: number[] = [];
    for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) positions.push(x / n, Math.sin(x / 7) * 0.05, z / n);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const a = z * (n + 1) + x;
        indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
      }
    }
    const primitive = document
      .createPrimitive()
      .setAttribute(
        "POSITION",
        document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer),
      )
      .setIndices(document.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer));
    document.createScene().addChild(document.createNode("grid").setMesh(document.createMesh().addPrimitive(primitive)));
    const input = join(folder, "grid.glb");
    await Bun.write(input, await (await gltfIO()).writeBinary(document));
    const result = await importProp({ input, outDir: join(folder, "grid") });
    expect(result.simplified?.from).toBe(n * n * 2);
    expect(result.tiers.high.triangles).toBeLessThanOrEqual(PROP.high.triangles);
    expect(result.warnings.some((line) => line.startsWith("simplified"))).toBe(true);
  });

  test("refuses a format that the import does not read", async () => {
    let message = "";
    try {
      await importProp({ input: join(folder, "x.stl"), outDir: join(folder, "stl") });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain("the import reads");
  });
});

describe.skipIf(!hasLocalBlender())("importDrop through Blender 5.2", () => {
  const fixtures = join(folder, "fixtures");
  let made = false;
  function fixture(name: string): string {
    if (!made) {
      runBlender(["--python", blenderScript("tests/make_drop_fixtures.py"), "--", "--out", fixtures], [folder]);
      made = true;
    }
    return join(fixtures, name);
  }

  test("an FBX file with a JPEG texture", async () => {
    const out = join(folder, "fbx");
    const result = await importProp({ input: fixture("stool.fbx"), outDir: out });
    expect(result.blender?.images).toBe(1);
    await expectProp(result, out, 0.47);
  }, 60_000);

  test("a GLB file with a JPEG texture goes through Blender to PNG", async () => {
    const out = join(folder, "glb-jpeg");
    const result = await importProp({ input: fixture("stool.glb"), outDir: out });
    expect(result.format).toBe(".glb");
    expect(result.blender?.images).toBe(1);
    await expectProp(result, out, 0.47);
  }, 60_000);

  test("an OBJ file in centimetres becomes metres", async () => {
    const out = join(folder, "obj");
    const result = await importProp({ input: fixture("stool.obj"), outDir: out });
    expect(result.blender?.scale).toBe(0.01);
    expect(result.warnings.some((line) => line.includes("centimetres"))).toBe(true);
    await expectProp(result, out, 0.47);
  }, 60_000);

  test("a .blend file with a parent transform and a modifier", async () => {
    const out = join(folder, "blend");
    const result = await importProp({ input: fixture("stool.blend"), outDir: out });
    // The parent scales the stool by 0.5; the bevel modifier adds faces.
    expect(result.blender?.triangles).toBeGreaterThan(188);
    await expectProp(result, out, 0.235);
  }, 60_000);
});
