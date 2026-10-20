// SPDX-License-Identifier: Apache-2.0
/**
 * Textures of the 3D asset build: decode a PNG, make the tier size, and encode KTX2 with Basis Universal (WASM, in
 * this process). The project gives the codec of each texture role (settings.ts). The role sets the colour space. The
 * defaults:
 *
 * - color (base color, emissive; sRGB): ETC1S, small files;
 * - normal maps: UASTC with the normal-map mode, rate-distortion optimization and Zstandard supercompression
 *   (ETC1S gives visible blocks on normal maps);
 * - other linear data (occlusion, roughness, metalness): ETC1S without the sRGB transfer function. UASTC made
 *   these files too large for the character budget (1 MB for one 1024 px ORM texture).
 *
 * All textures have mipmaps (a texture asset can disable them). The encoder runs on one thread, so the same input
 * gives the same bytes.
 */
import { decode } from "fast-png";
import { encodeToKTX2 } from "ktx2-encoder";
import type { TextureCodec, TextureRole } from "./settings";

export interface Rgba {
  readonly width: number;
  readonly height: number;
  /** 8-bit RGBA, rows from the top. */
  readonly data: Uint8Array;
}

/** Decode a PNG to 8-bit RGBA (gray, gray-alpha, RGB, palette and 16-bit inputs too). */
export function decodePng(bytes: Uint8Array): Rgba {
  const png = decode(bytes);
  const { width, height } = png;
  const out = new Uint8Array(width * height * 4);
  const source = png.data;
  const scale = png.depth === 16 ? 1 / 257 : 1;
  const palette = png.palette;
  for (let i = 0; i < width * height; i++) {
    let r: number, g: number, b: number, a: number;
    if (palette !== undefined) {
      const entry = palette[source[i] ?? 0] ?? [0, 0, 0];
      r = entry[0] ?? 0;
      g = entry[1] ?? 0;
      b = entry[2] ?? 0;
      a = entry[3] ?? 255;
    } else {
      const c = png.channels;
      const at = (k: number): number => Math.round((source[i * c + k] ?? 0) * scale);
      if (c === 1) [r, g, b, a] = [at(0), at(0), at(0), 255];
      else if (c === 2) [r, g, b, a] = [at(0), at(0), at(0), at(1)];
      else if (c === 3) [r, g, b, a] = [at(0), at(1), at(2), 255];
      else [r, g, b, a] = [at(0), at(1), at(2), at(3)];
    }
    out.set([r, g, b, a], i * 4);
  }
  return { width, height, data: out };
}

/** Half the size with a 2×2 box filter (an odd edge keeps its last row or column). */
export function halve(image: Rgba): Rgba {
  const width = Math.max(1, image.width >> 1);
  const height = Math.max(1, image.height >> 1);
  const out = new Uint8Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const x0 = Math.min(image.width - 1, x * 2);
      const x1 = Math.min(image.width - 1, x * 2 + 1);
      const y0 = Math.min(image.height - 1, y * 2);
      const y1 = Math.min(image.height - 1, y * 2 + 1);
      for (let k = 0; k < 4; k++) {
        const sum =
          (image.data[(y0 * image.width + x0) * 4 + k] ?? 0) +
          (image.data[(y0 * image.width + x1) * 4 + k] ?? 0) +
          (image.data[(y1 * image.width + x0) * 4 + k] ?? 0) +
          (image.data[(y1 * image.width + x1) * 4 + k] ?? 0);
        out[(y * width + x) * 4 + k] = (sum + 2) >> 2;
      }
    }
  }
  return { width, height, data: out };
}

/** Make the image fit in `maxSize` (halve until it fits), then halve `extraHalvings` more times. */
export function fit(image: Rgba, maxSize: number, extraHalvings: number): Rgba {
  let current = image;
  while (Math.max(current.width, current.height) > maxSize) current = halve(current);
  for (let i = 0; i < extraHalvings; i++) current = halve(current);
  return current;
}

let quiet = false;

/**
 * The Basis encoder module prints its progress through console.log. Emscripten keeps the print function that
 * exists when the module starts, so the first encode starts the module with a silent console.
 */
async function silenceFirstStart<T>(run: () => Promise<T>): Promise<T> {
  if (quiet) return run();
  const log = console.log;
  const error = console.error;
  console.log = () => undefined;
  console.error = () => undefined;
  try {
    return await run();
  } finally {
    console.log = log;
    console.error = error;
    quiet = true;
  }
}

/** Encode RGBA pixels as a KTX2 file with the codec of a role, with mipmaps or without them. */
export async function encodeKtx2(
  image: Rgba,
  codec: TextureCodec,
  role: TextureRole,
  mipmaps = true,
): Promise<Uint8Array> {
  const decoder = () => Promise.resolve({ width: image.width, height: image.height, data: image.data });
  // The encoder asks for an image buffer. The decoder above gives the pixels, so the buffer is only a key.
  const key = new Uint8Array([0]);
  const srgb = role === "color";
  const options =
    codec === "uastc"
      ? {
          isUASTC: true,
          uastcLDRQualityLevel: 2,
          enableRDO: true,
          rdoQualityLevel: 2,
          needSupercompression: true,
          isNormalMap: role === "normal",
          isPerceptual: srgb,
          isSetKTX2SRGBTransferFunc: srgb,
          generateMipmap: mipmaps,
          imageDecoder: decoder,
        }
      : {
          isUASTC: false,
          qualityLevel: 160,
          compressionLevel: 2,
          isPerceptual: srgb,
          isSetKTX2SRGBTransferFunc: srgb,
          ...(role === "normal" ? { isNormalMap: true } : {}),
          generateMipmap: mipmaps,
          imageDecoder: decoder,
        };
  return silenceFirstStart(() => encodeToKTX2(key, options));
}

/** The width and height of a KTX2 file (from its header). */
export function ktx2Size(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(20, true), height: view.getUint32(24, true) };
}
