// SPDX-License-Identifier: Apache-2.0
/**
 * The surface calls that the workbench page answers itself. The relay gives them here before it posts a call into a
 * frame (`RelayOptions.local`).
 *
 * - `snapshot` `[{ width }]`: a native snapshot of the region of the frame (`desktop/snapshot.ts`). Only the labs app
 *   has it (`labsPlatform().nativeSnapshot`, the shell feature `snapshot`), and only for a visible frame whose tab is
 *   in front: the snapshot shows what is on the screen.
 * - `clipMp4` `[ClipMp4Request]`: an MP4 of the lab frame by the shell (`desktop/mp4Clip.ts`, the feature `mp4`).
 *
 * Without the feature, the page answers an error that starts with `NO_NATIVE_SNAPSHOT` or `NO_NATIVE_MP4`. The host
 * then keeps the browser path (the canvas capture, MediaRecorder).
 */
import {
  CLIP_MP4_CALL,
  NO_NATIVE_MP4,
  NO_NATIVE_SNAPSHOT,
  SNAPSHOT_CALL,
  type ClipMp4Request,
  type EventPayload,
} from "@scenity/workbench-host/protocol";
import type { LocalContext } from "../surfaces/relay";
import { frameName } from "../surfaces/useSurface";
import { makeMp4Clip } from "./mp4Clip";
import { shellFeature, type ShellWindow } from "./shell";
import { nativeSnapshot, regionOf } from "./snapshot";

/** The width of a snapshot without a width (px). */
const SNAPSHOT_WIDTH = 1280;
/** The largest width of a snapshot (px). */
const SNAPSHOT_MAX = 4096;

export interface LocalCallOptions {
  /** The frame element of a surface and place (a test gives a fake). */
  readonly frameElement?: (name: string) => Element | null;
  readonly win?: ShellWindow;
}

function frameElementOf(name: string): Element | null {
  return globalThis.document.querySelector(`iframe[data-frame="${name}"]`);
}

function widthOf(args: readonly unknown[]): number {
  const asked = (typeof args[0] === "object" && args[0] !== null ? args[0] : {}) as { width?: unknown };
  const width = typeof asked.width === "number" && Number.isFinite(asked.width) ? Math.round(asked.width) : 0;
  return width >= 16 ? Math.min(SNAPSHOT_MAX, width) : SNAPSHOT_WIDTH;
}

async function snapshotCall(
  payload: EventPayload<"surface.request">,
  context: LocalContext,
  options: LocalCallOptions,
): Promise<unknown> {
  if (!shellFeature("snapshot", options.win)) {
    throw new Error(`${NO_NATIVE_SNAPSHOT}: the page has no native snapshot (a browser).`);
  }
  if (payload.where !== "visible" || context.hidden) {
    throw new Error(`${NO_NATIVE_SNAPSHOT}: the frame is not on the screen.`);
  }
  const element = (options.frameElement ?? frameElementOf)(frameName(payload.surface, payload.where));
  const region = regionOf(element);
  if (region === null) throw new Error(`${NO_NATIVE_SNAPSHOT}: the frame has no size on the screen.`);
  return nativeSnapshot(region, widthOf(payload.args), options.win === undefined ? {} : { win: options.win });
}

function clipRequestOf(args: readonly unknown[]): ClipMp4Request {
  const item = args[0];
  if (typeof item !== "object" || item === null) throw new Error("clipMp4 needs a clip request.");
  return item as ClipMp4Request;
}

/** The `local` option of the relay: the calls above, or null for every other call. */
export function desktopLocalCalls(
  options: LocalCallOptions = {},
): (payload: EventPayload<"surface.request">, context: LocalContext) => Promise<unknown> | null {
  return (payload, context) => {
    if (payload.call === SNAPSHOT_CALL) return snapshotCall(payload, context, options);
    if (payload.call !== CLIP_MP4_CALL) return null;
    if (!shellFeature("mp4", options.win)) {
      return Promise.reject(new Error(`${NO_NATIVE_MP4}: the page has no MP4 writer (a browser).`));
    }
    const request = clipRequestOf(payload.args);
    return makeMp4Clip(
      (call, args, timeoutMs) => context.call(call, args, timeoutMs),
      request,
      options.win === undefined ? {} : { win: options.win },
    );
  };
}
