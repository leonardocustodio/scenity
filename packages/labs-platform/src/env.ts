// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the browser that the capability checks read. The checks get this object, not `globalThis`, so a test
 * can give fakes for each path. The page gives `globalThis`.
 */

/** A WebGPU adapter as the checks read it (the DOM library of TypeScript has no WebGPU types). */
export interface GpuAdapterLike {
  readonly info?: { readonly isFallbackAdapter?: boolean };
  /** The old place of the flag (Chromium before 2025, Safari 26). */
  readonly isFallbackAdapter?: boolean;
}

export interface GpuLike {
  requestAdapter(options?: { readonly powerPreference?: string }): Promise<GpuAdapterLike | null>;
}

export interface VideoEncoderLike {
  isConfigSupported(config: {
    readonly codec: string;
    readonly width: number;
    readonly height: number;
  }): Promise<{ readonly supported?: boolean }>;
}

/** A blob as the WebP check reads it: only its type. */
export interface BlobLike {
  readonly type: string;
}

export type OffscreenCanvasClass = new (
  width: number,
  height: number,
) => {
  /** Chromium refuses `convertToBlob` on a canvas without a context. */
  getContext?(kind: "2d"): unknown;
  convertToBlob?(options?: { readonly type?: string; readonly quality?: number }): Promise<BlobLike>;
};

export interface CanvasLike {
  width: number;
  height: number;
  toBlob(callback: (blob: BlobLike | null) => void, type?: string, quality?: number): void;
}

/**
 * The features that the desktop shell gives a page through its init script (`__SCENITY_SHELL__`), for example
 * `["snapshot"]`. A browser has none.
 */
export interface ShellFeatures {
  readonly features?: readonly string[];
}

export interface PlatformEnv {
  readonly location?: { readonly href: string };
  readonly navigator?: {
    readonly gpu?: GpuLike;
    readonly storage?: { readonly getDirectory?: () => Promise<unknown> };
  };
  readonly indexedDB?: unknown;
  readonly VideoEncoder?: VideoEncoderLike;
  readonly OffscreenCanvas?: OffscreenCanvasClass;
  readonly HTMLCanvasElement?: { readonly prototype: { readonly transferControlToOffscreen?: unknown } };
  readonly document?: { createElement(tag: "canvas"): CanvasLike };
  /** The IPC object of Tauri 2: it is only in a page of the desktop app. */
  readonly __TAURI_INTERNALS__?: unknown;
  readonly __SCENITY_SHELL__?: ShellFeatures;
}
