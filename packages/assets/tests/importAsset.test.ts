// SPDX-License-Identifier: Apache-2.0
// The import of an asset: each direct format of the fixtures imports with the default settings, the model
// settings act on the model, and a change of the settings or of the source bytes imports again. These tests need no
// Blender: a Blender run fails the test.
import { afterEach, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Document } from "@gltf-transform/core";
import { gltfIO } from "../src/build/optimize";
import { runCli } from "../src/cli";
import { importAsset, ImportError, type ImportOptions } from "../src/import/run";
import { readAssetRecord, writeAssetRecord } from "../src/record";
import { put, record, removeTemps } from "./helpers";
import { boundsOf, FIXTURES, importProject, readModel, writeRecord, type FixtureName } from "./importHelpers";

afterEach(removeTemps);

const GRID = "01J9Z6Q3R9GR1D0000000000AA";

/** A wavy grid of n × n quads as GLB bytes. */
async function gridGlb(n: number): Promise<Uint8Array> {
  const document = new Document();
  const buffer = document.createBuffer();
  const positions: number[] = [];
  const indices: number[] = [];
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) positions.push(x / n, Math.sin(x / 5) * 0.02, z / n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const a = z * (n + 1) + x;
      indices.push(a, a + n + 1, a + 1, a + 1, a + n + 1, a + n + 2);
    }
  }
  const position = document.createAccessor().setType("VEC3").setArray(new Float32Array(positions)).setBuffer(buffer);
  const index = document.createAccessor().setType("SCALAR").setArray(new Uint32Array(indices)).setBuffer(buffer);
  const primitive = document.createPrimitive().setAttribute("POSITION", position).setIndices(index);
  document.createScene().addChild(document.createNode("grid").setMesh(document.createMesh().addPrimitive(primitive)));
  return (await gltfIO()).writeBinary(document);
}

const NO_BLENDER: ImportOptions = {
  blender: () => {
    throw new Error("this import needs no Blender");
  },
};

function importFixture(dir: string, name: FixtureName, options: ImportOptions = {}) {
  return importAsset(dir, `assets/${name}.meta.json`, { ...NO_BLENDER, ...options });
}

describe("the direct importers with the default settings", () => {
  test("glTF and GLB give a self-contained model.glb with the source origin", async () => {
    const dir = importProject();
    for (const name of ["box.gltf", "box.glb"] as const) {
      const outcome = await importFixture(dir, name);
      expect(outcome.status).toBe("imported");
      expect(outcome.outDir).toBe(join(dir, ".scenity/imports", FIXTURES[name].id));
      expect(outcome.stamp.files).toEqual(["model.glb"]);
      expect(outcome.stamp.report).toMatchObject({
        path: "direct",
        meshes: 2,
        textures: ["image/png"],
        clips: [],
        joints: 0,
      });
      const { min, max } = boundsOf(await readModel(outcome.outDir));
      // The base of the box is 1 m up; the centre is 2 m to +X.
      expect(min[1]).toBeCloseTo(1, 4);
      expect(((min[0] ?? 0) + (max[0] ?? 0)) / 2).toBeCloseTo(2, 4);
    }
  });

  test("PNG, JPEG, WebP, AVIF and HDR copy the file and report the size", async () => {
    const dir = importProject();
    const expected: Partial<Record<FixtureName, string>> = {
      "tile.png": "texture.png",
      "tile.jpg": "texture.jpg",
      "tile.webp": "texture.webp",
      "tile.avif": "texture.avif",
      "sky.hdr": "environment.hdr",
    };
    for (const [name, file] of Object.entries(expected) as [FixtureName, string][]) {
      const outcome = await importFixture(dir, name);
      expect(outcome.stamp.files).toEqual([file]);
      expect(outcome.stamp.report).toMatchObject({ width: 8, height: 4 });
      expect(readFileSync(join(outcome.outDir, file))).toEqual(readFileSync(join(dir, "assets", name)));
    }
  });

  test("a texture larger than maxSize gives a warning", async () => {
    const dir = importProject();
    writeRecord(dir, "tile.png", { settings: { maxSize: 4 } });
    const outcome = await importFixture(dir, "tile.png");
    expect(outcome.stamp.warnings).toEqual(["8 × 4 px: the build scales it to 4 px"]);
  });
});

describe("the import key", () => {
  test("the same settings and bytes do nothing; a settings change or a byte change imports again", async () => {
    const dir = importProject();
    const first = await importFixture(dir, "box.glb");
    expect((await importFixture(dir, "box.glb")).status).toBe("current");
    // A default value written out gives the same settings, so the same key.
    writeRecord(dir, "box.glb", { settings: { scale: "auto", merge: false } });
    expect((await importFixture(dir, "box.glb")).status).toBe("current");
    writeRecord(dir, "box.glb", { settings: { scale: 2 } });
    const scaled = await importFixture(dir, "box.glb");
    expect(scaled.status).toBe("imported");
    expect(scaled.stamp.key).not.toBe(first.stamp.key);
    expect(scaled.stamp.report.extent).toEqual([1, 1.2, 1]);
    // The texture of a glTF file is part of its source hash.
    expect((await importFixture(dir, "box.gltf")).status).toBe("imported");
    const png = join(dir, "assets/box_color.png");
    writeFileSync(png, Buffer.concat([readFileSync(png), Buffer.from([0])]));
    expect((await importFixture(dir, "box.gltf")).status).toBe("imported");
    expect((await importFixture(dir, "box.gltf", { force: true })).status).toBe("imported");
  });

  test("an output folder without a stamp imports again", async () => {
    const dir = importProject();
    const first = await importFixture(dir, "tile.webp");
    writeFileSync(join(first.outDir, "import.json"), "not json");
    expect((await importFixture(dir, "tile.webp")).status).toBe("imported");
  });
});

