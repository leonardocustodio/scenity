// SPDX-License-Identifier: Apache-2.0
// The material assets: the importer of `*.material.json` (a check of the document and the canonical text),
// the registry of a two-part extension, and the build: `<id>.material.json` with the texture assets of the document in
// the `dependencies` of the manifest record. The project is a copy of the material sample of samples/gltf-samples.
import { afterEach, describe, expect, test } from "bun:test";
import { cpSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { readDocument } from "@scenity/scene";
import { buildProject } from "../src/build/project";
import { defaultImporterRegistry, importAsset } from "../src/import/run";
import { writeAssetRecord } from "../src/record";
import { put, record, removeTemps, tempProject } from "./helpers";

afterEach(removeTemps);

const SAMPLE = join(import.meta.dir, "..", "..", "..", "samples", "gltf-samples", "assets", "materials");
const CHECKER = "01M51H7Y1XMRMVK5YYEV7E6Z79";
const BUMPS = "01M51H7Y5WR34JDGZ6BAJ9SRFM";
const STANDARD = "01M51H7Y9ZE026AZ1AQJ288Y3V";
const PHONG = "01M51H7YPA8877BCJGSJN1D0B2";

/** A temp project with the material sample in `assets/materials` and a rights record. */
function materialProject(): string {
  const dir = tempProject();
  cpSync(SAMPLE, join(dir, "assets", "materials"), { recursive: true });
  put(dir, "rights/scenity-cc0.yaml", "licence: test\n");
  return dir;
}

/** Write a material document and its record into a project. */
function putMaterial(dir: string, name: string, id: string, doc: Record<string, unknown>): void {
  put(dir, `assets/materials/${name}`, JSON.stringify({ format: "scenity.material/1", ...doc }));
  const fields = { kind: "material", importer: "material", rights: "../../rights/scenity-cc0.yaml" };
  put(dir, `assets/materials/${name}.meta.json`, writeAssetRecord(record(id, name, fields)));
}

async function importError(dir: string, recordPath: string): Promise<string> {
  try {
    await importAsset(dir, recordPath);
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
  return "";
}

describe("the material importer", () => {
  test("the registry finds the importer by the two-part extension", () => {
    const registry = defaultImporterRegistry();
    expect(registry.forFile("assets/red.material.json")?.name).toBe("material");
    expect(registry.forFile(".material.json")?.name).toBe("material");
    expect(registry.forFile("assets/a.b.Material.JSON")?.name).toBe("material");
    expect(registry.forFile("assets/data.json")).toBeUndefined();
    expect(registry.forFile("assets/chair.glb")?.name).toBe("glb");
  });

  test("the import writes the canonical document and reports the type and the textures", async () => {
    const dir = materialProject();
    const outcome = await importAsset(dir, "assets/materials/standard.material.json.meta.json");
    expect(outcome.status).toBe("imported");
    expect(outcome.stamp.files).toEqual(["material.json"]);
    expect(outcome.stamp.report).toEqual({ type: "standard", textures: [`asset:${CHECKER}`, `asset:${BUMPS}`] });
    const text = readFileSync(join(outcome.outDir, "material.json"), "utf8");
    expect(text).toBe(readFileSync(join(SAMPLE, "standard.material.json"), "utf8"));
  });

  test("a value or a map that the type does not take fails the import with its pointer", async () => {
    const dir = materialProject();
    putMaterial(dir, "bad.material.json", "01M51H7YBAD0000000000000AA", {
      type: "phong",
      roughness: 0.5,
      maps: { metalness: { texture: `asset:${CHECKER}` } },
    });
    const message = await importError(dir, "assets/materials/bad.material.json.meta.json");
    expect(message).toContain("/roughness: a phong material has no roughness");
    expect(message).toContain("/maps/metalness: a phong material has no metalness map");
  });
});

describe("the build of a material asset", () => {
  test("the build writes <id>.material.json and lists the textures in the dependencies of the record", async () => {
    const output = await buildProject(materialProject());
    expect(output.findings.filter((item) => item.level === "error")).toEqual([]);
    const standard = output.manifest.records.find((item) => item.id === STANDARD);
    expect(standard).toMatchObject({ kind: "material", stats: { type: "standard" }, dependencies: [CHECKER, BUMPS] });
    expect(standard?.files.map((file) => file.file)).toEqual([`${STANDARD}.material.json`]);
    const built = new TextDecoder().decode(output.files.get(`${STANDARD}.material.json`));
    expect(readDocument(built, "material").ok).toBe(true);
    const phong = output.manifest.records.find((item) => item.id === PHONG);
    expect(phong).toMatchObject({ kind: "material", stats: { type: "phong" } });
    expect(phong && "dependencies" in phong).toBe(false);
    expect(output.files.has(`${CHECKER}.ktx2`)).toBe(true);
    expect(output.files.has(`${BUMPS}.ktx2`)).toBe(true);
  });

  test("a colour space that differs from the import settings of the texture is a warning", async () => {
    const dir = materialProject();
    putMaterial(dir, "linear.material.json", "01M51H7YLIN0000000000000AA", {
      type: "unlit",
      maps: { colour: { texture: `asset:${CHECKER}`, colorSpace: "linear" } },
    });
    const output = await buildProject(dir);
    const warnings = output.findings.filter((item) => item.asset === "01M51H7YLIN0000000000000AA");
    expect(warnings.map((item) => [item.level, item.message])).toEqual([
      ["warning", `the colour map reads ${CHECKER} as linear, but its import settings say srgb`],
    ]);
  });

  test("a texture reference to an asset of another kind is an error", async () => {
    const dir = materialProject();
    putMaterial(dir, "wrong.material.json", "01M51H7YWRG0000000000000AA", {
      type: "unlit",
      maps: { colour: { texture: `asset:${PHONG}` } },
    });
    const output = await buildProject(dir);
    const errors = output.findings.filter((item) => item.level === "error");
    expect(errors.map((item) => item.message)).toEqual([`the asset ${PHONG} is a material, not a texture`]);
    expect(output.files.has("01M51H7YWRG0000000000000AA.material.json")).toBe(false);
  });
});
