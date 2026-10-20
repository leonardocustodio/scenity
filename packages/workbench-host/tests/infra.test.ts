// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the agent infrastructure:
 * - the experiment log (the log finds a run of last week by its take);
 * - the picker (the window, the tune values, the sheets, the labels file);
 * - the Blender server next to the workbench server (the entry copies no secret);
 * - the window hosts, and the requests through a host.
 */
import { afterAll, describe, expect, test } from "bun:test";
// import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { CheckoutSettingsStore, findBlenderServer, safeServer } from "../src/blender";
import { ExperimentLog, intentRunsDir, loopEntry, matches, runEntry } from "../src/experiments";
import { startHost } from "../src/host";
import { checkCandidates, checkWindow, Picker, tunePairs } from "../src/picker";
import { takeOfArgs, type HostEvent, type LoopInfo, type PickSheet, type RunInfo } from "../src/protocol";
import type { RunResult } from "../src/runs";
import { writeClaudeSettings } from "../src/settings";
import { WindowHosts } from "../src/windows";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir, until } from "./helpers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

function run(patch: Partial<RunInfo>): RunInfo {
  return {
    run: "r1",
    command: "motion",
    args: ["greet"],
    checkout: "/repo",
    status: "passed",
    code: 0,
    started: "2026-10-05T10:00:00.000Z",
    ended: "2026-10-05T10:00:12.000Z",
    gpu: true,
    summary: "take greet: 9 pass",
    outDir: null,
    images: [],
    ...patch,
  };
}

describe("the experiment log", () => {
  test("the take of a command line", () => {
    expect(takeOfArgs(["--every", "100", "greet"], true)).toBe("greet");
    expect(takeOfArgs(["--take", "storm", "--from", "1"])).toBe("storm");
    expect(takeOfArgs(["--take=tour"])).toBe("tour");
    expect(takeOfArgs(["--item", "take:greet"])).toBe("greet");
    expect(takeOfArgs(["--quick"])).toBeNull();
    expect(takeOfArgs(["greet"])).toBeNull();
  });

  test("a run of last week is found by its take, its command, its date and a text", () => {
    const state = tempDir("experiments");
    const checkout = tempDir("experiments-checkout");
    made.push(state, checkout);
    const log = new ExperimentLog({ stateDir: state });
    log.add(runEntry(run({ run: "old", args: ["greet", "--out", "/x"] }), null));
    log.add(
      runEntry(
        run({ run: "sheet", command: "sheet", args: ["--take", "storm"], started: "2026-10-12T09:00:00Z" }),
        null,
      ),
    );
    const loop = {
      loop: "bg-1",
      checkout,
      prompt: "fix the hand of the wave",
      take: "greet",
      intent: "wave-hand",
      status: "done",
      started: "2026-10-12T11:00:00.000Z",
      ended: "2026-10-12T11:30:00.000Z",
      stopReason: "success",
      result: "Done.",
      gate: { refusals: 1, last: "pass: 9 pass" },
      endCheck: null,
      review: { run: "rv", status: "passed", outDir: "/pack" },
      costUsd: 1.5,
      turns: 40,
      files: ["plugins/demo/room/src/families/wave.ts"],
    } as unknown as LoopInfo;
    log.add(loopEntry(loop));

    const byTake = log.search({ take: "greet" });
    expect(byTake.map((entry) => entry.id)).toEqual(["bg-1", "old"]);
    expect(byTake[1]?.args).toEqual(["greet"]);
    expect(log.search({ take: "greet", from: "2026-10-01", to: "2026-10-07" }).map((entry) => entry.id)).toEqual([
      "old",
    ]);
    expect(log.search({ command: "claude" }).map((entry) => entry.id)).toEqual(["bg-1"]);
    expect(log.search({ text: "families/wave" }).map((entry) => entry.id)).toEqual(["bg-1"]);
    expect(log.search({ intent: "wave-hand" })[0]?.costUsd).toBe(1.5);
    const intentFile = join(intentRunsDir(checkout, "wave-hand"), "2026-10-12.jsonl");
    expect((JSON.parse(readFileSync(intentFile, "utf8").trim()) as { id: string }).id).toBe("bg-1");
    expect(matches(byTake[0]!, { take: "storm" })).toBe(false);
  });
});

