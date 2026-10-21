// SPDX-License-Identifier: Apache-2.0
/**
 * The checks of each capability. Each check reads only the given environment and never fails. A check gives false
 * when the browser does not answer in CHECK_TIMEOUT_MS.
 */
import type { PlatformEnv } from "./env";

/** The longest wait for one check (ms). WebKit can stop and not answer some codec questions. */
export const CHECK_TIMEOUT_MS = 2_000;

/** The codecs of a clip: VP9 profile 0 and AV1 main profile, 8 bit, at the lab size. */
export const CLIP_CODECS = { vp9: "vp09.00.10.08", av1: "av01.0.04M.08" } as const;
const CLIP_SIZE = { width: 1280, height: 800 } as const;

/** The value of the promise, or `fallback` when it fails or takes longer than `ms`. */
export function settle<T>(promise: Promise<T>, fallback: T, ms = CHECK_TIMEOUT_MS): Promise<T> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      resolve(fallback);
    }, ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      () => {
        clearTimeout(timer);
        resolve(fallback);
      },
    );
  });
}

/** Run a check that can throw at once (a missing method): a throw gives the fallback. */
function guarded<T>(check: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return settle(check(), fallback);
  } catch {
    return Promise.resolve(fallback);
  }
}

/** The page of the desktop app: the IPC object of Tauri is present. */
export function hasTauri(env: PlatformEnv): boolean {
  return env.__TAURI_INTERNALS__ !== undefined && env.__TAURI_INTERNALS__ !== null;
}

/** A URL parameter of the page, or null. */
export function urlParam(env: PlatformEnv, name: string): string | null {
  if (env.location === undefined) return null;
  try {
    return new URL(env.location.href).searchParams.get(name);
  } catch {
    return null;
  }
}

/**
 * The origin of a page of the desktop app: `tauri://localhost` (macOS, Linux) or `http(s)://tauri.localhost`
 * (Windows).
 */
export function isTauriOrigin(origin: string): boolean {
  return origin.startsWith("tauri:") || /^https?:\/\/tauri\.localhost(?::\d+)?$/.test(origin);
}

/** OPFS: `navigator.storage.getDirectory()` gives a folder (a private window of some browsers refuses it). */
export function detectOpfs(env: PlatformEnv): Promise<boolean> {
  const storage = env.navigator?.storage;
  if (typeof storage?.getDirectory !== "function") return Promise.resolve(false);
  return guarded(async () => (await storage.getDirectory?.()) !== undefined, false);
}

export function detectIndexedDb(env: PlatformEnv): boolean {
  return env.indexedDB !== undefined && env.indexedDB !== null;
}

/** The encoder of one codec at the lab size, from `VideoEncoder.isConfigSupported`. */
function detectCodec(env: PlatformEnv, codec: string): Promise<boolean> {
  const encoder = env.VideoEncoder;
  if (encoder === undefined) return Promise.resolve(false);
  return guarded(async () => (await encoder.isConfigSupported({ codec, ...CLIP_SIZE })).supported === true, false);
}

/** The WebCodecs encoders of a clip. */
export async function detectWebCodecs(env: PlatformEnv): Promise<{ readonly vp9: boolean; readonly av1: boolean }> {
  const [vp9, av1] = await Promise.all([detectCodec(env, CLIP_CODECS.vp9), detectCodec(env, CLIP_CODECS.av1)]);
  return { vp9, av1 };
}

/**
 * A canvas encodes WebP: the blob of an `image/webp` request has that type. WebKit gives a PNG in its place. Thus
 * the answer there is false, and a capture uses JPEG directly.
 */
export function detectWebpEncode(env: PlatformEnv): Promise<boolean> {
  const Offscreen = env.OffscreenCanvas;
  if (Offscreen !== undefined) {
    return guarded(async () => {
      const canvas = new Offscreen(1, 1);
      if (canvas.convertToBlob === undefined) return false;
      canvas.getContext?.("2d");
      return (await canvas.convertToBlob({ type: "image/webp" })).type === "image/webp";
    }, false);
  }
  const document = env.document;
  if (document === undefined) return Promise.resolve(false);
  return guarded(
    () =>
      new Promise<boolean>((resolve) => {
        const canvas = document.createElement("canvas");
        canvas.width = 1;
        canvas.height = 1;
        canvas.toBlob((blob) => {
          resolve(blob?.type === "image/webp");
        }, "image/webp");
      }),
    false,
  );
}

/**
 * WebGPU: an adapter that is not a fallback (software) adapter. The check does not choose the renderer backend. The
 * runtime chooses it.
 */
export function detectWebgpu(env: PlatformEnv): Promise<boolean> {
  const gpu = env.navigator?.gpu;
  if (gpu === undefined) return Promise.resolve(false);
  return guarded(async () => {
    const adapter = await gpu.requestAdapter();
    if (adapter === null) return false;
    return !(adapter.info?.isFallbackAdapter ?? adapter.isFallbackAdapter ?? false);
  }, false);
}

/** A canvas can move to a worker (`transferControlToOffscreen`), and `OffscreenCanvas` exists. */
export function detectOffscreenCanvas(env: PlatformEnv): boolean {
  return (
    typeof env.OffscreenCanvas === "function" &&
    typeof env.HTMLCanvasElement?.prototype.transferControlToOffscreen === "function"
  );
}

/** A feature of the desktop shell (`__SCENITY_SHELL__.features`): only in a page of the desktop app. */
export function shellFeature(env: PlatformEnv, name: string): boolean {
  return hasTauri(env) && (env.__SCENITY_SHELL__?.features ?? []).includes(name);
}
