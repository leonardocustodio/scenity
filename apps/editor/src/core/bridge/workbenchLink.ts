// SPDX-License-Identifier: Apache-2.0
/**
 * The clock link through the workbench. In a browser, the link uses the `BroadcastChannel` of graph/clockLink.ts. A
 * lab page in a frame of the workbench page cannot share a `BroadcastChannel` with a lab in another window. The
 * workbench page has another origin, and in the labs app each window is a separate web view. Thus the lab sends each
 * link message to the workbench page as the bridge event `link`. The page sends it to the host (`link.post`). The host
 * sends it to the other windows (`link.message`). Their pages give it to their lab frames with the bridge call `link`.
 *
 * Lab code: the marker gate (tools/lab-markers.ts) keeps `__workbench` out of the learner build.
 */
import { BRIDGE_PARAM } from "@scenity/bridge";

/** A message of the link in the form of a `MessageEvent` (only `data`). */
type LinkListener = (event: MessageEvent) => void;

/** The listeners of each channel in this page. */
const listeners = new Map<string, Set<LinkListener>>();

/** True when the page is a lab frame of the workbench page (the URL has `workbench` and the page has a parent). */
export function inWorkbenchFrame(
  win: { readonly location: { readonly search: string }; readonly parent: unknown } = globalThis,
): boolean {
  return new URLSearchParams(win.location.search).has(BRIDGE_PARAM) && win.parent !== win;
}

/**
 * The bridge call `link` (args `[{ channel, message }]`). It gives a message of another window to the listeners of its
 * channel. Returns the number of the listeners that got the message.
 */
export function deliverLink(value: unknown): number {
  if (typeof value !== "object" || value === null) return 0;
  const { channel, message } = value as { channel?: unknown; message?: unknown };
  if (typeof channel !== "string") return 0;
  const set = listeners.get(channel);
  if (set === undefined) return 0;
  const event = { data: message } as MessageEvent;
  for (const listener of [...set]) listener(event);
  return set.size;
}

/** The part of a channel that the clock link uses (the same as `ChannelLike` of graph/clockLink.ts). */
export interface BridgeChannel {
  postMessage(message: unknown): void;
  addEventListener(type: "message", listener: LinkListener): void;
  removeEventListener(type: "message", listener: LinkListener): void;
  close(): void;
}

/**
 * A channel of the link through the workbench page. A post goes to the page as the bridge event `link`. A bridge call
 * `link` of the channel goes to the listeners. `emit` is the event function of the bridge (default:
 * `__workbench.emit`).
 */
export function bridgeChannel(
  channel: string,
  emit: (body: { event: "link"; channel: string; message: Record<string, unknown> }) => void = (body) => {
    globalThis.__workbench?.emit(body);
  },
): BridgeChannel {
  const own = new Set<LinkListener>();
  let set = listeners.get(channel);
  if (set === undefined) {
    set = new Set();
    listeners.set(channel, set);
  }
  const shared = set;
  return {
    postMessage(message) {
      if (typeof message === "object" && message !== null) {
        emit({ event: "link", channel, message: message as Record<string, unknown> });
      }
    },
    addEventListener(_type, listener) {
      own.add(listener);
      shared.add(listener);
    },
    removeEventListener(_type, listener) {
      own.delete(listener);
      shared.delete(listener);
    },
    close() {
      for (const listener of own) shared.delete(listener);
      own.clear();
    },
  };
}
