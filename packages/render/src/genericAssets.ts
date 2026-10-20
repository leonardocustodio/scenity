// SPDX-License-Identifier: Apache-2.0
/**
 * The asset loader of the generic scene worker. It loads the glTF files of the asset records in the render worker,
 * or on the main thread in the fallback path. The loader of the 3D room (assets.ts) is a separate module, so the
 * room workers do not get larger.
 *
 * - The generic GLTFLoader (vendor/GLTFLoaderGeneric.js, `trimGltf.ts --loader generic`): the extensions of the room
 *   loader, the lights, the physical materials, unlit, WebP, AVIF, GPU instancing and Draco. A file with another
 *   extension fails to load.
 * - Draco is an optional chunk (dracoLoader.ts): the first Draco primitive imports the decoder.
 * - The images go to `createImageBitmap` in every browser, the KTX2 images to the KTX2 loader without workers, and
 *   the URIs of a glTF file to a same-origin fetch or a data URI decode (imageSources.ts).
 * - The size and SHA-256 checks of assets.ts run when a file reference has them (a built asset). A dev file (a source
 *   glTF of the project) has none, and loads with no check.
 * - At most 2 loads at a time; the asset cache of the scene builder keeps each loaded asset once.
 * - `texture` loads the texture asset of a material: a KTX2 file of a build, or a PNG, JPEG, WebP or AVIF file
 *   of a dev record. The texture has `flipY` false, as a texture of a glTF file.
 * - The KTX2 target can come later than the loader: the WebGPU device gives its features only after `init()`. The
 *   loader waits for the target before the first KTX2 transcode. Without this wait, the transcode chooses the RGBA
 *   fallback, and the WebGPU backend cannot upload a compressed texture with an RGBA format.
 */
import { Texture } from "three";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { disposeModel, sameOrigin, verifiedBytes, type Fetcher } from "./assets";
import { lazyDracoLoader } from "./dracoLoader";
import { bitmapDecoder, genericSourcePlugin, type ImageDecoder } from "./imageSources";
import { InThreadKtx2Loader, webgpuKtx2Config } from "./ktx2";
import type { TextureSupport } from "./types";
import { GLTFLoader, type GLTF, type GLTFParser } from "./vendor/GLTFLoaderGeneric.js";
import type { KTX2LoaderWorkerConfig } from "three/examples/jsm/loaders/KTX2Loader.js";

/** A file to load: a same-origin URL, and the size and the SHA-256 of a built file (absent for a dev file). */
export interface GenericFileRef {
  readonly url: string;
  readonly bytes?: number;
  readonly sha256?: string;
}

/** The same-origin URLs of the WASM decoders. An absent decoder fails the first file that needs it. */
export interface DecoderUrls {
  readonly basisWasm?: string;
  readonly dracoWasm?: string;
}

export interface GenericAssetLoaderOptions {
  readonly decoders?: DecoderUrls;
  /**
   * The renderer or the WebGPU features for the KTX2 target (the backend gives them: `textureSupport()`). A promise
   * gives them when the backend is ready; each KTX2 transcode waits for it.
   */
  readonly support?: TextureSupport | Promise<TextureSupport | null> | null;
  /** The KTX2 target in place of `support` (tests). */
  readonly ktx2Config?: KTX2LoaderWorkerConfig;
  readonly fetch?: Fetcher;
  /** The image decoder (default: createImageBitmap with the options of three.js); tests give another one. */
  readonly decode?: ImageDecoder;
  /** Loads at the same time (default 2). */
  readonly concurrency?: number;
}

/** The bytes of a file: with the size and SHA-256 checks when the reference has them. */
export async function fileBytes(ref: GenericFileRef, fetcher: Fetcher): Promise<ArrayBuffer> {
  if (ref.bytes !== undefined && ref.sha256 !== undefined && ref.sha256 !== "") {
    return verifiedBytes({ url: ref.url, bytes: ref.bytes, sha256: ref.sha256 }, fetcher);
  }
  const response = await fetcher(sameOrigin(ref.url));
  if (!response.ok) throw new Error(`The 3D asset ${ref.url} gave HTTP ${String(response.status)}.`);
  return response.arrayBuffer();
}

/** The first bytes of a KTX2 file: «KTX 20», then CR, LF, SUB and LF. */
const KTX2_MAGIC = [0xab, 0x4b, 0x54, 0x58, 0x20, 0x32, 0x30, 0xbb, 0x0d, 0x0a, 0x1a, 0x0a] as const;

/** True when the bytes start with the magic bytes of a KTX2 file. */
export function isKtx2(bytes: ArrayBuffer): boolean {
  const head = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, KTX2_MAGIC.length));
  return head.length === KTX2_MAGIC.length && KTX2_MAGIC.every((value, index) => head[index] === value);
}

/** The folder of a URL: the base of the relative URIs of a glTF file. */
function folderOf(url: string): string {
  return url.slice(0, url.lastIndexOf("/") + 1);
}

/** The WASM bytes of a decoder URL; the loader fetches each decoder once. */
function wasmOf(fetcher: Fetcher, url: string | undefined, name: string): () => Promise<ArrayBuffer> {
  let bytes: Promise<ArrayBuffer> | null = null;
  return () => {
    if (url === undefined) return Promise.reject(new Error(`The scene has no URL of the ${name} decoder.`));
    bytes ??= fetcher(sameOrigin(url)).then((response) => {
      if (!response.ok) throw new Error(`The ${name} decoder did not load.`);
      return response.arrayBuffer();
    });
    bytes.catch(() => {
      bytes = null;
    });
    return bytes;
  };
}

