// SPDX-License-Identifier: Apache-2.0
/**
 * The native snapshot of a surface frame. The page asks the shell for `snapshot_surface` of the region of the frame
 * element (CSS px of the page). WebKit draws the region at the requested width (DOM and canvases, also a cross-origin
 * WebGL frame), and the shell gives a WebP. The result has the form of a
 * `capture` answer (`simMs`, `width`, `height`, `mime`, `bytes`), so the relay sends it to the host as a picture.
 */
import { invokeShell, ownBuffer, readFramed, type ShellWindow } from "./shell";

/** A region of the page in CSS px. */
export interface Region {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** The answer of a native snapshot: a capture answer with the times. */
export interface NativeSnapshot {
  /** A snapshot is not a frame of the scene clock. */
  readonly simMs: null;
  readonly width: number;
  readonly height: number;
  readonly mime: string;
  readonly bytes: ArrayBuffer;
  readonly source: "window";
  /** WebKit, the WebP encode and the whole call in the page (ms). */
  readonly ms: { readonly snapshot: number | null; readonly encode: number | null; readonly page: number };
}

function numberOf(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/** The region of an element, or null when it has no size (a hidden or a removed element). */
export function regionOf(element: Element | null): Region | null {
  if (element === null) return null;
  const box = element.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return null;
  return { x: box.left, y: box.top, width: box.width, height: box.height };
}

/** Take a native snapshot of a region of the page, `width` px wide. */
export async function nativeSnapshot(
  region: Region,
  width: number,
  options: { readonly win?: ShellWindow; readonly now?: () => number } = {},
): Promise<NativeSnapshot> {
  const now = options.now ?? (() => performance.now());
  const start = now();
  const value = await invokeShell("snapshot_surface", { request: { rect: region, width } }, options.win);
  const { header, bytes } = readFramed(value);
  const out = { width: numberOf(header.width), height: numberOf(header.height) };
  if (out.width === null || out.height === null || typeof header.mime !== "string") {
    throw new Error("The shell gave a snapshot without its size.");
  }
  const ms = (typeof header.ms === "object" && header.ms !== null ? header.ms : {}) as Record<string, unknown>;
  return {
    simMs: null,
    width: out.width,
    height: out.height,
    mime: header.mime,
    bytes: ownBuffer(bytes),
    source: "window",
    ms: { snapshot: numberOf(ms.snapshot), encode: numberOf(ms.encode), page: now() - start },
  };
}