/** A fake shadow frame: it keeps the calls and gives a sheet. */
function fakeShadow() {
  const calls: { call: string; args: readonly unknown[] }[] = [];
  return {
    calls,
    port: {
      call(call: string, args: readonly unknown[] = []) {
        calls.push({ call, args });
        // The bytes of the binary frame, as the host joins them to the answer.
        return Promise.resolve(call === "sheet" ? { bytes: new Uint8Array([1, 2, 3]), mime: "image/webp" } : null);
      },
    },
  };
}

/** A picture store that keeps the pictures in memory. */
function fakePictures(): { put(bytes: Uint8Array, mime: string): string; readonly puts: string[] } {
  const puts: string[] = [];
  return {
    puts,
    put(bytes, mime) {
      puts.push(`${mime} ${String(bytes.length)}`);
      return `p${String(puts.length)}`;
    },
  };
}

const WINDOW = { take: "greet", from: 6000, to: 7000, step: 500, cameras: ["side", "overview"] };

describe("the picker", () => {
  test("the window, the tune values and the candidates are checked", () => {
    expect(checkWindow(WINDOW)).toEqual(WINDOW);
    expect(() => checkWindow({ ...WINDOW, cameras: [] })).toThrow("cameras");
    expect(() => checkWindow({ ...WINDOW, step: 10, to: 60_000 })).toThrow("cells");
    expect(tunePairs("wave.hand.y:0.02,wave.depth:-1e-3")).toEqual([
      ["wave.hand.y", 0.02],
      ["wave.depth", -1e-3],
    ]);
    expect(() => tunePairs("x:abc")).toThrow("Not a tune value");
    expect(() => checkCandidates([{ id: "a", kind: "tune", tune: "" }])).toThrow("2 to 9");
    expect(() =>
      checkCandidates([
        { id: "a", kind: "tune" },
        { id: "a", kind: "tune" },
      ]),
    ).toThrow("own ID");
  });

  test("the sheets: tune values in the shadow frame, a worktree as a run of labs sheet", async () => {
    const shadow = fakeShadow();
    const events: HostEvent[] = [];
    const runCalls: { checkout: string; command: string; args: readonly unknown[] }[] = [];
    const pictures = fakePictures();
    const picker = new Picker({
      pictures,
      shadow: () => shadow.port,
      labUrl: () => "http://127.0.0.1:5000/?take=greet&tune=wave.hand.y:0.02",
      runs: {
        running: () => null,
        startRun(checkout, command, args) {
          runCalls.push({ checkout, command, args });
          return Promise.resolve({ run: "s1", status: "passed", outDir: "/wt/out", summary: "" } as RunResult);
        },
      },
      worktrees: () => [{ loop: "bg-1", path: "/wt", prompt: "try a lower hand" }],
      isCheckout: (path) => Promise.resolve(path === "/wt"),
      current: () => "/repo",
      emit: (event) => events.push(event),
    });
    const candidates = picker.candidates();
    expect(candidates.map((item) => item.id)).toEqual(["defaults", "now", "bg-1"]);
    const job = await picker.sheets(WINDOW, candidates);
    await until(() => events.length === 3);
    const sheets = events.map((event) => (event as { sheet: PickSheet }).sheet);
    // The sheet of a tune candidate is an ID of the picture store, not base64.
    expect(sheets.map((sheet) => [sheet.job, sheet.candidate, sheet.picture, sheet.image])).toEqual([
      [job, "defaults", "p1", null],
      [job, "now", "p2", null],
      [job, "bg-1", null, "/wt/out/sheet.png"],
    ]);
    expect(pictures.puts).toEqual(["image/webp 3", "image/webp 3"]);
    expect(shadow.calls.filter((call) => call.call === "tune")).toEqual([
      { call: "tune", args: ["wave.hand.y", 0.02] },
    ]);
    const sheetCall = shadow.calls.find((call) => call.call === "sheet");
    expect(sheetCall?.args[0]).toMatchObject({ times: [6000, 6500, 7000], cameras: ["side", "overview"] });
    expect(runCalls[0]).toEqual({
      checkout: "/wt",
      command: "sheet",
      args: ["--take", "greet", "--from", "6000", "--to", "7000", "--step", "500", "--camera", "side,overview"],
    });
    await rejectsWith(
      picker.sheets(WINDOW, [candidates[0], { id: "x", kind: "worktree", path: "/etc" }]),
      "not a worktree",
    );
  });

  test("a pick writes the pairwise labels of the winner to labels.jsonl of the intent", () => {
    const checkout = tempDir("picker");
    made.push(checkout);
    const picker = new Picker({
      pictures: fakePictures(),
      shadow: () => fakeShadow().port,
      labUrl: () => null,
      runs: { running: () => null, startRun: () => Promise.reject(new Error("no")) },
      worktrees: () => [],
      isCheckout: () => Promise.resolve(true),
      current: () => checkout,
      emit: () => undefined,
      now: () => new Date("2026-10-12T12:00:00Z"),
    });
    const four = ["a", "b", "c", "d"].map((id) => ({
      id,
      label: id,
      kind: "tune" as const,
      tune: `x.y:${String(id === "a" ? 1 : 2)}`,
    }));
    const picked = picker.pick({
      intent: "wave-left",
      window: WINDOW,
      candidates: four,
      winner: "c",
      why: "less bounce",
    });
    expect(picked.labels).toBe(3);
    expect(picked.file).toBe(join(checkout, "apps/editor/intents/wave-left/labels.jsonl"));
    const skipped = picker.pick({ intent: "wave-left", window: WINDOW, candidates: four, winner: null });
    expect(skipped.labels).toBe(0);
    const lines = readFileSync(picked.file, "utf8")
      .trim()
      .split("\n")
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toHaveLength(4);
    expect(lines.slice(0, 3).map((line) => [line.winner, line.loser])).toEqual([
      ["c", "a"],
      ["c", "b"],
      ["c", "d"],
    ]);
    expect(lines[0]).toMatchObject({
      why: "less bounce",
      winnerValue: "tune:x.y:2",
      source: "workbench",
      intent: "wave-left",
    });
    expect(lines[3]).toMatchObject({ skip: true });
    expect(() => picker.pick({ intent: "Bad Id", window: WINDOW, candidates: four, winner: "a" })).toThrow("intent");
    expect(() => picker.pick({ intent: "x", window: WINDOW, candidates: four, winner: "z" })).toThrow("winner");
  });
});

