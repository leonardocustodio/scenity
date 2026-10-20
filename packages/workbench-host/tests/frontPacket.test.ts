// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the packet of the surface in front. The prompt hook sends the packet of the tab in front. `surface.front`
 * sets the tab. The tab is a surface ID of the manifest.
 */
import { describe, expect, test } from "bun:test";
import { createPacketCache, type PacketCache } from "../src/context";
import { createFrontPackets } from "../src/frontPacket";
import { createTurnLog, handleHook } from "../src/hooks";
import { isSurfaceId, type ContextPacket } from "../src/protocol";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const CHECKOUT = "/co";
const NOW = new Date("2026-10-12T10:00:00Z");

function labCache(): PacketCache {
  const packet: ContextPacket = { surface: "lab", made: NOW.toISOString(), checkout: CHECKOUT, url: null, text: "LAB" };
  return createPacketCache(() => Promise.resolve(packet), { debounceMs: 0 });
}

describe("the packet of the surface in front", () => {
  test("a surface ID is a name of the manifest rule", () => {
    expect(["lab", "editor", "shop.view"].every(isSurfaceId)).toBe(true);
    expect(["", "a b", "x/y", 3, null].some(isSurfaceId)).toBe(false);
  });

  test("the prompt hook sends the lab packet", async () => {
    const front = createFrontPackets({ packets: labCache() });
    const hooks = { packet: async () => (await front.packet())?.text ?? null, turns: createTurnLog() };
    const out = await handleHook("UserPromptSubmit", { session_id: "s", prompt: "hi" }, hooks);
    expect(String((out.hookSpecificOutput as { additionalContext?: unknown } | undefined)?.additionalContext)).toBe(
      "LAB",
    );
    expect((await front.packet("lab"))?.text).toBe("LAB");
    expect(front.front()).toBeNull();
    front.setFront("lab");
    expect(front.front()).toBe("lab");
  });
});
