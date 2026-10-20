// SPDX-License-Identifier: Apache-2.0
/**
 * The asset loader of the 3D scene. It loads the glTF files of the manifest in the render worker (or on the main
 * thread in the fallback path).
 *
 * - Only same-origin URLs, through fetch (`connect-src 'self'`). Before a parse, the loader checks the size and
 *   the SHA-256 of the bytes against the manifest, so a wrong or too large file never reaches a decoder.
 * - The GLTFLoader of Three.js without the glTF extensions that the assets do not use (vendor/GLTFLoader.js). A
 *   file with another extension fails to load.
 * - Meshes: EXT_meshopt_compression with the meshopt decoder of Three.js (WASM in the module, no workers).
 * - Textures: KHR_texture_basisu through the KTX2 loader without workers (ktx2.ts). The loader also replaces
 *   the image path of GLTFLoader: the stock path makes a Blob URL for each embedded image, and the CSP blocks a
 *   fetch of a Blob URL. A PNG, JPEG or WebP image goes to createImageBitmap(Blob) without a URL.
 * - A queue with 2 loads at a time: lower priority numbers first.
 *   A failed download gets one more try. The loader keeps each file once (a cache by URL).
 */
import { Texture, type Mesh, type Object3D, type WebGLRenderer } from "three";
import type { KTX2LoaderWorkerConfig } from "three/examples/jsm/loaders/KTX2Loader.js";
import { MeshoptDecoder } from "three/examples/jsm/libs/meshopt_decoder.module.js";
import { InThreadKtx2Loader, webgpuKtx2Config } from "./ktx2";
import type { GpuFeatures } from "./types";
import { GLTFLoader, type GLTF, type GLTFLoaderPlugin, type GLTFParser } from "./vendor/GLTFLoader.js";

/** A file that the renderer downloads: a same-origin URL, and the size and hash that the loader checks. */
export interface AssetFileRef {
  readonly url: string;
  readonly bytes: number;
  readonly sha256: string;
}

export type Fetcher = (url: string) => Promise<Response>;

export interface AssetLoaderOptions {
  /** The same-origin URL of basis_transcoder.wasm. */
  readonly basisWasm: string;
  /** The renderer for the compressed formats of the GPU; tests give `ktx2Config` in its place. */
  readonly renderer?: WebGLRenderer | null;
  /**
   * The features of the WebGPU device in place of `renderer`: the KTX2 target comes from them (`webgpuKtx2Config`).
   * The renderer of the WebGPU backend is not a WebGLRenderer.
   */
  readonly gpuFeatures?: GpuFeatures | null;
  readonly ktx2Config?: KTX2LoaderWorkerConfig;
  readonly fetch?: Fetcher;
  /** Loads at the same time (default 2). */
  readonly concurrency?: number;
}

/** The URL of a file on the origin of the app; a URL of another origin throws. */
export function sameOrigin(url: string): string {
  const base = (globalThis as { location?: { href: string; origin: string } }).location;
  if (base === undefined) return url;
  const resolved = new URL(url, base.href);
  if (resolved.origin !== base.origin) throw new Error(`The 3D asset ${url} is not on the origin of the app.`);
  return resolved.href;
}

