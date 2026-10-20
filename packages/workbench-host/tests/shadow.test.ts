// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the shadow surface: the shadow URL, the wait for its `ready` event, the
 * calls to the shadow frame only, the idle end and the new shadow after a change of the scene.
 */
import { describe, expect, test } from "bun:test";
import { sceneKey, shadowUrlOf, ShadowFrames, type ShadowRegistry } from "../src/shadow";
import type { CallOptions } from "../src/surfaces";
import { rejectsWith, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const VISIBLE = "http://127.0.0.1:5400/?take=greet&t=6350&paused=1&camera=side&workbench=http%3A%2F%2F127.0.0.1%3A5300";

function fakeRegistry(visible: { url: string | null }) {
  const shadows: (string | null)[] = [];
  const calls: { call: string; args: readonly unknown[]; options: CallOptions }[] = [];
  const registry: ShadowRegistry = {
    visibleUrl: () => visible.url,
    setShadow: (_surface, url) => shadows.push(url),
    call: (_surface, call, args, options) => {
      calls.push({ call, args, options });
      return Promise.resolve({ call });
    },
  };
  return { registry, shadows, calls };
}

const READY = { workbench: 1, event: "ready", url: "x" } as const;

describe("the shadow URL", () => {
  test("is the visible URL state without the bridge parameter, with no panel and no dock", () => {
    const url = new URL(shadowUrlOf(VISIBLE));
    expect(url.searchParams.get("take")).toBe("greet");
    expect(url.searchParams.get("t")).toBe("6350");
    expect(url.searchParams.get("camera")).toBe("side");
    expect(url.searchParams.get("panel")).toBe("0");
    expect(url.searchParams.get("dock")).toBe("0");
    expect(url.searchParams.has("workbench")).toBe(false);
  });

  test("the scene key ignores the clock and the order of the parameters", () => {
    const moved = "http://127.0.0.1:5400/?camera=side&t=9000&take=greet";
    expect(sceneKey(VISIBLE)).toBe(sceneKey(moved));
    expect(sceneKey(VISIBLE)).not.toBe(sceneKey("http://127.0.0.1:5400/?take=storm&camera=side"));
  });
});

describe("the shadow frames", () => {
  test("the first call shows the shadow, waits for its ready event and goes to the shadow frame only", async () => {
    const { registry, shadows, calls } = fakeRegistry({ url: VISIBLE });
    const frames = new ShadowFrames({ registry, idleMs: 60_000 });
    const answer = frames.call("lab", "seek", [9000], { timeoutMs: 1000 });
    expect(shadows).toHaveLength(1);
    expect(calls).toHaveLength(0);
    frames.onEvent("lab", "visible", READY);
    await Bun.sleep(10);
    expect(calls).toHaveLength(0);
    frames.onEvent("lab", "shadow", READY);
    expect(await answer).toEqual({ call: "seek" });
    expect(calls[0]?.options).toEqual({ timeoutMs: 1000, where: "shadow" });
    await frames.call("lab", "frame");
    expect(shadows).toHaveLength(1);
    frames.closeAll();
    expect(shadows.at(-1)).toBeNull();
  });

  test("an idle shadow goes away", async () => {
    const { registry, shadows } = fakeRegistry({ url: VISIBLE });
    const frames = new ShadowFrames({ registry, idleMs: 30 });
    const answer = frames.call("lab", "time");
    frames.onEvent("lab", "shadow", READY);
    await answer;
    expect(frames.has("lab")).toBe(true);
    await until(() => !frames.has("lab"), 1000, "the idle end");
    expect(shadows).toEqual([shadowUrlOf(VISIBLE), null]);
  });

  test("a scene change of the shadow or of the visible frame gives a new shadow after a quiet time", async () => {
    const visible = { url: VISIBLE as string | null };
    const { registry, shadows } = fakeRegistry(visible);
    let now = 1_000;
    const frames = new ShadowFrames({ registry, idleMs: 60_000, quietMs: 100, now: () => now });
    const first = frames.call("lab", "load", ["storm"]);
    frames.onEvent("lab", "shadow", READY);
    await first;
    // Within the quiet time the same shadow answers (a tool makes many calls).
    now += 50;
    const second = frames.call("lab", "frame");
    await second;
    expect(shadows).toHaveLength(1);
    now += 200;
    void frames.call("lab", "frame");
    expect(shadows).toEqual([shadowUrlOf(VISIBLE), null, shadowUrlOf(VISIBLE)]);
    frames.onEvent("lab", "shadow", READY);
    frames.closeAll();
  });

  test("no visible URL and no ready event give errors", async () => {
    const none = new ShadowFrames({ registry: fakeRegistry({ url: null }).registry });
    await rejectsWith(none.call("lab", "time"), "has no URL yet");
    const { registry } = fakeRegistry({ url: VISIBLE });
    const late = new ShadowFrames({ registry, readyTimeoutMs: 30 });
    await rejectsWith(late.call("lab", "time"), "was not ready");
    expect(late.has("lab")).toBe(false);
  });
});
