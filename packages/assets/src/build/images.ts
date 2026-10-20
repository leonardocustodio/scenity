// SPDX-License-Identifier: Apache-2.0
/**
 * The image decoders of the asset build: PNG (fast-png), JPEG (jpeg-js) and WebP and AVIF (the WASM decoders
 * of jSquash). Each decoder is JavaScript or WASM, so the same file gives the same pixels on each machine, and the
 * build stays deterministic. The format comes from the header of the file, not from its MIME type or its name.
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import jpeg from "jpeg-js";
import { sniffTextureInfo, type TextureFormat } from "../import/textureInfo";
import { decodePng, type Rgba } from "./textures";

/** The formats that the build decodes. A Radiance HDR file is an environment map: the build keeps its bytes. */
export const DECODED_FORMATS: ReadonlySet<TextureFormat> = new Set(["png", "jpeg", "webp", "avif"]);

/** The jSquash decoder module of one format. */
interface WasmDecoder {
  init(module: WebAssembly.Module): Promise<void>;
  default(buffer: ArrayBuffer): Promise<{ width: number; height: number; data: Uint8ClampedArray }>;
}

const decoders = new Map<"webp" | "avif", Promise<WasmDecoder>>();

/**
 * Run the start of a jSquash decoder. In Bun, the Emscripten glue of jSquash sets `self.location` to `{ href: "" }`.
 * Later code in the same process then fails on `new URL(path, location.href)`, so this function removes the value.
 */
async function withoutLocation<T>(start: () => Promise<T>): Promise<T> {
  const before = Object.getOwnPropertyDescriptor(globalThis, "location");
  try {
    return await start();
  } finally {
    if (before === undefined) Reflect.deleteProperty(globalThis, "location");
    else Object.defineProperty(globalThis, "location", before);
  }
}

/** The decoder of a WASM format, started once with the WASM file of its package (no fetch). */
function wasmDecoder(format: "webp" | "avif"): Promise<WasmDecoder> {
  let decoder = decoders.get(format);
  if (decoder === undefined) {
    decoder = withoutLocation(async () => {
      const module = (await (format === "webp"
        ? import("@jsquash/webp/decode.js")
        : import("@jsquash/avif/decode.js"))) as unknown as WasmDecoder;
      const require = createRequire(import.meta.url);
      const wasm = readFileSync(require.resolve(`@jsquash/${format}/codec/dec/${format}_dec.wasm`));
      await module.init(new WebAssembly.Module(wasm));
      return module;
    });
    decoders.set(format, decoder);
  }
  return decoder;
}

/** The format of an image file from its header, or null for a file that the build does not decode. */
export function imageFormat(bytes: Uint8Array): TextureFormat | null {
  const format = sniffTextureInfo(bytes)?.format ?? null;
  return format !== null && DECODED_FORMATS.has(format) ? format : null;
}

/** Decode a PNG, JPEG, WebP or AVIF file to 8-bit RGBA. Throws for another format. */
export async function decodeImage(bytes: Uint8Array): Promise<Rgba> {
  const format = imageFormat(bytes);
  if (format === "png") return decodePng(bytes);
  if (format === "jpeg") {
    const image = jpeg.decode(bytes, { useTArray: true, formatAsRGBA: true, maxMemoryUsageInMB: 2048 });
    return { width: image.width, height: image.height, data: image.data };
  }
  if (format === "webp" || format === "avif") {
    const decoder = await wasmDecoder(format);
    const copy = bytes.slice().buffer;
    const image = await decoder.default(copy);
    return { width: image.width, height: image.height, data: new Uint8Array(image.data.buffer, 0, image.data.length) };
  }
  throw new Error("the image is not PNG, JPEG, WebP or AVIF");
}
