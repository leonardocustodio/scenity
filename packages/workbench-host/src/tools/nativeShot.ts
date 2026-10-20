// SPDX-License-Identifier: Apache-2.0
/**
 * The native snapshot of a surface frame for the tools.
 *
 * The host sends the surface call `snapshot` with `{ width }`. The workbench page answers it itself (it never reaches
 * the frame): in the labs app it asks the shell for `snapshot_surface` of the region of the frame (WKWebView
 * `takeSnapshotWithConfiguration`, the DOM and every canvas, a WebP of the shell). It relays the bytes as a picture.
 * A browser, a frame whose tab is not in front and an older page answer an error that starts with
 * `NO_NATIVE_SNAPSHOT`. The tool then keeps the canvas capture (the browser path).
 */
import { NO_NATIVE_SNAPSHOT, SNAPSHOT_CALL, type Capture } from "../protocol";
import type { SurfacePort } from "./context";
import { call, captureOf, FRAME_TIMEOUT_MS, number, pictureBytes, record } from "./kit";

/** A native snapshot: the picture and the times of the shell (ms). */
export interface NativeShot {
  readonly shot: Capture;
  /** The time of WebKit for the picture, of the encode and of the whole call in the page (ms), when known. */
  readonly ms: { readonly snapshot: number | null; readonly encode: number | null; readonly page: number | null };
}

/** True for the error of a page without a native snapshot (or an old page that does not know the call). */
export function isNoNativeSnapshot(error: unknown): boolean {
  const text = error instanceof Error ? error.message : String(error);
  return text.includes(NO_NATIVE_SNAPSHOT) || text.includes(`No call "${SNAPSHOT_CALL}"`);
}

/** A native snapshot of the frame of a port, `width` px wide; null when the page cannot take one. */
export async function nativeShot(port: SurfacePort, width: number): Promise<NativeShot | null> {
  let value: Record<string, unknown>;
  try {
    value = record(await call(port, SNAPSHOT_CALL, [{ width }], FRAME_TIMEOUT_MS));
  } catch (error) {
    if (isNoNativeSnapshot(error)) return null;
    throw error;
  }
  // A page that answers the call without a picture has no native snapshot either.
  if (pictureBytes(value) === null) return null;
  const ms = record(value.ms);
  return {
    shot: captureOf(value),
    ms: { snapshot: number(ms.snapshot), encode: number(ms.encode), page: number(ms.page) },
  };
}

/** The line of a native snapshot in a tool result. */
export function nativeLine(native: NativeShot): string {
  const part = (value: number | null): string => (value === null ? "?" : value.toFixed(1));
  return (
    `Native snapshot of the window (WKWebView, the DOM and every canvas): WebKit ${part(native.ms.snapshot)} ms, ` +
    `WebP ${part(native.ms.encode)} ms, in the page ${part(native.ms.page)} ms.`
  );
}
