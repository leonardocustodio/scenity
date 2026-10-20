// SPDX-License-Identifier: Apache-2.0
/**
 * The page bridge of the scene page in the studio. The page connects to the studio host over the socket `/bridge`
 * (same origin, the session of the studio). It answers the same bridge calls as in a workbench frame (sceneBridge.ts
 * `pageCalls`, the script API). First, it sends its project and its scene (`hello`). A picture result travels as
 * `{ $bytes: <base64> }`. A closed socket opens again after a wait.
 */
import { INSPECT_CALL } from "@scenity/bridge";
import { createWorkbenchBridge, type BridgeHost, type BridgeParent } from "../core/bridge/bridgeCore";
import { captureConsole } from "../core/bridge/workbenchConsole";
import { receiveWindowMessage, setDocumentSender, WINDOW_MESSAGES, type WindowMessage } from "./documentSync";
import { servedByStudio } from "./projects/noProject";
import { receivePresence } from "./agent/presence";
import { pageCalls, startSceneBridge, type SceneBridgeParts } from "./sceneBridge";

export type { SceneBridgeParts };

/** The origin that the bridge gives to its messages of the socket (no window origin: one socket, one host). */
const SOCKET_ORIGIN = "studio";
/** The wait before a closed socket opens again (ms). */
const RETRY_MS = 2000;

/** The bytes of a value as base64. */
function base64(bytes: Uint8Array): string {
  let text = "";
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

/** A message of the bridge as JSON: each `Uint8Array` or `ArrayBuffer` as `{ $bytes: <base64> }`. */
export function socketText(message: object): string {
  return JSON.stringify(message, (_key, value: unknown) => {
    if (value instanceof Uint8Array) return { $bytes: base64(value) };
    if (value instanceof ArrayBuffer) return { $bytes: base64(new Uint8Array(value)) };
    return value;
  });
}

/** What the studio bridge reads of the page. */
export interface StudioBridgeParts extends SceneBridgeParts {
  readonly project: string;
  scene(): string;
  /** Open the socket (a test gives a fake). */
  readonly open?: () => WebSocket;
}

/** The socket of the bridge of this page. */
function socketUrl(): string {
  return `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}/bridge`;
}

/** Start the bridge of the page over the studio socket. The result stops it. */
export function startStudioBridge(parts: StudioBridgeParts): () => void {
  const host: BridgeHost = parts.host ?? globalThis;
  const log = captureConsole(host, () => undefined);
  let socket: WebSocket | null = null;
  let stopped = false;
  const parent: BridgeParent = {
    postMessage: (message: unknown) => {
      if (socket?.readyState === WebSocket.OPEN) socket.send(socketText(message as object));
    },
  };
  const bridge = createWorkbenchBridge({
    origin: SOCKET_ORIGIN,
    parent,
    api: () => globalThis.__scenity,
    calls: pageCalls(parts, host, () => log.take()),
    typed: [INSPECT_CALL],
  });
  const connect = (): void => {
    if (stopped) return;
    const open = parts.open ?? (() => new WebSocket(socketUrl()));
    const next = open();
    socket = next;
    let scene = parts.scene();
    next.addEventListener("open", () => {
      next.send(JSON.stringify({ type: "hello", project: parts.project, scene }));
      // The changes of the scene go to the host. A change of the open scene sends `hello` again.
      setDocumentSender((message) => {
        const now = parts.scene();
        if (now !== scene) {
          scene = now;
          next.send(JSON.stringify({ type: "hello", project: parts.project, scene }));
        }
        next.send(JSON.stringify(message));
      });
    });
    next.addEventListener("message", (event) => {
      if (typeof event.data !== "string") return;
      let data: unknown;
      try {
        data = JSON.parse(event.data);
      } catch {
        return;
      }
      const record = data as { type?: unknown };
      if (typeof record.type === "string" && WINDOW_MESSAGES.has(record.type))
        receiveWindowMessage(data as WindowMessage);
      // The presence of an agent session of the project.
      else if (record.type === "agent.presence") receivePresence(data);
      else void bridge.receive({ source: parent, origin: SOCKET_ORIGIN, data });
    });
    next.addEventListener("close", () => {
      if (socket === next) socket = null;
      setDocumentSender(null);
      if (!stopped) setTimeout(connect, RETRY_MS);
    });
  };
  connect();
  return () => {
    stopped = true;
    socket?.close();
    log.stop();
  };
}

/**
 * Start the bridge of the page: the frame bridge in a workbench frame, else (a page of the studio) the socket of the
 * studio. `scene` gives the path of the open scene for the `hello` of the socket.
 */
export function startPageBridges(parts: SceneBridgeParts, project: string | null, scene: () => string): void {
  // The open scene of the window (the scene switcher changes it).
  const open = (): string => globalThis.__scenity?.file().path ?? scene();
  if (startSceneBridge(parts) !== null || project === null) return;
  void servedByStudio().then((studio) => {
    if (studio) startStudioBridge({ ...parts, project, scene: open });
  });
}
