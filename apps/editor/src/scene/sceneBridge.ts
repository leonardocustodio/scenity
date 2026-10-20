// SPDX-License-Identifier: Apache-2.0
/**
 * The workbench bridge of the scene page: a workbench surface can show the scene page in a frame, and the host tools
 * reach it. The bridge exists only when the URL has `workbench=<origin of the workbench page>` and the page is in a
 * frame.
 *
 * The calls: the base calls `url`, `console` and `capture` (a picture of the document camera of the page, from the
 * camera preview of the dev core), `scene.pick` (with sub-targets), `sheet` (sceneSheet.ts), the jobs of the frame
 * index (sceneIndex.ts), the calls of the generic Claude tools (sceneBridgeCalls.ts) and each method of the script API
 * `globalThis.__scenity` (for example `inspect`, `stats`, `camera`, `accept`). The events: `ready` when the script API
 * is set, `url`, `hmr` and `reload` of the Vite dev server, `console` for a new error, and `key` for a ⌘ chord of the
 * workbench. The message core is the core of the lab bridge (core/bridge/bridgeCore.ts).
 */
import {
  bridgeOrigin,
  CAPTURE_CALL,
  captureArgsOf,
  CONSOLE_CALL,
  INSPECT_CALL,
  SCENE_PICK_CALL,
  serveBridgeCall,
  SHADOW_FRAME_CALL,
  URL_CALL,
  type BridgeCapture,
  type BridgeEventBody,
  type ScenePickHit,
  type ScenePickOptions,
} from "@scenity/bridge";
import { createWorkbenchBridge, type BridgeCall, type BridgeHost } from "../core/bridge/bridgeCore";
import { captureConsole, type ConsoleEntries } from "../core/bridge/workbenchConsole";
import { forwardChords, throttle, watchHmr, watchUrl, type HotContext } from "../core/bridge/workbenchEvents";
import { SCENE_PAGE_CALLS } from "./sceneBridgeCalls";
import { sceneIndexCalls, type IndexPagePort } from "./sceneIndex";
import { encodeBitmap, PICTURE_QUALITY } from "./scenePicture";
import { sceneSheet, type SheetPagePort } from "./sceneSheet";
import { shadowFrame } from "./shadowFrame";

/** The parts of the page that the bridge uses. */
export interface SceneBridgeParts extends SheetPagePort, IndexPagePort {
  /** The time of the page clock (ms), or null for a scene with no sequence. */
  simMs(): number | null;
  /** The entity under a point of the canvas (CSS pixels), with the options of the pick. */
  pick(x: number, y: number, options: ScenePickOptions): Promise<ScenePickHit | null>;
  readonly host?: BridgeHost;
  readonly hot?: HotContext;
  /** The wait between two looks for the script API before `ready` (ms). */
  readonly readyPollMs?: number;
}

/** The base call `capture`: the picture of the camera of the page as WebP (or JPEG) bytes. */
async function capture(parts: SceneBridgeParts, args: readonly unknown[]): Promise<BridgeCapture> {
  const [width, quality] = captureArgsOf(args);
  const bitmap = await parts.preview(parts.camera(), width);
  if (bitmap === null) throw new Error("capture: the scene page gave no picture.");
  return { simMs: parts.simMs() ?? 0, ...(await encodeBitmap(bitmap, quality ?? PICTURE_QUALITY)) };
}

/** The calls of the page itself: the base calls, the pick, the sheet, the index jobs and the tool calls. */
export function pageCalls(
  parts: SceneBridgeParts,
  host: BridgeHost,
  take: () => ConsoleEntries,
): Record<string, BridgeCall> {
  return {
    [CAPTURE_CALL.name]: (args) => capture(parts, args),
    [URL_CALL.name]: serveBridgeCall(URL_CALL, () => host.location.href),
    [CONSOLE_CALL.name]: serveBridgeCall(CONSOLE_CALL, take),
    [SCENE_PICK_CALL.name]: serveBridgeCall(SCENE_PICK_CALL, (x, y, options) => parts.pick(x, y, options)),
    sheet: (args) => sceneSheet(parts, args[0]),
    // A picture for an agent that leaves the view of the person as it is.
    [SHADOW_FRAME_CALL.name]: serveBridgeCall(SHADOW_FRAME_CALL, (request) => shadowFrame(parts, request)),
    ...sceneIndexCalls(parts),
    ...SCENE_PAGE_CALLS,
  };
}

/**
 * Start the bridge of the scene page: the message listener, the console log, the URL watch, the Vite events and
 * `ready`. Returns the stop function, or null when the URL has no `workbench` origin or the page is not in a frame.
 */
export function startSceneBridge(parts: SceneBridgeParts): (() => void) | null {
  const host: BridgeHost = parts.host ?? globalThis;
  const origin = bridgeOrigin(host.location.search);
  if (origin === null || (host.parent as unknown) === host) return null;
  let lastError = "";
  let emit: (body: BridgeEventBody) => void = () => undefined;
  const errorEvent = throttle(() => {
    emit({ event: "console", level: "error", text: lastError });
  });
  const onError = (text: string): void => {
    lastError = text;
    errorEvent.call();
  };
  const log = captureConsole(host, onError);
  const bridge = createWorkbenchBridge({
    origin,
    parent: host.parent,
    api: () => globalThis.__scenity,
    calls: pageCalls(parts, host, () => log.take()),
    typed: [INSPECT_CALL],
  });
  emit = (body) => {
    bridge.emit(body);
  };
  const stopUrl = watchUrl(host, (url) => {
    emit({ event: "url", url });
  });
  const stopHmr = watchHmr(parts.hot, emit, () => host.location.href, onError);
  const stopKeys = forwardChords(host, emit);
  const onMessage = (event: Event): void => {
    void bridge.receive(event as MessageEvent);
  };
  host.addEventListener("message", onMessage);
  const ready = setInterval(() => {
    if (globalThis.__scenity === undefined) return;
    clearInterval(ready);
    emit({ event: "ready", url: host.location.href });
  }, parts.readyPollMs ?? 50);
  return () => {
    clearInterval(ready);
    errorEvent.cancel();
    host.removeEventListener("message", onMessage);
    log.stop();
    stopUrl();
    stopHmr();
    stopKeys();
  };
}
