// SPDX-License-Identifier: Apache-2.0
/**
 * The packet of the surface in front. The page tells the host which tab is in front (`surface.front`). The
 * `UserPromptSubmit` hook and `GET /context` without a surface send the packet of that surface. Each surface gets the
 * packet of the scene surface from the cache (context.ts). The tab is a surface ID of the project manifest. Null is
 * the scene surface (the first surface with the capability `scene`).
 */
import type { PacketCache } from "./context";
import type { ContextPacket, SurfaceId } from "./protocol";

export interface FrontPackets {
  /** The current surface in front, or null for the scene surface (the default). */
  front(): SurfaceId | null;
  setFront(id: SurfaceId | null): void;
  /** The packet of a surface, or of the surface in front without one. Null when the lab has no packet yet. */
  packet(surface?: string | null): Promise<ContextPacket | null>;
}

export interface FrontPacketDeps {
  readonly packets: PacketCache;
}

/** Make the packets of the surface in front. */
export function createFrontPackets(deps: FrontPacketDeps): FrontPackets {
  let front: SurfaceId | null = null;
  return {
    front: () => front,
    setFront: (id) => {
      front = id;
    },
    packet: async () => deps.packets.read(),
  };
}
