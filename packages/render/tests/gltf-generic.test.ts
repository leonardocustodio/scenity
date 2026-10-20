// SPDX-License-Identifier: Apache-2.0
// The generic GLTFLoader and its asset loader. The generic loader gives the scene of the GLTFLoader of three.js for
// the built assets and the Khronos samples. The asset loader reads each sample (the images through the image decoder,
// the URIs of a .gltf file, Draco in the thread of the caller). A built file passes the size and SHA-256 checks. A
// file with another glTF extension fails.
import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import type { InstancedMesh, Light, Material, Mesh, Object3D } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { GLTFLoader as StockLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import type { GLTF } from "three/examples/jsm/loaders/GLTFLoader.js";
import { GenericAssetLoader } from "../src/genericAssets";
import { dataUriBytes } from "../src/imageSources";
import { GLTFLoader } from "../src/vendor/GLTFLoaderGeneric.js";
import { basisWasm } from "./fixtures";
import { bufferOf, describeGltf, placeholderTextures } from "./gltfDescribe";

const ROOT = join(import.meta.dir, "../../..");
const SAMPLES = join(ROOT, "samples/gltf-samples/assets/sources");
const SHOWROOM_BUILD = join(ROOT, "samples/showroom/build");
const RGBA_ONLY = {
  astcSupported: false,
  astcHDRSupported: false,
  etc1Supported: false,
  etc2Supported: false,
  dxtSupported: false,
  bptcSupported: false,
  pvrtcSupported: false,
};

/** Each glTF or GLB file of the Khronos samples, relative to SAMPLES. */
const SAMPLE_FILES = readdirSync(SAMPLES, { recursive: true, encoding: "utf8" })
  .filter((name) => /\.(glb|gltf)$/.test(name))
  .sort();
const BUILT_FILES = existsSync(SHOWROOM_BUILD)
  ? readdirSync(SHOWROOM_BUILD).filter((name) => name.endsWith(".glb"))
  : [];

function dracoWasm(): ArrayBuffer {
  const path = createRequire(import.meta.url).resolve("three/examples/jsm/libs/draco/gltf/draco_decoder.wasm");
  return bufferOf(path);
}

/** A fetch of the files of the repository: `/repo/<path>` gives the file at <path>. */
async function repoFetch(url: string): Promise<Response> {
  const path = new URL(url, "http://localhost/").pathname;
  if (path === "/decoders/basis.wasm") return new Response(basisWasm());
  if (path === "/decoders/draco.wasm") return new Response(dracoWasm());
  const file = join(ROOT, decodeURIComponent(path.replace(/^\/repo\//, "")));
  if (!path.startsWith("/repo/") || !existsSync(file)) return new Response("", { status: 404 });
  return Promise.resolve(new Response(readFileSync(file)));
}

/** An asset loader over the repository; each image decodes to a small object with the MIME type. */
function repoLoader(): GenericAssetLoader {
  return new GenericAssetLoader({
    decoders: { basisWasm: "/decoders/basis.wasm", dracoWasm: "/decoders/draco.wasm" },
    ktx2Config: RGBA_ONLY,
    fetch: repoFetch,
    decode: (blob) => Promise.resolve({ width: 1, height: 1, type: blob.type }),
  });
}

async function stockLoad(bytes: ArrayBuffer, loader: StockLoader): Promise<GLTF> {
  loader.setMeshoptDecoder(MeshoptDecoder);
  loader.register(placeholderTextures);
  return loader.parseAsync(bytes, "");
}

/** The materials, lights and instanced meshes of a scene. */
function partsOf(root: Object3D) {
  const materials = new Set<string>();
  const lights = new Set<string>();
  let instances = 0;
  let textures = 0;
  root.traverse((object) => {
    if ((object as Partial<Light>).isLight === true) lights.add(object.type);
    if ((object as Partial<InstancedMesh>).isInstancedMesh === true) instances += (object as InstancedMesh).count;
    const mesh = object as Partial<Mesh>;
    const list: Material[] = mesh.material === undefined ? [] : [mesh.material].flat();
    for (const material of list) {
      materials.add(material.type);
      textures += Object.values(material).filter(
        (value) => (value as { isTexture?: boolean } | null)?.isTexture,
      ).length;
    }
  });
  return { materials: [...materials].sort(), lights: [...lights].sort(), instances, textures };
}

const realFunction = globalThis.Function;
const realEval = globalThis.eval;
afterEach(() => {
  globalThis.Function = realFunction;
  globalThis.eval = realEval;
});

describe("the generic GLTFLoader", () => {
  it("loads the built files and the samples as the GLTFLoader of three.js does", async () => {
    await MeshoptDecoder.ready;
    const files = [
      ...BUILT_FILES.map((name) => join(SHOWROOM_BUILD, name)),
      ...SAMPLE_FILES.filter((name) => name.endsWith(".glb")).map((name) => join(SAMPLES, name)),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const path of files) {
      const bytes = bufferOf(path);
      const stock = describeGltf(await stockLoad(bytes.slice(0), new StockLoader()));
      const generic = describeGltf(await stockLoad(bytes.slice(0), new GLTFLoader()));
      expect({ path, generic }).toEqual({ path, generic: stock });
    }
  }, 60_000);

  it("fails on a glTF extension that it does not read", async () => {
    const json = { asset: { version: "2.0" }, extensionsUsed: ["KHR_materials_dispersion"], scenes: [{ nodes: [] }] };
    const error = await new GLTFLoader().parseAsync(JSON.stringify(json), "").then(
      () => null,
      (reason: unknown) => reason,
    );
    expect(String(error)).toContain('the generic loader does not read the extension "KHR_materials_dispersion"');
  });
});

describe("the generic asset loader", () => {
  it("loads each Khronos sample with its extensions", async () => {
    const loader = repoLoader();
    const parts: Record<string, ReturnType<typeof partsOf>> = {};
    for (const name of SAMPLE_FILES) {
      const gltf = await loader.load({ url: `/repo/samples/gltf-samples/assets/sources/${name}` });
      parts[name.split("/")[0] ?? name] = partsOf(gltf.scene);
    }
    expect(parts.TransmissionRoughnessTest?.materials).toContain("MeshPhysicalMaterial");
    expect(parts.SheenTestGrid?.materials).toContain("MeshPhysicalMaterial");
    expect(parts.UnlitTest?.materials).toEqual(["MeshBasicMaterial"]);
    expect(parts.PointLightIntensityTest?.lights.length).toBeGreaterThan(0);
    expect(parts.SimpleInstancing?.instances).toBeGreaterThan(1);
    expect(parts.TextureCoordinateTestWebP?.textures).toBeGreaterThan(0);
    expect(parts.TextureCoordinateTestAvif?.textures).toBeGreaterThan(0);
    loader.dispose();
  }, 60_000);

  it("decodes Draco in its own thread, with no new Function and no eval", async () => {
    const blocked: string[] = [];
    globalThis.Function = new Proxy(realFunction, {
      construct: () => {
        blocked.push("new Function");
        throw new EvalError("blocked by the test CSP");
      },
    });
    globalThis.eval = () => {
      blocked.push("eval");
      throw new EvalError("blocked by the test CSP");
    };
    const gltf = await repoLoader().load({ url: "/repo/samples/gltf-samples/assets/sources/BoxDraco/Box.gltf" });
    let mesh: Mesh | undefined;
    gltf.scene.traverse((object) => {
      if ((object as Partial<Mesh>).isMesh === true) mesh = object as Mesh;
    });
    expect(blocked).toEqual([]);
    expect(mesh?.geometry.index?.count).toBe(36);
    expect(mesh?.geometry.getAttribute("position").count).toBe(24);
    expect(mesh?.geometry.getAttribute("normal").count).toBe(24);
  });

  it("checks the size and the SHA-256 of a built file, and the KTX2 textures load", async () => {
    const manifest = JSON.parse(readFileSync(join(SHOWROOM_BUILD, "manifest.json"), "utf8")) as {
      records: { files: { file: string; bytes: number; sha256: string }[] }[];
    };
    const file = manifest.records[0]?.files[0];
    if (file === undefined) throw new Error("the showroom build has no file");
    const url = `/repo/samples/showroom/build/${file.file}`;
    const gltf = await repoLoader().load({ url, bytes: file.bytes, sha256: file.sha256 });
    expect(partsOf(gltf.scene).textures).toBeGreaterThan(0);
    const wrong = await repoLoader()
      .load({ url, bytes: file.bytes, sha256: "0".repeat(64) })
      .then(
        () => null,
        (reason: unknown) => reason,
      );
    expect(String(wrong)).toContain("has a wrong hash");
  });

  it("decodes a data URI with no fetch", () => {
    expect(dataUriBytes("data:application/octet-stream;base64,AAEC")).toEqual({
      mimeType: "application/octet-stream",
      bytes: new Uint8Array([0, 1, 2]),
    });
    expect(new TextDecoder().decode(dataUriBytes("data:text/plain,a%20b").bytes)).toBe("a b");
  });
});
