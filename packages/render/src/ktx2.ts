// SPDX-License-Identifier: Apache-2.0
/**
 * KTX2 textures under the CSP of the app. The stock KTX2Loader of
 * Three.js starts its own workers from a Blob URL; `worker-src 'self'` and Trusted Types block that. This loader
 * runs the Basis Universal transcoder in the same thread: in the render worker, or on the main thread in the
 * fallback path.
 *
 * - The transcoder JavaScript is part of the bundle (a lazy chunk). The WASM file is a same-origin hashed file of
 *   the app; the loader fetches its bytes and gives them to the module, so no URL is built at run time.
 * - `script-src 'wasm-unsafe-eval'` allows the instantiation of the WASM bytes. The loader uses no eval, no
 *   `new Function`, no Blob and no object URL.
 * - The transcode is a TypeScript port of `KTX2Loader.BasisWorker` (Three.js r186) for ETC1S and UASTC LDR. The
 *   target format comes from the GPU support of `detectSupport(renderer)`, with the same order of preference.
 *   UASTC HDR is not supported (the art pipeline makes no HDR textures).
 */
import {
  RGB_ETC1_Format,
  RGB_ETC2_Format,
  RGB_PVRTC_4BPPV1_Format,
  RGBA_ASTC_4x4_Format,
  RGBA_BPTC_Format,
  RGBA_ETC2_EAC_Format,
  RGBA_PVRTC_4BPPV1_Format,
  RGBA_S3TC_DXT1_Format,
  RGBA_S3TC_DXT5_Format,
  RGBAFormat,
  UnsignedByteType,
  type CompressedPixelFormat,
  type CompressedTexture,
  type PixelFormat,
} from "three";
import { KTX2Loader, type KTX2LoaderWorkerConfig } from "three/examples/jsm/loaders/KTX2Loader.js";
import type { WorkerPool } from "three/examples/jsm/utils/WorkerPool.js";

/** The part of a KTX2 file object of the Basis transcoder that the port uses. */
interface BasisKtx2File {
  isValid(): boolean;
  isUASTC(): boolean;
  isETC1S(): boolean;
  isHDR(): boolean;
  getWidth(): number;
  getHeight(): number;
  getLayers(): number;
  getLevels(): number;
  getFaces(): number;
  getHasAlpha(): boolean;
  getDFDFlags(): number;
  startTranscoding(): boolean;
  getImageLevelInfo(
    level: number,
    layer: number,
    face: number,
  ): { origWidth: number; origHeight: number; width: number; height: number };
  getImageTranscodedSizeInBytes(level: number, layer: number, face: number, format: number): number;
  transcodeImage(
    dst: Uint8Array,
    level: number,
    layer: number,
    face: number,
    format: number,
    getAlphaForOpaqueFormats: number,
    channel0: number,
    channel1: number,
  ): number | boolean;
  close(): void;
  delete(): void;
}

export interface BasisModule {
  readonly KTX2File: new (data: Uint8Array) => BasisKtx2File;
  initializeBasis(): void;
}

type BasisFactory = (module: { wasmBinary: ArrayBuffer }) => Promise<BasisModule>;

/** The Basis Universal transcoder of Three.js with the WASM bytes of the app. */
export async function loadBasisModule(wasm: ArrayBuffer): Promise<BasisModule> {
  // An Emscripten file with `module.exports`: the bundler (and Bun) give it as the default export.
  const imported = (await import("./vendor/basis_transcoder.js")) as unknown as {
    readonly default?: BasisFactory | { readonly default?: BasisFactory };
  };
  const first = imported.default;
  const factory = typeof first === "function" ? first : first?.default;
  if (typeof factory !== "function") throw new Error("The Basis transcoder module has no factory.");
  const module = await factory({ wasmBinary: wasm });
  module.initializeBasis();
  return module;
}

/** The transcoder formats of Basis Universal (basis_transcoder.h). */
const TF = { ETC1: 0, ETC2: 1, BC1: 2, BC3: 3, BC7_M5: 7, PVRTC1_4_RGB: 8, PVRTC1_4_RGBA: 9, ASTC_4x4: 10, RGBA32: 13 };