function hex(buffer: ArrayBuffer): string {
  return [...new Uint8Array(buffer)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Download a file and check its size and SHA-256 against the manifest. */
export async function verifiedBytes(ref: AssetFileRef, fetcher: Fetcher): Promise<ArrayBuffer> {
  const response = await fetcher(sameOrigin(ref.url));
  if (!response.ok) throw new Error(`The 3D asset ${ref.url} gave HTTP ${String(response.status)}.`);
  const announced = Number(response.headers.get("content-length") ?? Number.NaN);
  if (Number.isFinite(announced) && announced > ref.bytes) {
    throw new Error(`The 3D asset ${ref.url} is larger than its manifest size.`);
  }
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength !== ref.bytes) throw new Error(`The 3D asset ${ref.url} has a wrong size.`);
  const digest = hex(await crypto.subtle.digest("SHA-256", bytes));
  if (digest !== ref.sha256) throw new Error(`The 3D asset ${ref.url} has a wrong hash.`);
  return bytes;
}

interface ImageDef {
  readonly bufferView?: number;
  readonly mimeType?: string;
  readonly uri?: string;
}

interface TextureDef {
  readonly extensions?: { readonly KHR_texture_basisu?: { readonly source: number } };
}

interface ParserJson {
  readonly images?: readonly ImageDef[];
  readonly textures?: readonly TextureDef[];
}

/** The image of an embedded image source, without a Blob URL. */
function embeddedImage(parser: GLTFParser, ktx2: InThreadKtx2Loader, sourceIndex: number): Promise<Texture> {
  const json = parser.json as ParserJson;
  const source = json.images?.[sourceIndex];
  if (source?.bufferView === undefined) {
    return Promise.reject(new Error("A 3D asset has an image that is not in its file."));
  }
  const mimeType = source.mimeType ?? "";
  return (parser.getDependency("bufferView", source.bufferView) as Promise<ArrayBuffer>).then(async (view) => {
    let texture: Texture;
    if (mimeType === "image/ktx2") {
      texture = await ktx2.transcode(view.slice(0));
    } else {
      if (typeof createImageBitmap !== "function") throw new Error("This browser has no createImageBitmap.");
      const bitmap = await createImageBitmap(new Blob([view], { type: mimeType }), { premultiplyAlpha: "none" });
      texture = new Texture(bitmap);
      texture.needsUpdate = true;
    }
    texture.userData.mimeType = mimeType;
    return texture;
  });
}

/**
 * A GLTFLoader plugin with the name of KHR_texture_basisu, so it takes the place of the stock plugin. It sends
 * KTX2 textures to the loader without workers, and it replaces `loadImageSource` of the parser for every image.
 */
export function safeTexturePlugin(
  ktx2: InThreadKtx2Loader,
  onError?: (parser: GLTFParser, error: unknown) => void,
): (parser: GLTFParser) => GLTFLoaderPlugin {
  return (parser) => {
    const sources = new Map<number, Promise<Texture>>();
    parser.loadImageSource = (sourceIndex: number): Promise<Texture> => {
      const known = sources.get(sourceIndex);
      if (known !== undefined) return known.then((texture) => texture.clone());
      // GLTFLoader keeps a material without its texture when the texture fails; the loader must know it.
      const made = embeddedImage(parser, ktx2, sourceIndex).catch((error: unknown) => {
        onError?.(parser, error);
        throw error;
      });
      sources.set(sourceIndex, made);
      return made;
    };
    return {
      name: "KHR_texture_basisu",
      loadTexture: (textureIndex: number) => {
        const extension = (parser.json as ParserJson).textures?.[textureIndex]?.extensions?.KHR_texture_basisu;
        if (extension === undefined) return null;
        return parser.loadTextureImage(textureIndex, extension.source, ktx2);
      },
    };
  };
}

interface Task {
  readonly url: string;
  priority: number;
  readonly order: number;
  readonly run: () => Promise<void>;
}

/** Free the geometries, materials and textures of a loaded file. */
export function disposeModel(root: Object3D): void {
  root.traverse((child) => {
    if ((child as Partial<Mesh>).isMesh !== true) return;
    const mesh = child as Mesh;
    mesh.geometry.dispose();
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const material of materials) {
      for (const value of Object.values(material)) {
        if (value instanceof Texture) value.dispose();
      }
      material.dispose();
    }
  });
}

export class AssetLoader {
  private readonly gltf: GLTFLoader;
  private readonly ktx2: InThreadKtx2Loader;
  private readonly fetcher: Fetcher;
  private readonly cache = new Map<string, Promise<GLTF>>();
  /** The first texture error of each parse: a model without its textures is a failed model. */
  private readonly textureErrors = new WeakMap<GLTFParser, unknown>();
  private readonly queue: Task[] = [];
  private readonly concurrency: number;
  private running = 0;
  private order = 0;
  private disposed = false;