describe("the Blender server", () => {
  function home(): string {
    const dir = tempDir("home");
    made.push(dir);
    const server = { type: "stdio", command: "uvx", args: ["blender-mcp"], env: { BLENDER_KEY: "secret" } };
    writeFileSync(join(dir, ".claude.json"), JSON.stringify({ mcpServers: { blender: server } }));
    return dir;
  }

  test("the entry keeps the command and leaves out the secrets", () => {
    expect(safeServer({ command: "uvx", args: ["blender-mcp", 3], env: { K: "v" } })).toEqual({
      type: "stdio",
      command: "uvx",
      args: ["blender-mcp"],
    });
    expect(safeServer({ type: "http", url: "http://x", headers: { a: "b" } })).toEqual({
      type: "http",
      url: "http://x",
    });
    expect(safeServer({ type: "stdio" })).toBeNull();
    expect(findBlenderServer("/repo", home())).toEqual({ type: "stdio", command: "uvx", args: ["blender-mcp"] });
    expect(findBlenderServer("/repo", tempDir("empty-home"))).toBeNull();
  });

  test("the checkout setting (default off) adds the server next to workbench in the generated MCP config", () => {
    const state = tempDir("blender-state");
    made.push(state);
    const store = new CheckoutSettingsStore(state, home());
    expect(store.get("/repo")).toEqual({ blender: false, blenderFound: true, intent: null, builtLab: false });
    expect(store.extraServers("/repo")).toEqual({});
    expect(store.set("/repo", { blender: true, intent: "wave-left" })).toEqual({
      blender: true,
      blenderFound: true,
      intent: "wave-left",
      builtLab: false,
    });
    // The built lab in the visible lab frame (default off).
    expect(store.set("/repo", { builtLab: true }).builtLab).toBe(true);
    expect(() => store.set("/repo", { builtLab: "yes" })).toThrow("builtLab");
    expect(() => store.set("/repo", { intent: "No!" })).toThrow("intent");
    const files = writeClaudeSettings({
      stateDir: state,
      endpoint: { origin: "http://127.0.0.1:4999", token: "b".repeat(64) },
      extraServers: store.extraServers("/repo"),
    });
    const text = readFileSync(files.mcpConfig, "utf8");
    const mcp = JSON.parse(text) as { mcpServers: Record<string, Record<string, unknown>> };
    expect(Object.keys(mcp.mcpServers)).toEqual(["blender", "workbench"]);
    expect(mcp.mcpServers.blender).toEqual({ type: "stdio", command: "uvx", args: ["blender-mcp"] });
    expect(text).not.toContain("secret");
  });
});

