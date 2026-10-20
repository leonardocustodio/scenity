// SPDX-License-Identifier: Apache-2.0
/**
 * The workbench bridge: the workbench page in the parent frame controls this lab page.
 * The bridge is active only when the URL has `workbench=<origin of the workbench page>` and the page is in a frame.
 *
 * Parent → lab: `{ workbench: 1, id, call, args }`. `call` is a method of `__room3dLab` (useLabApi.ts, `check`
 * included) or a base call of `@scenity/bridge`: `capture` (args `[width, quality, height, { pane } | { grid: true }]`,
 * where the last item is the pane of the split screen), `url` or `console`. Lab → parent: `{ workbench: 1, id, result }`
 * or `{ workbench: 1, id, error }`, and the events `{ workbench: 1, event, ... }` (`BridgeEvent` of `@scenity/bridge`):
 * `ready` and `url` (`url`), `hmr` (`files`), `reload` (`url`) of the Vite dev server, `console` (`level`, `text`) for
 * a new error, and `key` (`key`) for a ⌘ chord of the workbench. `@scenity/bridge` is the one
 * contract of the messages. The plugin gives the typed calls of its methods (`EditorPlugin.bridgeCalls`).
 * The bridge answers only a message from `window.parent` with the workbench origin, and it posts only to that origin.
 * The call `visibility` (args `["hidden"]` or `["visible"]`) pauses the render loops of a page in a hidden tab.
 * A call that needs frames wakes the page for that call (workbenchVisibility.ts).
 *
 * Lab code: the marker gate (tools/lab-markers.ts) keeps `__workbench` out of the learner build.
 */
import {
  bridgeOrigin,
  CAPTURE_CALL,
  CONSOLE_CALL,
  EDITOR_CALLS,
  serveBridgeCall,
  URL_CALL,
  type BridgeEventBody,
} from "@scenity/bridge";
import { onBeforeUnmount, type ShallowRef } from "vue";
import { INDEX_BRIDGE_CALLS } from "../index/bridgeCalls";
import { registeredPlugin } from "../plugin";
import { IMPORT_BRIDGE_CALLS } from "../importDrop/bridgeCalls";
import { SCRATCH_BRIDGE_CALLS } from "../scratch/bridgeCalls";
import type { ViewHandle } from "../useLabStats";
import { captureFrame } from "./workbenchCapture";
import { captureConsole, type ConsoleEntries } from "./workbenchConsole";
import { sheetCall, takeMoments } from "./workbenchSheet";
import { browserVisibility, RENDER_CALLS, type PageVisibility } from "./workbenchVisibility";
import { deliverLink } from "./workbenchLink";
import { PAGE_BRIDGE_CALLS } from "./workbenchTools";
import { forwardChords, throttle, watchHmr, watchUrl, type HotContext } from "./workbenchEvents";
import { createWorkbenchBridge, type BridgeCall, type BridgeHost } from "./bridgeCore";
import { SCENE_BRIDGE_CALLS } from "./workbenchScene";

/** The state of the bridge on the page. Tests and the devtools read it. */
export interface WorkbenchInfo {
  readonly origin: string;
  calls(): string[];
  /** Send an event to the workbench page: the scene edit sends `ask` and `placement`. */
  emit(body: BridgeEventBody): void;
}

export {
  createWorkbenchBridge,
  type BridgeCall,
  type BridgeHost,
  type BridgeMessage,
  type BridgeOptions,
  type BridgeParent,
  type WorkbenchBridge,
} from "./bridgeCore";

export interface StartOptions {
  readonly view: () => ViewHandle | null;
  readonly host?: BridgeHost;
  readonly hot?: HotContext;
  /** The wait between two checks for the lab API before `ready` (ms). */
  readonly readyPollMs?: number;
  /** The visibility of the page (a test gives a fake). Default: the root element of this page. */
  readonly visibility?: PageVisibility;
}