  constructor(options: AssetLoaderOptions) {
    this.fetcher = options.fetch ?? ((url) => fetch(url, { credentials: "same-origin" }));
    const wasmRef = options.basisWasm;
    this.ktx2 = new InThreadKtx2Loader(async () => {
      const response = await this.fetcher(sameOrigin(wasmRef));
      if (!response.ok) throw new Error("The Basis transcoder did not load.");
      return response.arrayBuffer();
    });
    if (options.renderer !== undefined && options.renderer !== null) this.ktx2.detectSupport(options.renderer);
    // The WebGPU backend gives the features of its device.
    if (options.gpuFeatures !== undefined && options.gpuFeatures !== null) {
      this.ktx2.workerConfig = webgpuKtx2Config(options.gpuFeatures);
    }
    if (options.ktx2Config !== undefined) this.ktx2.workerConfig = options.ktx2Config;
    this.gltf = new GLTFLoader();
    this.gltf.setMeshoptDecoder(MeshoptDecoder);
    this.gltf.setKTX2Loader(this.ktx2);
    this.gltf.register(
      safeTexturePlugin(this.ktx2, (parser, error) => {
        this.textureErrors.set(parser, error);
      }),
    );
    this.concurrency = options.concurrency ?? 2;
  }

  /** Load a glTF file once. A lower priority number loads first. */
  load(ref: AssetFileRef, priority: number): Promise<GLTF> {
    const known = this.cache.get(ref.url);
    if (known !== undefined) {
      // A waiting load can move up the queue.
      const waiting = this.queue.find((task) => task.url === ref.url);
      if (waiting !== undefined) waiting.priority = Math.min(waiting.priority, priority);
      return known;
    }
    const made = new Promise<GLTF>((resolve, reject) => {
      this.queue.push({
        url: ref.url,
        priority,
        order: this.order++,
        run: async () => {
          try {
            resolve(await this.fetchAndParse(ref));
          } catch (error) {
            reject(error instanceof Error ? error : new Error(String(error)));
          }
        },
      });
      this.pump();
    });
    this.cache.set(ref.url, made);
    // A failed file can load again on a later request.
    made.catch(() => {
      if (this.cache.get(ref.url) === made) this.cache.delete(ref.url);
    });
    return made;
  }

  /** Free every loaded file. Loads that are not done stop at their next step. */
  dispose(): void {
    this.disposed = true;
    this.queue.length = 0;
    for (const pending of this.cache.values()) {
      pending.then((gltf) => disposeModel(gltf.scene)).catch(() => undefined);
    }
    this.cache.clear();
    this.ktx2.dispose();
  }

  private async fetchAndParse(ref: AssetFileRef): Promise<GLTF> {
    let bytes: ArrayBuffer;
    try {
      bytes = await verifiedBytes(ref, this.fetcher);
    } catch {
      // One more try: a network failure or a cut download.
      bytes = await verifiedBytes(ref, this.fetcher);
    }
    if (this.disposed) throw new Error("The asset loader stopped.");
    const gltf = await this.gltf.parseAsync(bytes, "");
    if (this.textureErrors.has(gltf.parser)) {
      disposeModel(gltf.scene);
      const cause = this.textureErrors.get(gltf.parser);
      throw new Error(`A texture of the 3D asset ${ref.url} did not load.`, { cause });
    }
    return gltf;
  }

  private pump(): void {
    while (this.running < this.concurrency && this.queue.length > 0 && !this.disposed) {
      this.queue.sort((a, b) => a.priority - b.priority || a.order - b.order);
      const task = this.queue.shift();
      if (task === undefined) return;
      this.running += 1;
      void task.run().finally(() => {
        this.running -= 1;
        this.pump();
      });
    }
  }
}
