// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the context packet: the shape of the packet, the line limit, the cut of long lists, a surface that is not
 * ready, a clock that plays, the Git summary and the cache. The tests use the packet of a host with no plugins (the
 * entity rows). The tests of a host plugin check its own rows.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { buildPacket, createPacketCache, gitSummary, limitLines } from "../src/context";
import { CONTEXT_MAX_LINES, type ContextPacket } from "../src/protocol";
import { useHostPlugins } from "../src/plugins";
import { entity, fakeContext, fakeLab, INSPECT, labAnswers, REPO_ROOT } from "./fakeLab";
import { scaleTestTimeouts } from "./ciTiming";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

describe("buildPacket", () => {
  beforeAll(() => useHostPlugins([]));
  afterAll(() => useHostPlugins(null));

  test("has the lines of the packet for the greet take at 6350 ms", async () => {
    const packet = await buildPacket(fakeContext(fakeLab().port));
    const lines = packet.text.split("\n");
    expect(lines[0]).toBe(
      `Workbench context · ${lines[0]?.slice(20, 36) ?? ""} · checkout ${REPO_ROOT} (lc/room3d-sdk, 3 changed files)`,
    );
    expect(lines[1]).toBe(
      "Surface: lab · http://127.0.0.1:52140/?take=greet&t=6350&paused=1&camera=side&item=clip_wave_hello&tune=wave.hand.y:-0.004",
    );
    expect(packet.text).toContain("Take: greet · source take. Clock: 6350 ms, paused.");
    expect(packet.text).toContain("Camera: side. Tier: high, worker.");
    expect(packet.text).toContain("Open item: clip_wave_hello (one wave · take greet · window 5000–9000 ms");
    expect(packet.text).toContain("On screen at 6350 ms:");
    expect(packet.text).toMatch(/lantern +\(model, light, socket\) +table +\(model, obstacle\)/);
    expect(packet.text).toContain("FAIL hands.toTarget (bo) 0.19 vs max 0.16 at 6350 ms");
    expect(packet.text).toContain('bun run labs tune-apply "wave.hand.y:-0.004"');
    expect(packet.text).toContain("Console: 1 errors, 1 warnings (lab_console).");
    expect(packet.text).toContain("Dev server: ready on port 52140, last edit 14 s ago (src/model/families/wave.ts).");
    expect(lines.at(-1)).toStartWith("Tools: mcp__workbench__* (studio_state first, lab_frame");
    expect(lines.at(-1)).toContain("scene_query, scene_commands and scene_command for the scene editor");
    expect(lines.length).toBeLessThanOrEqual(CONTEXT_MAX_LINES);
    expect(packet).toMatchObject({ surface: "lab", checkout: REPO_ROOT, made: "2026-10-12T15:04:00.000Z" });
  });

  test("cuts long lists with a count and stays within the line limit", async () => {
    const entities = Array.from({ length: 14 }, (_, index) => entity(`box_${String(index)}`));
    const failure = (index: number) => ({
      check: `m${String(index)}`,
      metric: "m",
      member: null,
      value: 1,
      limit: "max 0",
      at: 1,
    });
    const answers = {
      ...labAnswers(),
      inspect: { ...INSPECT, entities },
      check: {
        applies: true,
        take: "greet",
        times: [1],
        failures: Array.from({ length: 9 }, (_, i) => failure(i)),
        known: [],
        worst: [],
        summary: "9 fail",
      },
      tunes: Object.fromEntries(Array.from({ length: 10 }, (_, index) => [`t.${String(index)}`, index])),
    };
    const changed = Array.from({ length: 30 }, (_, index) => `file${String(index)}.ts`);
    const text = (await buildPacket(fakeContext(fakeLab(answers).port, changed))).text;
    expect(text).toContain("… and 6 more entities");
    expect(text).toContain("… and 4 more\n");
    expect(text).toContain("… and 4 more (lab_tunes)");
    expect(text).toContain("file5.ts and 24 more (git status).");
    expect(text.split("\n").length).toBeLessThanOrEqual(CONTEXT_MAX_LINES);
  });

  test("does not run the checks while the clock plays", async () => {
    const answers = { ...labAnswers(), url: "http://127.0.0.1:52140/?take=greet&t=100" };
    const lab = fakeLab(answers);
    const text = (await buildPacket(fakeContext(lab.port))).text;
    expect(text).toContain("Checks: not run while the clock plays (stop the clock for them).");
    expect(lab.calls.some((item) => item.call === "check")).toBe(false);
  });

  test("waits for a drawn frame when the lab has not drawn one yet (the On screen defect)", async () => {
    // The bridge says `ready` before the first frame: the first report has no time and no members.
    let drawn = false;
    const answers = {
      ...labAnswers(),
      inspect: () => (drawn ? INSPECT : { ...INSPECT, simMs: null, entities: [] }),
      frame: () => {
        drawn = true;
        return { simMs: 6350, stats: null };
      },
    };
    const lab = fakeLab(answers);
    const text = (await buildPacket(fakeContext(lab.port))).text;
    expect(text).toContain("On screen at 6350 ms:");
    expect(text).toMatch(/lantern +\(model, light, socket\)/);
    expect(lab.calls.filter((item) => item.call === "inspect")).toHaveLength(2);
  });

  test("says that no frame is drawn when the frame does not come, and asks for no frame after a drawn one", async () => {
    const answers = {
      ...labAnswers(),
      inspect: { ...INSPECT, simMs: null, entities: [] },
      frame: new Error("The lab frame did not answer in 15 s."),
    };
    const text = (await buildPacket(fakeContext(fakeLab(answers).port))).text;
    expect(text).toContain("On screen: no frame yet (the lab drew no frame).");
    expect(text).not.toContain("On screen at ?");
    const plain = fakeLab();
    await buildPacket(fakeContext(plain.port));
    expect(plain.calls.some((item) => item.call === "frame")).toBe(false);
  });

  test("names a surface that is not ready and keeps the other lines", async () => {
    const lab = fakeLab({ url: new Error("The lab frame did not answer in 5 s.") });
    const text = (await buildPacket(fakeContext(lab.port))).text;
    expect(text).toContain("Surface: lab · not ready (The lab frame did not answer in 5 s.)");
    expect(text).toContain("Dev server: ready");
    expect(text).not.toContain("On screen");
  });

  test("limitLines keeps the first lines and the tools line", () => {
    const lines = Array.from({ length: 50 }, (_, index) => `line ${String(index)}`);
    const cut = limitLines(lines);
    expect(cut).toHaveLength(CONTEXT_MAX_LINES);
    expect(cut.at(-2)).toBe("… 11 lines cut");
    expect(cut.at(-1)).toBe("line 49");
  });
});