export class GenericAssetLoader {
  private readonly gltf = new GLTFLoader();
  private readonly ktx2: InThreadKtx2Loader;
  private readonly fetcher: Fetcher;
  /** The first texture error of each parse: a model without its textures is a failed model. */
  private readonly textureErrors = new WeakMap<GLTFParser, unknown>();
  private readonly waiting: (() => void)[] = [];
  private readonly concurrency: number;
  private readonly decode: ImageDecoder;
  /** Resolves when the KTX2 loader has the target of the GPU. */
  private readonly ktx2Target: Promise<void>;
  private running = 0;
  private disposed = false;

  constructor(options: GenericAssetLoaderOptions = {}) {
    this.fetcher = options.fetch ?? ((url) => fetch(url, { credentials: "same-origin" }));
    this.ktx2 = new InThreadKtx2Loader(wasmOf(this.fetcher, options.decoders?.basisWasm, "Basis"));
    const support = options.support ?? null;
    const config = options.ktx2Config;
    if (support instanceof Promise) {
      // A failed backend stops the core, so a rejected promise keeps the RGBA fallback.
      this.ktx2Target = support.then(
        (value) => {
          this.useTarget(value, config);
        },
        () => {
          this.useTarget(null, config);
        },
      );
    } else {
      this.useTarget(support, config);
      this.ktx2Target = Promise.resolve();
    }
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.gltf.setKTX2Loader(this.ktx2);
    this.gltf.setDRACOLoader(lazyDracoLoader(wasmOf(this.fetcher, options.decoders?.dracoWasm, "Draco")) as never);
    this.decode = options.decode ?? bitmapDecoder;
    this.gltf.register(
      genericSourcePlugin({
        fetcher: this.fetcher,
        ktx2: this.ktx2,
        decode: this.decode,
        onError: (parser, error) => {
          if (!this.textureErrors.has(parser)) this.textureErrors.set(parser, error);
        },
      }),
    );
    this.concurrency = options.concurrency ?? 2;
  }

  /** Set the KTX2 target from the support of the backend; `config` replaces it (tests). */
  private useTarget(support: TextureSupport | null, config: KTX2LoaderWorkerConfig | undefined): void {
    if (support !== null && "renderer" in support) this.ktx2.detectSupport(support.renderer);
    if (support !== null && "gpuFeatures" in support) this.ktx2.workerConfig = webgpuKtx2Config(support.gpuFeatures);
    if (config !== undefined) this.ktx2.workerConfig = config;
  }

  /** The bytes of a file (for example an environment map), with the checks of a built file. */
  bytes(ref: GenericFileRef): Promise<ArrayBuffer> {
    return this.limit(() => fileBytes(ref, this.fetcher));
  }

  /**
   * Load a texture file: a KTX2 file goes to the KTX2 loader, another image to the image decoder. The texture
   * has `flipY` false, as a glTF texture, so a KTX2 file of a build and its source image show the same way.
   */
  texture(ref: GenericFileRef): Promise<Texture> {
    return this.limit(async () => {
      const bytes = await fileBytes(ref, this.fetcher);
      if (this.disposed) throw new Error("The asset loader stopped.");
      if (isKtx2(bytes)) {
        await this.ktx2Target;
        return this.ktx2.transcode(bytes);
      }
      const texture = new Texture(await this.decode(new Blob([bytes])));
      texture.flipY = false;
      texture.needsUpdate = true;
      return texture;
    });
  }

  /** Load and parse a glTF or GLB file. */
  load(ref: GenericFileRef): Promise<GLTF> {
    return this.limit(async () => {
      const bytes = await fileBytes(ref, this.fetcher);
      if (this.disposed) throw new Error("The asset loader stopped.");
      return this.parse(bytes, folderOf(sameOrigin(ref.url)), ref.url);
    });
  }

  /** Parse the bytes of a glTF or GLB file; `base` is the folder of its relative URIs. */
  async parse(bytes: ArrayBuffer, base: string, name = "a file"): Promise<GLTF> {
    // The textures of the file can be KTX2 images: their transcode needs the target of the GPU.
    await this.ktx2Target;
    const gltf = await this.gltf.parseAsync(bytes, base);
    if (this.textureErrors.has(gltf.parser)) {
      disposeModel(gltf.scene);
      throw new Error(`A texture of the 3D asset ${name} did not load.`, {
        cause: this.textureErrors.get(gltf.parser),
      });
    }
    return gltf;
  }

  /** Stop the loads that wait. The scene builder frees the loaded assets. */
  dispose(): void {
    this.disposed = true;
    for (const start of this.waiting.splice(0)) start();
    this.ktx2.dispose();
  }

  /** Run a task when fewer than `concurrency` tasks run. */
  private async limit<T>(task: () => Promise<T>): Promise<T> {
    if (this.running >= this.concurrency) await new Promise<void>((resolve) => this.waiting.push(resolve));
    if (this.disposed) throw new Error("The asset loader stopped.");
    this.running += 1;
    try {
      return await task();
    } finally {
      this.running -= 1;
      this.waiting.shift()?.();
    }
  }
}
