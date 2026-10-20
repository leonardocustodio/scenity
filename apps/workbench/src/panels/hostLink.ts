// SPDX-License-Identifier: Apache-2.0
/**
 * The clock link between the lab frames of the windows (apps/editor `workbenchLink.ts` is the frame half). The
 * visible lab frame of a page sends each link message as the bridge event `link`. The page sends it to the host
 * (`link.post`, the clock state with `keep`). The page gives each `link.message` of the host to its visible lab frame
 * with the bridge call `link`. The shadow and indexer frames get no link: only the frame that the owner sees leads or
 * follows.
 *
 * A new window gets the kept clock state of the host (`link.kept`) until its frame has a listener for it. Thus a
 * follower knows the time of the main lab at once. The lab frame is the frame of the scene surface (the relay finds
 * it by its capability).
 */
import type { BridgeLinkEvent, EventPayload, SurfaceWhere } from "@scenity/workbench-host/protocol";
import type { HostRequest } from "../host/useHost";
import type { SurfaceRelay } from "../surfaces/relay";

/** The channel of the clock link (CLOCK_CHANNEL of apps/editor graph/clockLink.ts). */
export const CLOCK_CHANNEL = "scenity-clock";

/** The host parts of the link (a test gives fakes). */
export interface LinkHost {
  readonly request: HostRequest;
  /** Listen to the `link.message` events of the host. The result stops the listener. */
  on(listener: (payload: EventPayload<"link.message">) => void): () => void;
}

/**
 * The handler of the `link` events of the relay: the messages of the visible frame of the scene surface go to the
 * host. `scene` gives the ID of the scene surface.
 */
export function linkToHost(
  request: HostRequest,
  scene: () => string | null,
): (surface: string, where: SurfaceWhere, event: BridgeLinkEvent) => void {
  return (surface, where, event) => {
    if (surface !== scene() || where !== "visible") return;
    const keep = event.message.kind === "clock";
    void request("link.post", { channel: event.channel, message: event.message, keep }).catch(() => undefined);
  };
}

/** Give a message to the visible lab frame. Gives the count of the listeners of the frame (0: none yet, or no frame). */
export async function deliver(relay: SurfaceRelay, channel: string, message: unknown): Promise<number> {
  const scene = relay.idWith();
  if (scene === null || !relay.has(scene, "visible")) return 0;
  try {
    const count = await relay.call(scene, "visible", "link", [{ channel, message }], 5_000);
    return typeof count === "number" ? count : 0;
  } catch {
    return 0;
  }
}

/** Give each `link.message` of the host to the visible lab frame. The result stops it. */
export function linkFromHost(host: LinkHost, relay: SurfaceRelay): () => void {
  return host.on((payload) => {
    void deliver(relay, payload.channel, payload.message);
  });
}

/**
 * Give the kept clock state of the host to the visible lab frame until a listener of the frame takes it (at most
 * `tries` times, `gapMs` apart). Gives true when a listener took it.
 */
export async function deliverKept(
  request: HostRequest,
  relay: SurfaceRelay,
  options: { readonly tries?: number; readonly gapMs?: number } = {},
): Promise<boolean> {
  const tries = options.tries ?? 20;
  for (let attempt = 0; attempt < tries; attempt += 1) {
    const kept = await request("link.kept", { channel: CLOCK_CHANNEL }).catch(() => null);
    if (kept !== null && (await deliver(relay, CLOCK_CHANNEL, kept.message)) > 0) return true;
    await new Promise((resolve) => setTimeout(resolve, options.gapMs ?? 500));
  }
  return false;
}