type Feature = keyof KTX2LoaderWorkerConfig;

interface FormatOption {
  readonly if: Feature | null;
  readonly etc1s: boolean;
  /** [opaque, with alpha]. A single entry has no alpha variant. */
  readonly transcoder: readonly number[];
  readonly engine: readonly (CompressedPixelFormat | PixelFormat)[];
  readonly priorityETC1S: number;
  readonly priorityUASTC: number;
  readonly needsPowerOfTwo: boolean;
}

/** The LDR rows of FORMAT_OPTIONS of KTX2Loader.BasisWorker (Three.js r186): high quality first. */
const FORMAT_OPTIONS: readonly FormatOption[] = [
  {
    if: "astcSupported",
    etc1s: false,
    transcoder: [TF.ASTC_4x4, TF.ASTC_4x4],
    engine: [RGBA_ASTC_4x4_Format, RGBA_ASTC_4x4_Format],
    priorityETC1S: Number.POSITIVE_INFINITY,
    priorityUASTC: 1,
    needsPowerOfTwo: false,
  },
  {
    if: "bptcSupported",
    etc1s: true,
    transcoder: [TF.BC7_M5, TF.BC7_M5],
    engine: [RGBA_BPTC_Format, RGBA_BPTC_Format],
    priorityETC1S: 3,
    priorityUASTC: 2,
    needsPowerOfTwo: false,
  },
  {
    if: "dxtSupported",
    etc1s: true,
    transcoder: [TF.BC1, TF.BC3],
    engine: [RGBA_S3TC_DXT1_Format, RGBA_S3TC_DXT5_Format],
    priorityETC1S: 4,
    priorityUASTC: 5,
    needsPowerOfTwo: false,
  },
  {
    if: "etc2Supported",
    etc1s: true,
    transcoder: [TF.ETC1, TF.ETC2],
    engine: [RGB_ETC2_Format, RGBA_ETC2_EAC_Format],
    priorityETC1S: 1,
    priorityUASTC: 3,
    needsPowerOfTwo: false,
  },
  {
    if: "etc1Supported",
    etc1s: true,
    transcoder: [TF.ETC1],
    engine: [RGB_ETC1_Format],
    priorityETC1S: 2,
    priorityUASTC: 4,
    needsPowerOfTwo: false,
  },
  {
    if: "pvrtcSupported",
    etc1s: true,
    transcoder: [TF.PVRTC1_4_RGB, TF.PVRTC1_4_RGBA],
    engine: [RGB_PVRTC_4BPPV1_Format, RGBA_PVRTC_4BPPV1_Format],
    priorityETC1S: 5,
    priorityUASTC: 6,
    needsPowerOfTwo: true,
  },
  // The uncompressed fallback.
  {
    if: null,
    etc1s: true,
    transcoder: [TF.RGBA32, TF.RGBA32],
    engine: [RGBAFormat, RGBAFormat],
    priorityETC1S: 100,
    priorityUASTC: 100,
    needsPowerOfTwo: false,
  },
];

const BY_ETC1S = FORMAT_OPTIONS.filter((option) => option.etc1s).sort((a, b) => a.priorityETC1S - b.priorityETC1S);
const BY_UASTC = [...FORMAT_OPTIONS].sort((a, b) => a.priorityUASTC - b.priorityUASTC);

function isPowerOfTwo(value: number): boolean {
  if (value <= 2) return true;
  return (value & (value - 1)) === 0 && value !== 0;
}

