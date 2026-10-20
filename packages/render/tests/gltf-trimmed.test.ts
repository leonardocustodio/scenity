// SPDX-License-Identifier: Apache-2.0
// The trimmed GLTFLoader. Every built asset gives the same scene, materials, geometry and clips as the GLTFLoader of
// three.js. A file with another glTF extension fails to load.
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import type { Mesh } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader as StockLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GLTFLoader } from "../src/vendor/GLTFLoader.js";
import { bufferOf, describeGltf, placeholderTextures } from "./gltfDescribe";

/**
 * The folders of the built glTF files of the repository: `plugins/<plugin>/content/built/files` and the asset builds
 * of the samples (`samples/<sample>/build`).
 */
const ROOT = join(import.meta.dir, "../../..");
const PLUGINS = join(ROOT, "plugins");
const SAMPLES = join(ROOT, "samples");
const FILE_DIRS = [
  ...readdirSync(PLUGINS).map((plugin) => join(PLUGINS, plugin, "content/built/files")),
  ...readdirSync(SAMPLES).map((sample) => join(SAMPLES, sample, "build")),
].filter((folder) => existsSync(folder));
/**
 * The glTF extensions that the trimmed loader reads: GLTF_EXTENSIONS and GLTF_DATA_EXTENSIONS of
 * packages/assets/src/build/trimGltf.ts. A built file with another extension is for the generic loader.
 */
const ROOM_EXTENSIONS: ReadonlySet<string> = new Set([
  "EXT_meshopt_compression",
  "KHR_mesh_quantization",
  "KHR_texture_basisu",
  "KHR_texture_transform",
  "KHR_materials_variants",
]);

/** The extensions that a GLB file uses (the JSON chunk). */
function extensionsOf(path: string): string[] {
  const bytes = new Uint8Array(bufferOf(path));
  const length = new DataView(bytes.buffer).getUint32(12, true);
  const json = JSON.parse(new TextDecoder().decode(bytes.subarray(20, 20 + length))) as { extensionsUsed?: string[] };
  return json.extensionsUsed ?? [];
}

/** Each built glTF file for the trimmed loader, by its path. */
const FILES = FILE_DIRS.flatMap((folder) =>
  readdirSync(folder)
    .filter((name) => name.endsWith(".glb"))
    .map((name) => join(folder, name)),
).filter((path) => extensionsOf(path).every((name) => ROOM_EXTENSIONS.has(name)));

async function load(loader: StockLoader, bytes: ArrayBuffer): Promise<GLTF> {
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(placeholderTextures);
  return loader.parseAsync(bytes, "");
}

describe("trimmed GLTFLoader", () => {
  it("loads every built asset as the GLTFLoader of three.js does", async () => {
    await MeshoptDecoder.ready;
    expect(FILES.length).toBeGreaterThan(0);
    for (const path of FILES) {
      const name = path.slice(ROOT.length + 1);
      const bytes = bufferOf(path);
      const stock = describeGltf(await load(new StockLoader(), bytes.slice(0)));
      const trimmed = describeGltf(await load(new GLTFLoader(), bytes.slice(0)));
      expect({ name, trimmed }).toEqual({ name, trimmed: stock });
    }
  }, 60_000);

  it("gives the MeshStandardMaterial of three.js", async () => {
    await MeshoptDecoder.ready;
    const path = FILES.find((file) => basename(file).endsWith(".high.glb"));
    const gltf = await load(new GLTFLoader(), bufferOf(path ?? ""));
    const classes = new Set<string>();
    gltf.scene.traverse((object) => {
      const mesh = object as Partial<Mesh>;
      if (mesh.material !== undefined) for (const item of [mesh.material].flat()) classes.add(item.type);
    });
    expect([...classes]).toEqual(["MeshStandardMaterial"]);
  });

  it("fails on a glTF extension that it does not read", async () => {
    const json = {
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_materials_emissive_strength"],
      scenes: [{ nodes: [] }],
    };
    const error = await new GLTFLoader().parseAsync(JSON.stringify(json), "").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(String(error)).toContain('does not read the extension "KHR_materials_emissive_strength"');
  });

  it("keeps the data of KHR_materials_variants, as the GLTFLoader of three.js does", async () => {
    const json = {
      asset: { version: "2.0" },
      extensionsUsed: ["KHR_materials_variants"],
      extensions: { KHR_materials_variants: { variants: [{ name: "pale" }] } },
      scenes: [{ nodes: [] }],
    };
    const gltf = await new GLTFLoader().parseAsync(JSON.stringify(json), "");
    expect(gltf.userData).toEqual({ gltfExtensions: json.extensions });
  });
});
