// SPDX-License-Identifier: Apache-2.0
// The KTX2 target of the generic asset loader. The WebGPU device gives its features only after `init()`, so the
// document core gives the loader a promise of them. The loader waits for the promise before each KTX2 transcode. Each
// texture then has a compressed format of the device, and each mip level has its width and height. The WebGPU backend
// of three.js reads them in `_copyCompressedBufferToTexture`.
import { describe, expect, it } from "bun:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { RGBA_BPTC_Format, RGBAFormat, type CompressedTexture, type Mesh, type Texture } from "three";
import { GenericAssetLoader } from "../src/genericAssets";
import type { TextureSupport } from "../src/types";
import { basisWasm, sampleKtx2 } from "./fixtures";

const SHOWROOM_BUILD = join(import.meta.dir, "../../../samples/showroom/build");
const BUILT_FILES = existsSync(SHOWROOM_BUILD)
  ? readdirSync(SHOWROOM_BUILD).filter((name) => name.endsWith(".glb"))
  : [];

/** The features of a WebGPU device with the BC family (a desktop GPU), given after a delay as `init()` does. */
function lateSupport(): Promise<TextureSupport> {
  const features = new Set(["texture-compression-bc"]);
  return new Promise((resolve) => setTimeout(() => resolve({ gpuFeatures: features }), 20));
}

/** A loader whose fetch gives the Basis WASM, the bytes of `files` by URL, and 404 for another URL. */
function loaderOf(files: Readonly<Record<string, ArrayBuffer>>): GenericAssetLoader {
  return new GenericAssetLoader({
    decoders: { basisWasm: "/basis.wasm" },
    support: lateSupport(),
    fetch: (url) => {
      const path = new URL(url, "http://localhost/").pathname;
      const bytes = path === "/basis.wasm" ? basisWasm() : files[path];
      return Promise.resolve(bytes === undefined ? new Response("", { status: 404 }) : new Response(bytes));
    },
  });
}

/** The width and the height of each mip level of a compressed texture. */
function mipSizes(texture: CompressedTexture): number[][] {
  return texture.mipmaps.map((mip) => [mip.width, mip.height]);
}

/** Each level halves the size of the level before it, down to 1. */
function halvedSizes(width: number, height: number, count: number): number[][] {
  return Array.from({ length: count }, (_, level) => [Math.max(1, width >> level), Math.max(1, height >> level)]);
}

describe("the KTX2 target of the generic asset loader", () => {
  it("waits for a target that comes later and gives each mip level its size", async () => {
    const loader = loaderOf({ "/sample.ktx2": await sampleKtx2(false) });
    const texture = (await loader.texture({ url: "/sample.ktx2" })) as CompressedTexture;
    expect(texture.isCompressedTexture).toBe(true);
    // ETC1S with the BC family only: BC7 (BPTC), not the RGBA fallback that WebGPU cannot upload as compressed data.
    expect(texture.format).toBe(RGBA_BPTC_Format);
    expect(mipSizes(texture)).toEqual(halvedSizes(64, 32, 7));
    loader.dispose();
  });

  it("transcodes the textures of the showroom build to a compressed format of the device", async () => {
    expect(BUILT_FILES.length).toBeGreaterThan(0);
    const files = Object.fromEntries(
      BUILT_FILES.map((name) => {
        const bytes = readFileSync(join(SHOWROOM_BUILD, name));
        return [`/build/${name}`, bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)];
      }),
    );
    const loader = loaderOf(files);
    let count = 0;
    for (const name of BUILT_FILES) {
      const gltf = await loader.load({ url: `/build/${name}` });
      gltf.scene.traverse((object) => {
        const material = (object as Partial<Mesh>).material;
        for (const value of Object.values([material].flat()[0] ?? {})) {
          const texture = value as Partial<Texture> | null;
          if (texture?.isTexture !== true) continue;
          const compressed = texture as CompressedTexture;
          expect(compressed.isCompressedTexture).toBe(true);
          expect(compressed.format).not.toBe(RGBAFormat);
          const { width, height } = compressed.image;
          expect(mipSizes(compressed)).toEqual(halvedSizes(width, height, compressed.mipmaps.length));
          count += 1;
        }
      });
    }
    expect(count).toBeGreaterThan(0);
    loader.dispose();
  }, 60_000);
});
