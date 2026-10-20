// SPDX-License-Identifier: Apache-2.0
/**
 * The surfaces in the page (the page half): the `src` of a surface frame, and the relay between the host client and
 * the frames.
 *
 * The host keeps the URL of each frame (the bridge reports each change with `url`). The page sets the `src` of a frame
 * once and changes it only when the dev server moves to another origin. A change of the URL inside the frame thus
 * never loads the frame again, and a reload of the workbench page opens the frame at the URL that the host kept.
 */
import {
  BRIDGE_PARAM,
  type BridgeImportEvent,
  type BridgeScratchEvent,
  type SurfaceWhere,
  type WorkbenchKey,
} from "@scenity/workbench-host/protocol";
import { getCurrentScope, onScopeDispose, watch, type ShallowRef } from "vue";
import type { HostClient } from "../host/hostClient";
import { createRelay, type FrameMessage, type RelayOptions, type SurfaceRelay } from "./relay";

/** The URL of a surface with the `workbench` parameter: the origin of the workbench page. */
export function frameSrc(url: string, pageOrigin: string): string {
  const next = new URL(url);
  next.searchParams.set(BRIDGE_PARAM, pageOrigin);
  return next.href;
}

/** The origin of a URL, or null for a URL that is not valid. */
export function originOf(url: string): string | null {
  try {
    return new URL(url).origin;
  } catch {
    return null;
  }
}

/**
 * The next `src` of a frame. It stays the same while the host URL has the same origin: the frame owns its URL state.
 * A new origin (a new dev server) or the first URL gives a new `src`. No URL gives null.
 */
export function nextFrameSrc(current: string | null, url: string | null, pageOrigin: string): string | null {
  if (url === null || originOf(url) === null) return null;
  if (current !== null && originOf(current) === originOf(url)) return current;
  return frameSrc(url, pageOrigin);
}

/** The window parts that the relay uses (a test gives a fake). */
export interface RelayWindow {
  addEventListener(type: "message", listener: (event: MessageEvent) => void): void;
  removeEventListener(type: "message", listener: (event: MessageEvent) => void): void;
}

/** Make the relay of the page: the host client gives the requests, the window gives the frame messages. */
export function useSurfaceRelay(
  client: Readonly<ShallowRef<HostClient | null>>,
  win: RelayWindow = globalThis,
  onKey?: (key: WorkbenchKey) => void,
  local?: RelayOptions["local"],
  /** A file dropped on the scene of a frame (imports/importDrop.ts). */
  onImport?: (surface: string, event: BridgeImportEvent) => void,
  /** A frame needs the models of its scratch props (imports/scratchModels.ts). */
  onScratch?: (surface: string, where: SurfaceWhere, event: BridgeScratchEvent) => void,
  /**
   * The clock link and "Open in a window" of the frames (panels/hostLink.ts, panels/useWindowLayout.ts). Also the
   * surfaces of the host, for the capability search of the relay (`idWith`).
   */
  windows?: Pick<RelayOptions, "onLink" | "onDetach" | "surfaces">,
): SurfaceRelay {
  const relay = createRelay({
    ...windows,
    ...(onKey === undefined ? {} : { onKey }),
    ...(onImport === undefined ? {} : { onImport }),
    ...(onScratch === undefined ? {} : { onScratch }),
    // The calls that the page answers itself (desktop/localCalls.ts).
    ...(local === undefined ? {} : { local }),
    answer: (params, picture) => {
      const current = client.value;
      if (current === null) return;
      let answer = params;
      if (picture !== undefined) {
        // The bytes go first as a binary frame. The JSON answer follows on the same socket.
        try {
          current.sendPicture(params.request, picture.mime, picture.bytes);
        } catch (error) {
          answer = { request: params.request, error: error instanceof Error ? error.message : String(error) };
        }
      }
      current.request("surface.call", answer).catch(() => undefined);
    },
    report: (params) => {
      client.value?.request("surface.report", params).catch(() => undefined);
    },
  });
  const onMessage = (event: MessageEvent): void => {
    relay.receive(event satisfies FrameMessage);
  };
  win.addEventListener("message", onMessage);
  let stopRequests: (() => void) | null = null;
  const stopWatch = watch(
    client,
    (current) => {
      stopRequests?.();
      stopRequests = current?.on("surface.request", (payload) => relay.request(payload)) ?? null;
    },
    { immediate: true },
  );
  if (getCurrentScope() !== undefined) {
    onScopeDispose(() => {
      stopWatch();
      stopRequests?.();
      win.removeEventListener("message", onMessage);
      relay.dispose();
    });
  }
  return relay;
}

/** The ID of a frame in the page (the `data-frame` attribute and the tests). */
export function frameName(surface: string, where: SurfaceWhere): string {
  return `${surface}-${where}`;
}
