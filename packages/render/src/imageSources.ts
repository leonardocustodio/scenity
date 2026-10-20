// SPDX-License-Identifier: Apache-2.0
/**
 * The images and the buffers of the generic glTF loader. The plugin replaces the
 * image path and the buffer path of GLTFLoader, as the plugin of the room loader does (assets.ts), and it also reads
 * the files that a glTF file names by URI:
 *
 * - An image goes to `createImageBitmap(Blob)` in every browser, with the options of the ImageBitmapLoader of three.js
 *   (no premultiplied alpha, no colour space conversion). The stock loader uses a DOM image loader in Safari before 17,
 *   which a worker does not have, and a Blob URL for an embedded image, which the CSP blocks.
 * - A KTX2 image goes to the KTX2 loader without workers.
 * - A URI is a same-origin URL relative to the glTF file, or a data URI. The plugin decodes a data URI itself: the CSP
 *   has `connect-src 'self'`, so a fetch of a data URI fails.
 */
import { Texture } from "three";
import type { Fetcher } from "./assets";
import { sameOrigin } from "./assets";
import type { InThreadKtx2Loader } from "./ktx2";
import type { GLTFLoaderPlugin, GLTFParser } from "./vendor/GLTFLoaderGeneric.js";

/** The decoder of an image file: `createImageBitmap` in a browser; a test gives another one. */
export type ImageDecoder = (blob: Blob) => Promise<ImageBitmap | TexImageSource | object>;

interface ImageDef {
  readonly bufferView?: number;
  readonly mimeType?: string;
  readonly uri?: string;
}

interface BufferDef {
  readonly uri?: string;
}

interface ParserJson {
  readonly images?: readonly ImageDef[];
  readonly buffers?: readonly BufferDef[];
  readonly textures?: readonly {
    readonly extensions?: { readonly KHR_texture_basisu?: { readonly source: number } };
  }[];
}

/** The decoder of the ImageBitmapLoader of three.js: the same options, so the same pixels. */
export function bitmapDecoder(blob: Blob): Promise<ImageBitmap> {
  if (typeof createImageBitmap !== "function") throw new Error("This browser has no createImageBitmap.");
  return createImageBitmap(blob, { premultiplyAlpha: "none", colorSpaceConversion: "none" });
}

/** The MIME type and the bytes of a data URI with base64 or percent-encoded data. */
export function dataUriBytes(uri: string): { readonly mimeType: string; readonly bytes: Uint8Array } {
  const comma = uri.indexOf(",");
  if (!uri.startsWith("data:") || comma < 0) throw new Error("A 3D asset has a bad data URI.");
  const head = uri.slice(5, comma);
  const data = uri.slice(comma + 1);
  const mimeType = head.split(";")[0] ?? "";
  if (head.endsWith(";base64")) return { mimeType, bytes: Uint8Array.from(atob(data), (char) => char.charCodeAt(0)) };
  return { mimeType, bytes: new TextEncoder().encode(decodeURIComponent(data)) };
}

/** The MIME type of an image URI from its file name extension, as GLTFLoader does. */
function mimeOfUri(uri: string): string {
  if (/\.jpe?g($|\?)/i.test(uri) || uri.startsWith("data:image/jpeg")) return "image/jpeg";
  if (/\.webp($|\?)/i.test(uri) || uri.startsWith("data:image/webp")) return "image/webp";
  if (/\.ktx2($|\?)/i.test(uri) || uri.startsWith("data:image/ktx2")) return "image/ktx2";
  if (/\.avif($|\?)/i.test(uri) || uri.startsWith("data:image/avif")) return "image/avif";
  return "image/png";
}

/** The context of the plugin: the fetch, the KTX2 loader, the image decoder and the first error of each parse. */
export interface SourceContext {
  readonly fetcher: Fetcher;
  readonly ktx2: InThreadKtx2Loader;
  readonly decode: ImageDecoder;
  readonly onError: (parser: GLTFParser, error: unknown) => void;
}

/** The bytes of a URI of a glTF file: a data URI, else a same-origin URL relative to the file. */
async function uriBytes(context: SourceContext, uri: string, base: string): Promise<ArrayBuffer> {
  if (uri.startsWith("data:")) return dataUriBytes(uri).bytes.slice().buffer;
  const page = (globalThis as { location?: { href: string } }).location?.href ?? "http://localhost/";
  const url = sameOrigin(new URL(uri, new URL(base || ".", page)).href);
  const response = await context.fetcher(url);
  if (!response.ok) throw new Error(`The file ${uri} of a 3D asset gave HTTP ${String(response.status)}.`);
  return response.arrayBuffer();
}

/** The texture of an image source: from a buffer view of the file or from a URI. */
async function imageTexture(context: SourceContext, parser: GLTFParser, source: ImageDef): Promise<Texture> {
  let bytes: ArrayBuffer;
  if (source.bufferView !== undefined) {
    bytes = (await parser.getDependency("bufferView", source.bufferView)) as ArrayBuffer;
  } else if (source.uri !== undefined) {
    bytes = await uriBytes(context, source.uri, (parser.options as { path?: string }).path ?? "");
  } else {
    throw new Error("A 3D asset has an image with no URI and no buffer view.");
  }
  const mimeType = source.mimeType ?? mimeOfUri(source.uri ?? "");
  let texture: Texture;
  if (mimeType === "image/ktx2") {
    texture = await context.ktx2.transcode(bytes.slice(0));
  } else {
    texture = new Texture(await context.decode(new Blob([bytes], { type: mimeType })));
    texture.needsUpdate = true;
  }
  texture.userData.mimeType = mimeType;
  return texture;
}

/**
 * A GLTFLoader plugin with the name of KHR_texture_basisu, so it takes the place of the stock plugin. It replaces
 * `loadImageSource` and `loadBuffer` of the parser (see the module comment).
 */
export function genericSourcePlugin(context: SourceContext): (parser: GLTFParser) => GLTFLoaderPlugin {
  return (parser) => {
    const json = parser.json as ParserJson;
    const sources = new Map<number, Promise<Texture>>();
    parser.loadImageSource = (sourceIndex: number): Promise<Texture> => {
      const known = sources.get(sourceIndex);
      if (known !== undefined) return known.then((texture) => texture.clone());
      // GLTFLoader keeps a material without its texture when the texture fails; the loader must know it.
      const made = imageTexture(context, parser, json.images?.[sourceIndex] ?? {}).catch((error: unknown) => {
        context.onError(parser, error);
        throw error;
      });
      sources.set(sourceIndex, made);
      return made;
    };
    const stockBuffer = parser.loadBuffer.bind(parser);
    parser.loadBuffer = (bufferIndex: number): Promise<ArrayBuffer> => {
      const uri = json.buffers?.[bufferIndex]?.uri;
      if (uri === undefined) return stockBuffer(bufferIndex);
      return uriBytes(context, uri, (parser.options as { path?: string }).path ?? "");
    };
    return {
      name: "KHR_texture_basisu",
      loadTexture: (textureIndex: number) => {
        const extension = json.textures?.[textureIndex]?.extensions?.KHR_texture_basisu;
        if (extension === undefined) return null;
        return parser.loadTextureImage(textureIndex, extension.source, context.ktx2);
      },
    };
  };
}