/** The transcoder target and the texture format for a Basis file on this GPU. */
export function transcoderFormat(
  config: KTX2LoaderWorkerConfig,
  uastc: boolean,
  width: number,
  height: number,
  hasAlpha: boolean,
): { readonly transcoder: number; readonly engine: CompressedPixelFormat | PixelFormat } {
  for (const option of uastc ? BY_UASTC : BY_ETC1S) {
    if (option.if !== null && !config[option.if]) continue;
    if (hasAlpha && option.transcoder.length < 2) continue;
    if (option.needsPowerOfTwo && !(isPowerOfTwo(width) && isPowerOfTwo(height))) continue;
    const index = hasAlpha ? 1 : 0;
    const transcoder = option.transcoder[index];
    const engine = option.engine[index];
    if (transcoder !== undefined && engine !== undefined) return { transcoder, engine };
  }
  throw new Error("KTX2: no transcoding target for this GPU.");
}

/**
 * The KTX2 config of a WebGPU device, as `KTX2Loader.detectSupport` gives it for
 * the WebGPU renderer: WebGPU has three families. `texture-compression-bc` holds BC1 to BC7 (the S3TC and the BPTC
 * targets), `texture-compression-etc2` holds ETC1 data, and WebGPU has no PVRTC and no ASTC HDR.
 */
export function webgpuKtx2Config(features: { has(name: string): boolean }): KTX2LoaderWorkerConfig {
  const bc = features.has("texture-compression-bc");
  const etc2 = features.has("texture-compression-etc2");
  return {
    astcSupported: features.has("texture-compression-astc"),
    astcHDRSupported: false,
    etc1Supported: etc2,
    etc2Supported: etc2,
    dxtSupported: bc,
    bptcSupported: bc,
    pvrtcSupported: false,
  };
}

/** The config flags in a fixed order, with the short name of each family (ktx2TargetKey). */
const TARGET_FLAGS: readonly (readonly [Feature, string])[] = [
  ["astcSupported", "astc"],
  ["bptcSupported", "bptc"],
  ["dxtSupported", "dxt"],
  ["etc2Supported", "etc2"],
  ["etc1Supported", "etc1"],
  ["pvrtcSupported", "pvrtc"],
];

/**
 * A key of the transcode targets of a config, for a cache of transcoded textures: the families that the GPU
 * gives, in a fixed order, for example "astc+bptc+dxt+etc2+etc1"; "rgba32" without a family. Two configs with the
 * same key give the same transcode of each file (transcoderFormat).
 */
export function ktx2TargetKey(config: KTX2LoaderWorkerConfig | null | undefined): string {
  if (config === null || config === undefined) return "none";
  const names = TARGET_FLAGS.filter(([flag]) => config[flag]).map(([, name]) => name);
  return names.length === 0 ? "rgba32" : names.join("+");
}

export interface MipLevel {
  readonly data: Uint8Array;
  readonly width: number;
  readonly height: number;
}

export interface TranscodeResult {
  readonly faces: readonly {
    readonly mipmaps: readonly MipLevel[];
    readonly width: number;
    readonly height: number;
    readonly format: number;
    readonly type: number;
  }[];
  readonly width: number;
  readonly height: number;
  readonly hasAlpha: boolean;
  readonly format: number;
  readonly type: number;
  readonly dfdFlags: number;
}

function concat(arrays: readonly Uint8Array[]): Uint8Array {
  if (arrays.length === 1 && arrays[0] !== undefined) return arrays[0];
  const total = arrays.reduce((sum, array) => sum + array.byteLength, 0);
  const result = new Uint8Array(total);
  let offset = 0;
  for (const array of arrays) {
    result.set(array, offset);
    offset += array.byteLength;
  }
  return result;
}

