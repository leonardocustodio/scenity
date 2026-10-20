// SPDX-License-Identifier: Apache-2.0
// The test files of the renderer tests: the Basis transcoder WASM and a small KTX2 file, made in memory.
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { encode } from "fast-png";
import { encodeToKTX2 } from "ktx2-encoder";

export function basisWasm(): ArrayBuffer {
  const require = createRequire(import.meta.url);
  const path = require.resolve("three/examples/jsm/libs/basis/basis_transcoder.wasm");
  const bytes = readFileSync(path);
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

/** A KTX2 file of a 64 × 32 test image with mipmaps. */
export async function sampleKtx2(uastc: boolean): Promise<ArrayBuffer> {
  const width = 64;
  const height = 32;
  const data = new Uint8Array(width * height * 4);
  for (let index = 0; index < width * height; index += 1) {
    data[index * 4] = (index * 3) % 256;
    data[index * 4 + 1] = (index * 7) % 256;
    data[index * 4 + 2] = 128;
    data[index * 4 + 3] = 255;
  }
  const png = encode({ width, height, data, channels: 4 });
  const quiet = console.log;
  console.log = () => undefined;
  try {
    const out = await encodeToKTX2(png, {
      isUASTC: uastc,
      generateMipmap: true,
      isPerceptual: !uastc,
      isSetKTX2SRGBTransferFunc: !uastc,
      qualityLevel: 128,
      compressionLevel: 1,
      imageDecoder: () => Promise.resolve({ width, height, data }),
    });
    return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength) as ArrayBuffer;
  } finally {
    console.log = quiet;
  }
}

/** The message of a promise that must fail ("" when it does not fail). */
export async function failure(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}
