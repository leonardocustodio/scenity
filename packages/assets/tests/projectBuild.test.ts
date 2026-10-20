// SPDX-License-Identifier: Apache-2.0
// The build of a project: the settings come from the project file (three levels of detail, a codec per role,
// the budgets of a kind) and from a record (one level, another codec). The inputs are a model with a JPEG texture, a
// model with a WebP texture, PNG, JPEG, WebP and AVIF textures and an HDR map. A second build gives the same bytes, and
// the asset database lists the written files as the outputs of each asset.
import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { EXTTextureWebP } from "@gltf-transform/extensions";
import { canonicalJson } from "@scenity/scene";
import { compareWithWritten, writeOutput } from "../src/build/output";
import { gltfIO } from "../src/build/optimize";
import { buildProject, type ProjectBuildOutput } from "../src/build/project";
import { DEFAULT_CODECS, DEFAULT_LODS, resolveBuildSettings, resolveLod } from "../src/build/settings";
import { AssetDatabase } from "../src/database";
import { writeAssetRecord } from "../src/record";
import { boxModel } from "./buildFixtures";
import { put, record, removeTemps, tempProject } from "./helpers";
import { IMPORT_FIXTURES } from "./importHelpers";

const IDS = {
  jpegModel: "01J9Z6Q3R9BOXJPG00000000AA",
  webpModel: "01J9Z6Q3R9BOXWEBP0000000AA",
  png: "01J9Z6Q3R9TEXPNG00000000AA",
  jpeg: "01J9Z6Q3R9TEXJPG00000000AA",
  webp: "01J9Z6Q3R9TEXWEBP0000000AA",
  avif: "01J9Z6Q3R9TEXAVIF0000000AA",
  hdr: "01J9Z6Q3R9SKYHDR00000000AA",
} as const;

let dir = "";

/** A box model whose texture is the bytes of an import fixture. */
async function texturedBox(fixture: string, mimeType: string): Promise<Uint8Array> {
  const io = await gltfIO();
  const document = await io.readBinary(await boxModel({ boxes: 30 }));
  if (mimeType === "image/webp") document.createExtension(EXTTextureWebP).setRequired(true);
  for (const texture of document.getRoot().listTextures()) {
    texture.setImage(new Uint8Array(readFileSync(join(IMPORT_FIXTURES, fixture)))).setMimeType(mimeType);
  }
  return io.writeBinary(document);
}

function putRecord(source: string, id: string, fields: Parameters<typeof record>[2]): void {
  const name = source.slice(source.lastIndexOf("/") + 1);
  put(dir, `${source}.meta.json`, writeAssetRecord(record(id, name, { rights: "../rights.yaml", ...fields })));
}

beforeAll(async () => {
  dir = tempProject();
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as Record<string, unknown>;
  project.quality = { budgets: { model: { high: { triangles: 1000, maxTextureSize: 64 }, low: { triangles: 200 } } } };
  project.build = {
    assets: {
      output: "out",
      lods: [{ tier: "high" }, { tier: "mid" }, { tier: "low", ratio: 0.25 }],
      codecs: { normal: "etc1s" },
      generator: "test build",
    },
  };
  put(dir, "scenity.project.json", canonicalJson(project));
  put(dir, "rights.yaml", "licence: test\n");
  put(dir, "assets/jpeg.glb", await texturedBox("tile.jpg", "image/jpeg"));
  putRecord("assets/jpeg.glb", IDS.jpegModel, { importer: "glb" });
  put(dir, "assets/webp.glb", await texturedBox("tile.webp", "image/webp"));
  putRecord("assets/webp.glb", IDS.webpModel, { importer: "glb", build: { lods: 1, codecs: { color: "uastc" } } });
  for (const [name, id, importer] of [
    ["tile.png", IDS.png, "png"],
    ["tile.jpg", IDS.jpeg, "jpeg"],
    ["tile.webp", IDS.webp, "webp"],
    ["tile.avif", IDS.avif, "avif"],
  ] as const) {
    put(dir, `assets/${name}`, new Uint8Array(readFileSync(join(IMPORT_FIXTURES, name))));
    const settings = name === "tile.avif" ? { role: "normal" } : {};
    putRecord(`assets/${name}`, id, { importer, kind: "texture", settings });
  }
  put(dir, "assets/sky.hdr", new Uint8Array(readFileSync(join(IMPORT_FIXTURES, "sky.hdr"))));
  putRecord("assets/sky.hdr", IDS.hdr, { importer: "hdr", kind: "environment" });
});

afterAll(removeTemps);

function errors(output: ProjectBuildOutput): string[] {
  return output.findings.filter((finding) => finding.level === "error").map((f) => `${f.asset}: ${f.message}`);
}

