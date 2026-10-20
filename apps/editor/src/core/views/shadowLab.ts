// SPDX-License-Identifier: Apache-2.0
/**
 * A hidden lab frame of a separate view: a lab page of the same origin in a frame that the view does not show. The
 * view controls it through the workbench bridge (`workbench=<own origin>`, workbenchBridge.ts), as the workbench
 * controls its shadow frame. The graph window without a linked lab measures its take in it. The compare view draws and
 * captures in it the frames that the index does not have. The frame draws (it has a size and no `display: none`), thus
 * a capture shows the scene. The frame is not visible and takes no pointer. The messages are the contract of
 * `@scenity/bridge`.
 */
import { answerOutcome, BRIDGE_PARAM, callMessage, isBridgeAnswer, isBridgeEvent } from "@scenity/bridge";
import { t } from "../../texts";

/** A hidden lab frame and its bridge calls: a method of the lab API or `capture`. */
export interface ShadowLab {
  readonly element: HTMLIFrameElement;
  /** The bridge of the frame said `ready`. */
  readonly ready: Promise<void>;
  call<T>(name: string, ...args: unknown[]): Promise<T>;
  dispose(): void;
}

export interface ShadowOptions {
  /** The query of the lab page (the take, the camera, …). The function adds the bridge and the page options. */
  readonly query?: Readonly<Record<string, string>>;
  readonly width?: number;
  readonly height?: number;
  /** The longest wait for `ready` and for each call (ms). */
  readonly timeoutMs?: number;
  readonly host?: Window;
}

/** The URL of the hidden lab page: the bridge to this origin, no panel, no dock, a stopped clock at 0. */
export function shadowUrl(location: Location | URL, query: Readonly<Record<string, string>> = {}): string {
  const url = new URL("/", location.href);
  const params = new URLSearchParams({
    [BRIDGE_PARAM]: location.origin,
    panel: "0",
    dock: "0",
    paused: "1",
    t: "0",
    adaptive: "0",
    ...query,
  });
  // The page secret of a tool also goes to the frame.
  const key = new URLSearchParams(location.search).get("labsKey");
  if (key !== null) params.set("labsKey", key);
  url.search = params.toString();
  return url.toString();
}

interface Pending {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timer: ReturnType<typeof setTimeout>;
}

/** Open a hidden lab frame in the page. */
export function openShadowLab(options: ShadowOptions = {}): ShadowLab {
  const host = options.host ?? window;
  const timeoutMs = options.timeoutMs ?? 90_000;
  const element = host.document.createElement("iframe");
  element.title = t("lab-shadow-frame");
  element.setAttribute("aria-hidden", "true");
  element.tabIndex = -1;
  Object.assign(element.style, {
    position: "fixed",
    left: "0",
    top: "0",
    width: `${String(options.width ?? 640)}px`,
    height: `${String(options.height ?? 400)}px`,
    border: "0",
    opacity: "0",
    pointerEvents: "none",
    zIndex: "-1",
  });
  element.src = shadowUrl(host.location, options.query);
  const pending = new Map<number, Pending>();
  let next = 1;
  let markReady: () => void = () => undefined;
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve;
    setTimeout(() => {
      reject(new Error(`The hidden lab frame was not ready in ${String(timeoutMs / 1000)} s.`));
    }, timeoutMs);
  });
  ready.catch(() => undefined);
  const onMessage = (event: MessageEvent): void => {
    if (event.source !== element.contentWindow || event.origin !== host.location.origin) return;
    const data: unknown = event.data;
    if (isBridgeEvent(data) && data.event === "ready") markReady();
    if (!isBridgeAnswer(data)) return;
    const call = pending.get(data.id);
    if (call === undefined) return;
    pending.delete(data.id);
    clearTimeout(call.timer);
    const outcome = answerOutcome(data);
    if ("error" in outcome) call.reject(new Error(outcome.error));
    else call.resolve(outcome.result);
  };
  host.addEventListener("message", onMessage);
  host.document.body.append(element);

  return {
    element,
    ready,
    async call<T>(name: string, ...args: unknown[]): Promise<T> {
      await ready;
      const id = next++;
      return new Promise<T>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`The hidden lab frame gave no answer to ${name} in ${String(timeoutMs / 1000)} s.`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        element.contentWindow?.postMessage(callMessage(id, name, args), host.location.origin);
      });
    },
    dispose() {
      host.removeEventListener("message", onMessage);
      for (const call of pending.values()) {
        clearTimeout(call.timer);
        call.reject(new Error("The hidden lab frame closed."));
      }
      pending.clear();
      element.remove();
    },
  };
}
