// SPDX-License-Identifier: Apache-2.0
/**
 * The platform capabilities of Scenity. The lab page (apps/editor) and the workbench page (apps/workbench) read one
 * object, `labsPlatform()`, and choose a path. The desktop app makes a feature faster, and the browser gives the same
 * feature by a slower path.
 *
 * Browser code without a framework. Only the editor, the workbench, the workbench host, the CLI and the editor face of
 * a plugin import it. The runtime does not (tools/check-boundaries.ts, eslint.config.js).
 *
 *   const platform = await labsPlatform("lab");
 *   if (platform.webpEncode) … else … // JPEG in WebKit
 */
import {
  detectIndexedDb,
  detectOffscreenCanvas,
  detectOpfs,
  detectWebCodecs,
  detectWebgpu,
  detectWebpEncode,
  hasTauri,
  isTauriOrigin,
  shellFeature,
  urlParam,
} from "./detect";
import type { PlatformEnv } from "./env";

export * from "./detect";
export type * from "./env";

/** The page that asks: the lab page, or the workbench page. */
export type LabsPage = "lab" | "workbench";

export interface LabsPlatform {
  /** The page that asked. */
  readonly page: LabsPage;
  /** The desktop app (Scenity, Tauri and WKWebView) or a browser. */
  readonly kind: "desktop" | "browser";
  /** A workbench host serves the page (the lab page: a `workbench=` frame; the workbench page: its host). */
  readonly host: boolean;
  /** The origin private file system (the frame index of the lab page alone). */
  readonly opfs: boolean;
  readonly indexedDb: boolean;
  /** WebCodecs encoders of a clip at 1280×800. */
  readonly webCodecs: { readonly vp9: boolean; readonly av1: boolean };
  /** A canvas encodes real WebP (false: the browser gives PNG, so a capture uses JPEG). */
  readonly webpEncode: boolean;
  /** A WebGPU adapter that is not a fallback adapter. This flag does not choose the backend. */
  readonly webgpu: boolean;
  /** A native snapshot of the window by the shell (desktop only). */
  readonly nativeSnapshot: boolean;
  /** Native windows of the shell (desktop only; detached panes and panels). */
  readonly nativeWindows: boolean;
  /** A canvas can move to a worker (the render worker and the split panes). */
  readonly offscreenCanvas: boolean;
}

export interface PlatformOptions {
  /** The workbench host is present: overrides the check of the URL (the workbench page knows its endpoint). */
  readonly host?: boolean;
}

/**
 * The desktop app. The workbench page: the IPC object of Tauri. The lab page is a frame of another origin in the
 * workbench page: its `workbench` parameter is the origin of the desktop page (`tauri://localhost`).
 */
function isDesktop(page: LabsPage, env: PlatformEnv): boolean {
  if (hasTauri(env)) return true;
  const parent = page === "lab" ? urlParam(env, "workbench") : null;
  return parent !== null && isTauriOrigin(parent);
}

function hasHost(page: LabsPage, env: PlatformEnv, desktop: boolean): boolean {
  if (page === "lab") return urlParam(env, "workbench") !== null;
  // The workbench page: the desktop app always starts a host; a browser gives it in the URL (`?host=<origin>`).
  return desktop || urlParam(env, "host") !== null;
}

/** Check every capability in `env` (no cache): the tests give fakes. */
export async function detectLabsPlatform(
  page: LabsPage,
  env: PlatformEnv,
  options: PlatformOptions = {},
): Promise<LabsPlatform> {
  const desktop = isDesktop(page, env);
  const [opfs, webCodecs, webpEncode, webgpu] = await Promise.all([
    detectOpfs(env),
    detectWebCodecs(env),
    webpEncodeOf(env),
    detectWebgpu(env),
  ]);
  return {
    page,
    kind: desktop ? "desktop" : "browser",
    host: options.host ?? hasHost(page, env, desktop),
    opfs,
    indexedDb: detectIndexedDb(env),
    webCodecs,
    webpEncode,
    webgpu,
    nativeSnapshot: shellFeature(env, "snapshot"),
    nativeWindows: hasTauri(env),
    offscreenCanvas: detectOffscreenCanvas(env),
  };
}

const cache = new Map<string, Promise<LabsPlatform>>();
let webpCache: { readonly env: PlatformEnv; readonly answer: Promise<boolean> } | null = null;

/** The WebP check once per environment: the bridge asks it once, not at each capture. */
function webpEncodeOf(env: PlatformEnv): Promise<boolean> {
  if (webpCache?.env !== env) webpCache = { env, answer: detectWebpEncode(env) };
  return webpCache.answer;
}

/** The page's own environment. */
function pageEnv(): PlatformEnv {
  return globalThis;
}

/** The capabilities of this page, checked once and kept. */
export function labsPlatform(page: LabsPage, options: PlatformOptions = {}): Promise<LabsPlatform> {
  const key = `${page}:${String(options.host)}`;
  let found = cache.get(key);
  if (found === undefined) {
    found = detectLabsPlatform(page, pageEnv(), options);
    cache.set(key, found);
  }
  return found;
}

/** A canvas of this page encodes real WebP: checked once and kept. */
export function webpEncode(): Promise<boolean> {
  return webpEncodeOf(pageEnv());
}

/** Forget the kept answers (tests). */
export function resetLabsPlatform(): void {
  cache.clear();
  webpCache = null;
}

/** The name of the User Timing mark with the capabilities in its detail (the perf harness reads it). */
export const PLATFORM_MARK = "labs:platform";

/** Check the capabilities of this page and put them on the User Timing time line (`labs:platform`). */
export async function markPlatform(page: LabsPage, options: PlatformOptions = {}): Promise<LabsPlatform> {
  const platform = await labsPlatform(page, options);
  performance.mark(PLATFORM_MARK, { detail: platform });
  return platform;
}