describe("the window hosts", () => {
  test("a second host per checkout; this checkout and a folder outside the repository are refused", async () => {
    const started: string[] = [];
    let alive = true;
    const windows = new WindowHosts({
      current: () => "/repo",
      isCheckout: (path) => Promise.resolve(path.startsWith("/repo")),
      start: (checkout) => {
        started.push(checkout);
        return Promise.resolve({
          endpoint: { origin: "http://127.0.0.1:4100", token: "c".repeat(64) },
          alive: () => alive,
          stop: () => (alive = false),
        });
      },
    });
    expect(await windows.open("/repo-b")).toEqual({
      origin: "http://127.0.0.1:4100",
      token: "c".repeat(64),
      checkout: "/repo-b",
    });
    await windows.open("/repo-b");
    expect(started).toEqual(["/repo-b"]);
    await rejectsWith(windows.open("/repo"), "already");
    await rejectsWith(windows.open("/tmp/other"), "not a worktree");
    windows.stopAll();
    expect(alive).toBe(false);
  });
});

describe("the requests through a host", () => {
  test(
    "checkout.settings, experiments.search after a run, loops.list and windows.open",
    async () => {
      const { parent, repo } = await makeRepo();
      const state = tempDir("infra-host");
      const fakeHome = tempDir("infra-home");
      made.push(parent, state, fakeHome);
      const host = await startHost({
        checkout: repo,
        stateDir: state,
        serverCommand: fakeCommand,
        watch: false,
        runSpawn: (_argv, options) => {
          options.onOutput("stdout", "take greet: 9 pass\n");
          return { exited: Promise.resolve({ code: 0, signal: null }), signal: () => undefined };
        },
        infra: { home: fakeHome },
      });
      const page = await FakePage.open(host.endpoint);
      try {
        expect(await page.call("checkout.settings", {})).toEqual({
          blender: false,
          blenderFound: false,
          intent: null,
          builtLab: false,
        });
        await page.call("checkout.settings", { intent: "wave-left" });
        await page.call("runs.start", { command: "motion", args: ["greet"] });
        await page.waitEvent((event) => event.type === "runs.done");
        await until(() => host.infra.log.all().length === 1);
        const found = (await page.call("experiments.search", { take: "greet" })) as {
          intent: string;
          command: string;
        }[];
        expect(found).toMatchObject([{ intent: "wave-left", command: "bun run labs motion", take: "greet" }]);
        expect(await page.call("loops.list", {})).toEqual([]);
        const answer = await page.request("windows.open", { path: repo });
        expect(answer.ok).toBe(false);
        const bad = await page.request("loops.start", { prompt: "", budgetUsd: 1, maxTurns: 1, minutes: 1 });
        expect(bad.ok).toBe(false);
      } finally {
        page.close();
        await host.stop();
      }
    },
    ciWaitMs(20_000),
  );
});