/** Transcode a KTX2 file with Basis ETC1S or UASTC LDR data (the `transcode` of KTX2Loader.BasisWorker). */
export function transcodeKtx2(
  module: BasisModule,
  buffer: ArrayBuffer,
  config: KTX2LoaderWorkerConfig,
): TranscodeResult {
  const file = new module.KTX2File(new Uint8Array(buffer));
  const cleanup = (): void => {
    file.close();
    file.delete();
  };
  try {
    if (!file.isValid()) throw new Error("KTX2: not a valid or not a supported file.");
    if (file.isHDR()) throw new Error("KTX2: UASTC HDR is not supported.");
    const uastc = file.isUASTC();
    if (!uastc && !file.isETC1S()) throw new Error("KTX2: an unknown Basis encoding.");
    const width = file.getWidth();
    const height = file.getHeight();
    const layerCount = file.getLayers() || 1;
    const levelCount = file.getLevels();
    const faceCount = file.getFaces();
    const hasAlpha = file.getHasAlpha();
    const dfdFlags = file.getDFDFlags();
    if (width === 0 || height === 0 || levelCount === 0) throw new Error("KTX2: an invalid texture.");
    const { transcoder, engine } = transcoderFormat(config, uastc, width, height, hasAlpha);
    if (!file.startTranscoding()) throw new Error("KTX2: startTranscoding failed.");
    const faces: TranscodeResult["faces"][number][] = [];
    for (let face = 0; face < faceCount; face += 1) {
      const mipmaps: MipLevel[] = [];
      for (let mip = 0; mip < levelCount; mip += 1) {
        const layers: Uint8Array[] = [];
        let mipWidth = 0;
        let mipHeight = 0;
        for (let layer = 0; layer < layerCount; layer += 1) {
          const info = file.getImageLevelInfo(mip, layer, face);
          // With mipmaps the original sizes; without them the block sizes (Three.js #25908).
          mipWidth = levelCount > 1 ? info.origWidth : info.width;
          mipHeight = levelCount > 1 ? info.origHeight : info.height;
          const dst = new Uint8Array(file.getImageTranscodedSizeInBytes(mip, layer, 0, transcoder));
          if (!file.transcodeImage(dst, mip, layer, face, transcoder, 0, -1, -1)) {
            throw new Error("KTX2: transcodeImage failed.");
          }
          layers.push(dst);
        }
        mipmaps.push({ data: concat(layers), width: mipWidth, height: mipHeight });
      }
      faces.push({ mipmaps, width, height, format: engine, type: UnsignedByteType });
    }
    return { faces, width, height, hasAlpha, dfdFlags, format: engine, type: UnsignedByteType };
  } finally {
    cleanup();
  }
}

/** A message of KTX2Loader to its worker pool. */
interface TranscodeTask {
  readonly type: "transcode";
  readonly buffer: ArrayBuffer;
}

/**
 * A KTX2Loader without workers. `wasm` gives the bytes of basis_transcoder.wasm (a fetch of the same-origin
 * URL of the app). Call `detectSupport(renderer)` before the first texture, as for the stock loader.
 */
export class InThreadKtx2Loader extends KTX2Loader {
  private module: Promise<BasisModule> | null = null;

  constructor(private readonly wasm: () => Promise<ArrayBuffer>) {
    super();
    // KTX2Loader sends each transcode to `workerPool.postMessage`; this pool runs it in this thread.
    const pool = {
      postMessage: async (message: TranscodeTask): Promise<{ data: unknown }> => {
        const module = await this.basis();
        try {
          return { data: { type: "transcode", data: transcodeKtx2(module, message.buffer, this.workerConfig) } };
        } catch (error) {
          return { data: { type: "error", error: error instanceof Error ? error.message : String(error), data: {} } };
        }
      },
      setWorkerLimit: () => undefined,
      dispose: () => undefined,
    };
    this.workerPool = pool as unknown as WorkerPool;
  }

  private basis(): Promise<BasisModule> {
    this.module ??= this.wasm().then(loadBasisModule);
    return this.module;
  }

  /** Load the transcoder (no worker, no Blob URL). */
  override init(): Promise<void> {
    this.transcoderPending ??= this.basis().then(() => undefined);
    return this.transcoderPending;
  }

  /** A texture from the bytes of a KTX2 file. */
  transcode(buffer: ArrayBuffer): Promise<CompressedTexture> {
    return new Promise((resolve, reject) => {
      this.parse(buffer, resolve, reject);
    });
  }

  /** Nothing to free: no workers and no object URLs. The WASM memory goes with the module. */
  override dispose(): void {
    this.module = null;
    this.transcoderPending = null;
  }
}