describe("the model settings on the direct path", () => {
  test("up z, base-centre and centre origins, merge and decimate", async () => {
    const dir = importProject();
    writeRecord(dir, "box.glb", { settings: { up: "z", origin: "base-centre" } });
    const turned = boundsOf(await readModel((await importFixture(dir, "box.glb")).outDir));
    // The model lies on its side: its -Z side of the source is the floor, and the base centre is at the origin.
    expect(turned.min[1]).toBeCloseTo(0, 4);
    expect(((turned.min[0] ?? 0) + (turned.max[0] ?? 0)) / 2).toBeCloseTo(0, 4);
    expect((turned.max[2] ?? 0) - (turned.min[2] ?? 0)).toBeCloseTo(0.6, 4);

    writeRecord(dir, "box.glb", { settings: { origin: "centre", merge: true } });
    const merged = await importFixture(dir, "box.glb");
    expect(merged.stamp.report.meshes).toBe(1);
    const centred = boundsOf(await readModel(merged.outDir));
    expect(((centred.min[1] ?? 0) + (centred.max[1] ?? 0)) / 2).toBeCloseTo(0, 4);

    // A mesh at or below `above` stays as it is.
    writeRecord(dir, "box.glb", { settings: { decimate: { above: 1000, ratio: 0.5 } } });
    expect((await importFixture(dir, "box.glb")).stamp.report.triangles).toBe(24);
  });

  test("decimate reduces a dense mesh", async () => {
    const dir = importProject();
    put(dir, "assets/grid.glb", await gridGlb(64));
    put(dir, "assets/grid.glb.meta.json", writeAssetRecord(record(GRID, "grid.glb", { rights: "../rights.yaml" })));
    const full = await importAsset(dir, "assets/grid.glb.meta.json", NO_BLENDER);
    expect(full.stamp.report.triangles).toBe(64 * 64 * 2);
    const settings = { decimate: 0.25 };
    put(
      dir,
      "assets/grid.glb.meta.json",
      writeAssetRecord(record(GRID, "grid.glb", { rights: "../rights.yaml", settings })),
    );
    const reduced = await importAsset(dir, "assets/grid.glb.meta.json", NO_BLENDER);
    expect(reduced.stamp.report.triangles).toBeLessThanOrEqual(64 * 64 * 2 * 0.3);
  });
});

describe("the errors of an import", () => {
  test("bad settings, an unknown importer, a wrong kind and a missing source", async () => {
    const dir = importProject();
    const expectError = async (pointer: string) => {
      try {
        await importFixture(dir, "box.glb");
        throw new Error("no error");
      } catch (error) {
        expect(error).toBeInstanceOf(ImportError);
        expect((error as ImportError).errors[0]?.path).toBe(pointer);
      }
    };
    writeRecord(dir, "box.glb", { settings: { origin: "middle" } });
    await expectError("/settings/origin");
    writeRecord(dir, "box.glb", { importer: "stl" });
    await expectError("/importer");
    writeRecord(dir, "box.glb", { kind: "texture" });
    await expectError("/kind");
    writeRecord(dir, "box.glb", { source: "gone.glb" });
    await expectError("/source");
  });
});

describe("the import command of the CLI", () => {
  test("a new source gets a record; a second run is current", async () => {
    const dir = importProject();
    writeFileSync(join(dir, "assets/copy.webp"), readFileSync(join(dir, "assets/tile.webp")));
    const noRecord = await runCli(["import", dir, "assets/copy.webp"]);
    expect(noRecord.code).toBe(1);
    expect(noRecord.out[0]).toContain("give --rights");
    const made = await runCli(["import", dir, "assets/copy.webp", "--rights", "rights.yaml"]);
    expect(made.code).toBe(0);
    expect(made.out[0]).toMatch(/^imported: \w+ \(webp\) -> \.scenity\/imports\/\w+\/texture\.webp$/);
    const record = readAssetRecord(readFileSync(join(dir, "assets/copy.webp.meta.json"), "utf8"));
    expect(record.ok && record.record.rights).toBe("../rights.yaml");
    expect(record.ok && record.record.kind).toBe("texture");
    const again = await runCli(["import", dir, "assets/copy.webp", "--json"]);
    expect((JSON.parse(again.out.join("\n")) as { status: string }).status).toBe("current");
  });

  test("an asset ID works as the target; a bad call prints the usage", async () => {
    const dir = importProject();
    const byId = await runCli(["import", dir, FIXTURES["sky.hdr"].id]);
    expect(byId.out[0]).toStartWith("imported:");
    expect(existsSync(join(dir, ".scenity/imports", FIXTURES["sky.hdr"].id, "environment.hdr"))).toBe(true);
    expect((await runCli(["import", dir])).code).toBe(2);
    expect((await runCli(["import", dir, "assets/none.glb"])).code).toBe(1);
  });
});