describe("gitSummary", () => {
  test("reads the branch and the changed files of this checkout", async () => {
    const summary = await gitSummary(REPO_ROOT);
    expect(summary.branch === null || summary.branch.length > 0).toBe(true);
    expect(Array.isArray(summary.changed)).toBe(true);
  });
});

describe("createPacketCache", () => {
  const packetOf = (text: string): ContextPacket => ({ surface: "lab", made: "", checkout: "", url: null, text });

  test("builds once for many refreshes and gives the packet to read", async () => {
    let builds = 0;
    const seen: string[] = [];
    const cache = createPacketCache(() => Promise.resolve(packetOf(`packet ${String(++builds)}`)), {
      debounceMs: 20,
      onPacket: (packet) => seen.push(packet.text),
    });
    cache.refresh();
    cache.refresh();
    cache.refresh();
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(builds).toBe(1);
    expect(cache.current()?.text).toBe("packet 1");
    expect(seen).toEqual(["packet 1"]);
    cache.refresh();
    expect((await cache.read())?.text).toBe("packet 2");
    cache.stop();
  });

  test("read waits at most the given time for a slow build", async () => {
    const cache = createPacketCache(
      () => new Promise<ContextPacket>((resolve) => setTimeout(() => resolve(packetOf("late")), 200)),
    );
    const started = Date.now();
    expect(await cache.read(30)).toBeNull();
    expect(Date.now() - started).toBeLessThan(150);
    expect((await cache.read(1_000))?.text).toBe("late");
  });
});