/** The calls of the bridge itself (not methods of the lab API). `take` gives the console log since the last call. */
function bridgeCalls(
  options: StartOptions,
  host: BridgeHost,
  visibility: PageVisibility,
  take: () => ConsoleEntries,
): Readonly<Record<string, BridgeCall>> {
  return {
    // The base calls of `@scenity/bridge` check their arguments with the contract.
    [CAPTURE_CALL.name]: serveBridgeCall(CAPTURE_CALL, (width, quality, height, target) =>
      captureFrame(options.view(), width, quality, height, target),
    ),
    [URL_CALL.name]: serveBridgeCall(URL_CALL, () => host.location.href),
    [CONSOLE_CALL.name]: serveBridgeCall(CONSOLE_CALL, take),
    // A contact sheet in the page (workbenchSheet.ts). The host sends it to the shadow frame.
    sheet: (args) => sheetCall(globalThis.__room3dLab, options.view(), args[0], host.location),
    // The named moments of the take, for the `Stop` gate of the host.
    moments: (args) => takeMoments(args[0], host.location),
    // A message of the clock link from another window (workbenchLink.ts).
    link: (args) => deliverLink(args[0]),
    // The tab of the frame is behind another tab ("hidden") or in front ("visible").
    visibility: (args) => visibility.set(args[0]),
    // The frame index (lab/index/bridgeCalls.ts).
    ...INDEX_BRIDGE_CALLS,
    // The state and the optimized model of an import job (lab/importDrop/bridgeCalls.ts).
    ...IMPORT_BRIDGE_CALLS,
    // The scratch props and the answer of a promote (lab/scratch/bridgeCalls.ts).
    ...SCRATCH_BRIDGE_CALLS,
    // The tools of the page and its lines of the context packet (workbenchTools.ts).
    ...PAGE_BRIDGE_CALLS,
    // The query of the scene document of the plugin (workbenchScene.ts).
    ...SCENE_BRIDGE_CALLS,
  };
}

/**
 * Start the bridge of the page: the message listener, the console log, the URL watch, the Vite events and `ready`.
 * Returns the stop function, or null when the URL has no `workbench` origin or the page is not in a frame.
 */
export function startWorkbenchBridge(options: StartOptions): (() => void) | null {
  const host: BridgeHost = options.host ?? globalThis;
  const origin = bridgeOrigin(host.location.search);
  if (origin === null || (host.parent as unknown) === host) return null;
  const visibility = options.visibility ?? browserVisibility();
  const bridge = createWorkbenchBridge({
    origin,
    parent: host.parent,
    api: () => globalThis.__room3dLab,
    calls: bridgeCalls(options, host, visibility, () => log.take()),
    around: (call, run) => (RENDER_CALLS.has(call) ? visibility.during(run) : run()),
    // The editor calls `inspect` and `command` check their arguments too.
    typed: [...EDITOR_CALLS, ...(registeredPlugin()?.bridgeCalls ?? [])],
  });
  let lastError = "";
  const errorEvent = throttle(() => {
    bridge.emit({ event: "console", level: "error", text: lastError });
  });
  const onError = (text: string): void => {
    lastError = text;
    errorEvent.call();
  };
  const log = captureConsole(host, onError);
  const stopUrl = watchUrl(host, (url) => {
    bridge.emit({ event: "url", url });
  });
  const stopHmr = watchHmr(
    options.hot,
    (body) => {
      bridge.emit(body);
    },
    () => host.location.href,
    onError,
  );
  // The ⌘ chords of the workbench go to the page. The frame keeps the keys while it has the focus.
  const stopKeys = forwardChords(host, (body) => {
    bridge.emit(body);
  });
  const onMessage = (event: Event): void => {
    void bridge.receive(event as MessageEvent);
  };
  host.addEventListener("message", onMessage);
  const ready = setInterval(() => {
    if (globalThis.__room3dLab === undefined) return;
    clearInterval(ready);
    bridge.emit({ event: "ready", url: host.location.href });
  }, options.readyPollMs ?? 50);
  globalThis.__workbench = {
    origin,
    calls: () => bridge.calls(),
    emit: (body) => {
      bridge.emit(body);
    },
  };
  return () => {
    clearInterval(ready);
    visibility.stop();
    errorEvent.cancel();
    host.removeEventListener("message", onMessage);
    log.stop();
    stopUrl();
    stopHmr();
    stopKeys();
    globalThis.__workbench = undefined;
  };
}

/** Mount the bridge on the lab page (Room3DLab.vue). It stops with the page. Without `workbench` it does nothing. */
export function useWorkbenchBridge(view: ShallowRef<ViewHandle | null>): void {
  const stop = startWorkbenchBridge({ view: () => view.value, hot: import.meta.hot });
  if (stop !== null) onBeforeUnmount(stop);
}