describe("the build settings", () => {
  it("gives the default build settings to a project with none", () => {
    const settings = resolveBuildSettings({});
    expect(settings.lods).toEqual(DEFAULT_LODS);
    expect(settings.codecs).toEqual(DEFAULT_CODECS);
    expect(settings.output).toBe("build");
  });

  it("fills a level of detail with the defaults of its index", () => {
    expect(resolveLod({ tier: "far" }, 2)).toEqual({
      tier: "far",
      ratio: 0.25,
      textureScale: 0.25,
      maxTextureSize: { color: 512, normal: 128, data: 256 },
    });
    expect(resolveLod({ tier: "low" }, 1)).toEqual(DEFAULT_LODS[1] as never);
  });
});

describe("the build of a project", () => {
  it("builds each kind with the settings of the project and the records, twice with the same bytes", async () => {
    const first = await buildProject(dir);
    expect(errors(first)).toEqual([]);
    expect(Object.fromEntries(first.outputs)).toEqual({
      [IDS.jpegModel]: [`${IDS.jpegModel}.high.glb`, `${IDS.jpegModel}.low.glb`, `${IDS.jpegModel}.mid.glb`],
      [IDS.webpModel]: [`${IDS.webpModel}.high.glb`],
      [IDS.png]: [`${IDS.png}.ktx2`],
      [IDS.jpeg]: [`${IDS.jpeg}.ktx2`],
      [IDS.webp]: [`${IDS.webp}.ktx2`],
      [IDS.avif]: [`${IDS.avif}.ktx2`],
      [IDS.hdr]: [`${IDS.hdr}.hdr`],
    });
    // Manifest 2: one record for each asset with outputs, with its files and the levels of its model.
    const records = new Map(first.manifest.records.map((record) => [record.id, record]));
    expect([...records.keys()].sort()).toEqual([...first.outputs.keys()].sort());
    expect(records.get(IDS.jpegModel)?.lods.map((lod) => lod.tier)).toEqual(["high", "mid", "low"]);
    expect(records.get(IDS.hdr)?.files.map((file) => file.file)).toEqual([`${IDS.hdr}.hdr`]);
    expect(new TextDecoder().decode(first.files.get("manifest.json"))).toBe(
      `${JSON.stringify(first.manifest, null, 2)}\n`,
    );
    // The model reads its import; the HDR map keeps the bytes of its source.
    expect(existsSync(join(dir, ".scenity/imports", IDS.jpegModel, "model.glb"))).toBe(true);
    expect(first.files.get(`${IDS.hdr}.hdr`)).toEqual(new Uint8Array(readFileSync(join(dir, "assets/sky.hdr"))));
    const second = await buildProject(dir);
    expect([...second.files.keys()]).toEqual([...first.files.keys()]);
    for (const [name, bytes] of first.files) {
      expect(Buffer.from(second.files.get(name) ?? []).equals(Buffer.from(bytes))).toBe(true);
    }
  });

  it("simplifies each level, encodes KTX2 and removes the WebP extension", async () => {
    const output = await buildProject(dir, { runImports: false });
    const io = await gltfIO();
    const triangles: number[] = [];
    for (const tier of ["high", "mid", "low"]) {
      const bytes = output.files.get(`${IDS.jpegModel}.${tier}.glb`) ?? new Uint8Array();
      const document = await io.readBinary(bytes);
      triangles.push(document.getRoot().listMeshes()[0]?.listPrimitives()[0]?.getIndices()?.getCount() ?? 0);
      expect(
        document
          .getRoot()
          .listTextures()
          .map((texture) => texture.getMimeType()),
      ).toEqual(["image/ktx2"]);
      expect(new TextDecoder().decode(bytes.subarray(0, 2048))).toContain('"generator":"test build"');
    }
    expect(triangles[0]).toBeGreaterThan(triangles[1] ?? 0);
    expect(triangles[1]).toBeGreaterThan(triangles[2] ?? 0);
    const webp = await io.readBinary(output.files.get(`${IDS.webpModel}.high.glb`) ?? new Uint8Array());
    expect(
      webp
        .getRoot()
        .listExtensionsUsed()
        .map((extension) => extension.extensionName),
    ).not.toContain(EXTTextureWebP.EXTENSION_NAME);
  });

  it("writes the files and the asset database lists them as the outputs", async () => {
    const output = await buildProject(dir);
    writeOutput(output, output.outputDir);
    expect(compareWithWritten(output, output.outputDir)).toEqual([]);
    const db = await AssetDatabase.open(dir);
    expect(db.outputDir).toBe("out");
    expect(db.get(IDS.webpModel)?.outputs).toEqual([`out/${IDS.webpModel}.high.glb`]);
    expect(db.get(IDS.hdr)?.outputs).toEqual([`out/${IDS.hdr}.hdr`]);
  });

  it("reports a budget breach of the project", async () => {
    const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as {
      quality: { budgets: { model: { high: { triangles: number } } } };
    };
    project.quality.budgets.model.high.triangles = 10;
    put(dir, "scenity.project.json", canonicalJson(project));
    const output = await buildProject(dir);
    expect(errors(output)).toContain(`${IDS.jpegModel}: high: 360 triangles (budget 10)`);
  });
});
