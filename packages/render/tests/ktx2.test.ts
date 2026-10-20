// SPDX-License-Identifier: Apache-2.0
// KTX2 without Blob workers. The Basis transcoder of Three.js runs in the same thread with the WASM bytes of the app.
// It transcodes ETC1S and UASTC files to the format of the GPU.
import { describe, expect, it } from "bun:test";
import { RGBA_ASTC_4x4_Format, RGBA_S3TC_DXT1_Format, RGBAFormat, type CompressedTexture } from "three";
import type { KTX2LoaderWorkerConfig } from "three/examples/jsm/loaders/KTX2Loader.js";
import { InThreadKtx2Loader, loadBasisModule, transcodeKtx2, transcoderFormat } from "../src/ktx2";
import { basisWasm, failure, sampleKtx2 } from "./fixtures";

const NONE: KTX2LoaderWorkerConfig = {
  astcSupported: false,
  astcHDRSupported: false,
  etc1Supported: false,
  etc2Supported: false,
  dxtSupported: false,
  bptcSupported: false,
  pvrtcSupported: false,
};

describe("KTX2 in the same thread", () => {
  it("chooses the target format as KTX2Loader does", () => {
    expect(transcoderFormat(NONE, false, 64, 32, false).engine).toBe(RGBAFormat);
    expect(transcoderFormat({ ...NONE, dxtSupported: true }, false, 64, 32, false).engine).toBe(RGBA_S3TC_DXT1_Format);
    expect(transcoderFormat({ ...NONE, astcSupported: true }, true, 64, 32, false).engine).toBe(RGBA_ASTC_4x4_Format);
    // ASTC is a UASTC target only; an ETC1S file without other formats gets RGBA.
    expect(transcoderFormat({ ...NONE, astcSupported: true }, false, 64, 32, false).engine).toBe(RGBAFormat);
  });

  it("transcodes ETC1S and UASTC files with every mip level", async () => {
    const module = await loadBasisModule(basisWasm());
    for (const uastc of [false, true]) {
      const result = transcodeKtx2(module, await sampleKtx2(uastc), NONE);
      expect(result.width).toBe(64);
      expect(result.height).toBe(32);
      const mipmaps = result.faces[0]?.mipmaps ?? [];
      expect(mipmaps).toHaveLength(7);
      expect(mipmaps[0]?.data.byteLength).toBe(64 * 32 * 4);
      expect(mipmaps[1]?.width).toBe(32);
      const dxt = transcodeKtx2(module, await sampleKtx2(uastc), { ...NONE, dxtSupported: true });
      expect(dxt.format).toBe(RGBA_S3TC_DXT1_Format);
      expect(dxt.faces[0]?.mipmaps[0]?.data.byteLength).toBe((64 / 4) * (32 / 4) * 8);
    }
  });

  it("gives a compressed texture through the KTX2Loader interface, without a worker", async () => {
    const loader = new InThreadKtx2Loader(() => Promise.resolve(basisWasm()));
    loader.workerConfig = { ...NONE, dxtSupported: true };
    const texture: CompressedTexture = await loader.transcode(await sampleKtx2(false));
    expect(texture.isCompressedTexture).toBe(true);
    expect(texture.mipmaps).toHaveLength(7);
    expect(texture.format).toBe(RGBA_S3TC_DXT1_Format);
    expect(texture.colorSpace).toBe("srgb");
    expect(loader.workerSourceURL).toBe("");
    expect(await failure(loader.transcode(new Uint8Array([1, 2, 3, 4]).buffer))).not.toBe("");
    loader.dispose();
  });
});
