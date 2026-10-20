// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the background runs:
 * - the parameters and the command line, the commit refusal, the generated settings and the stream-json reader;
 * - a whole run with a fake claude (the `Stop` gate on `labs motion`, the files, the review pack, the record, no
 *   commit);
 * - the wall-clock stop, the stop by the owner, and a real process group that the wall-clock limit ends.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { headCommit } from "../src/git";
import { commitRefusal, loopHookPath, loopRefusal, loopSettingsJson, writeLoopFiles } from "../src/loopGuard";
import { checkLoopParams, loopArgv, type LoopRuns } from "../src/loopRun";
import { LoopManager } from "../src/loops";
import { StreamReader } from "../src/loopStream";
import type { HostEvent, LoopInfo } from "../src/protocol";
import type { RunResult } from "../src/runs";
import { spawnRun, type RunExit, type RunSpawner, type SpawnOptions } from "../src/runs";
import { cleanup, makeRepo, tempDir, until } from "./helpers";
import { ciWaitMs, scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const made: string[] = [];
afterAll(() => cleanup(...made));

const ENDPOINT = { origin: "http://127.0.0.1:4999", token: "a".repeat(64) };

/** The stream of a short run of the CLI. */
function streamLines(session = "s-1"): string[] {
  return [
    { type: "system", subtype: "init", session_id: session, model: "claude-haiku-5-5" },
    {
      type: "assistant",
      message: {
        content: [
          { type: "text", text: "I read the lab state." },
          { type: "tool_use", name: "mcp__workbench__lab_state", input: {} },
        ],
      },
    },
    { type: "user", message: { content: [{ type: "tool_result", is_error: true, content: "no frame" }] } },
    {
      type: "result",
      subtype: "success",
      is_error: false,
      num_turns: 3,
      total_cost_usd: 0.0123,
      session_id: session,
      result: "The take is greet.",
    },
  ].map((value) => `${JSON.stringify(value)}\n`);
}

interface FakeProcess {
  readonly argv: readonly string[];
  readonly options: SpawnOptions;
  readonly signals: string[];
  end(code: number | null): void;
}

function fakeSpawner(): { spawn: RunSpawner; processes: FakeProcess[] } {
  const processes: FakeProcess[] = [];
  const spawn: RunSpawner = (argv, options) => {
    let end: (exit: RunExit) => void = () => undefined;
    const exited = new Promise<RunExit>((resolve) => (end = resolve));
    const signals: string[] = [];
    processes.push({ argv, options, signals, end: (code) => end({ code, signal: null }) });
    return {
      exited,
      signal(signal) {
        signals.push(signal);
        if (signal !== "SIGINT") end({ code: null, signal });
      },
    };
  };
  return { spawn, processes };
}

function result(patch: Partial<RunResult>): RunResult {
  return {
    run: "r1",
    command: "motion",
    args: [],
    checkout: "/repo",
    status: "passed",
    code: 0,
    started: "2026-10-12T15:00:00.000Z",
    ended: "2026-10-12T15:00:10.000Z",
    gpu: true,
    summary: "",
    outDir: null,
    images: [],
    ...patch,
  };
}

/** Fake runs: `motion` fails `fails` times, then passes; `review` passes with an output folder. */
function fakeRuns(fails: number): LoopRuns & { calls: { command: string; args: readonly unknown[] }[] } {
  const calls: { command: string; args: readonly unknown[] }[] = [];
  let left = fails;
  return {
    calls,
    running: () => null,
    startRun(checkout, command, args) {
      calls.push({ command, args });
      if (command === "motion") {
        const pass = left <= 0;
        left -= 1;
        return Promise.resolve(
          result({ command: "motion", status: pass ? "passed" : "failed", summary: pass ? "9 pass" : "1 FAIL wave" }),
        );
      }
      return Promise.resolve(result({ run: "review-1", command: "review", outDir: `${checkout}/out` }));
    },
  };
}

describe("the parameters, the command line and the rules", () => {
  test("the parameters are checked", () => {
    const plan = checkLoopParams({ prompt: " fix it ", budgetUsd: 2, maxTurns: 40, minutes: 30, take: "greet" });
    expect(plan).toMatchObject({ prompt: "fix it", sequence: "greet", intent: null, model: null, worktree: false });
    const path = checkLoopParams({ prompt: "p", budgetUsd: 1, maxTurns: 1, minutes: 1, sequence: "sequences/a.json" });
    expect(path.sequence).toBe("sequences/a.json");
    expect(() => checkLoopParams({ prompt: "x", budgetUsd: 1, maxTurns: 1, minutes: 1, sequence: "../x" })).toThrow(
      '"sequence"',
    );
    expect(() => checkLoopParams({ prompt: "", budgetUsd: 1, maxTurns: 1, minutes: 1 })).toThrow('"prompt"');
    expect(() => checkLoopParams({ prompt: "x", budgetUsd: 0, maxTurns: 1, minutes: 1 })).toThrow('"budgetUsd"');
    expect(() => checkLoopParams({ prompt: "x", budgetUsd: 1, maxTurns: 1.5, minutes: 1 })).toThrow('"maxTurns"');
    expect(() => checkLoopParams({ prompt: "x", budgetUsd: 1, maxTurns: 1, minutes: 1, take: "a b" })).toThrow(
      '"take"',
    );
    expect(() => checkLoopParams({ prompt: "x", budgetUsd: 1, maxTurns: 1, minutes: 1, intent: "A!" })).toThrow(
      '"intent"',
    );
  });

  test("the command line is the unmodified CLI in print mode with the limits and the generated files", () => {
    const plan = checkLoopParams({ prompt: "p", budgetUsd: 0.1, maxTurns: 3, minutes: 5, model: "claude-haiku-5-5" });
    expect(loopArgv("/bin/claude", plan, { mcpConfig: "/s/mcp.json", settings: "/s/settings.json" })).toEqual([
      ...["/bin/claude", "-p", "p", "--permission-mode", "bypassPermissions", "--max-turns", "3"],
      ...["--max-budget-usd", "0.1", "--output-format", "stream-json", "--verbose", "--mcp-config", "/s/mcp.json"],
      ...["--strict-mcp-config", "--settings", "/s/settings.json", "--model", "claude-haiku-5-5"],
    ]);
  });

  test("every Git command that commits is refused, also in sh -c", () => {
    for (const command of [
      "git commit -m x",
      "git -C packages/room3d commit -am x",
      "cd a && git commit",
      "sh -c 'git commit -m done'",
      "git merge main",
      "git cherry-pick abc",
      "/usr/bin/git -c user.name=x commit",
    ]) {
      expect(commitRefusal(command)).toContain("never commits");
    }
    for (const command of ["git status", "git diff HEAD", "git add a.ts", "echo git commit", "bun run labs motion"]) {
      expect(commitRefusal(command)).toBeNull();
    }
    expect(loopRefusal("git push")).toContain("git push");
    expect(loopRefusal("git log")).toBeNull();
  });

  test("the settings send the hooks of the run to its own path and deny the commit", () => {
    const json = loopSettingsJson(ENDPOINT.origin, "bg-1") as {
      hooks: Record<string, { matcher?: string; hooks: { url: string; timeout: number }[] }[]>;
      permissions: { allow: string[]; deny: string[] };
    };
    expect(Object.keys(json.hooks)).toEqual(["PreToolUse", "PostToolUse", "Stop"]);
    expect(json.hooks.PreToolUse?.[0]?.matcher).toBe("Bash");
    expect(json.hooks.Stop?.[0]?.hooks[0]?.url).toBe(`${ENDPOINT.origin}/loops/bg-1/hooks/Stop`);
    expect(json.permissions.allow).toEqual(["mcp__workbench__*"]);
    expect(json.permissions.deny).toContain("Bash(git commit:*)");
    expect(loopHookPath("/loops/bg-1/hooks/Stop")).toEqual({ loop: "bg-1", event: "Stop" });
    expect(loopHookPath("/loops/bg-1/hooks/UserPromptSubmit")).toBeNull();
    expect(loopHookPath("/hooks/Stop")).toBeNull();
  });

  test("the stream reader keeps the facts and gives short progress lines", () => {
    const lines: string[] = [];
    const reader = new StreamReader((line) => lines.push(line));
    const text = streamLines().join("");
    reader.push(text.slice(0, 50));
    reader.push(text.slice(50));
    reader.end();
    expect(reader.facts).toMatchObject({ session: "s-1", turns: 3, costUsd: 0.0123, subtype: "success" });
    expect(reader.facts.result).toBe("The take is greet.");
    expect(lines).toEqual([
      "session s-1 · model claude-haiku-5-5",
      "Claude: I read the lab state.",
      "tool mcp__workbench__lab_state:",
      "tool error: no frame",
      "result success: 3 turns, about $0.0123",
    ]);
  });
});

async function setup(fails: number, options: { minuteMs?: number } = {}) {
  const { parent, repo } = await makeRepo();
  const state = tempDir("loop-state");
  made.push(parent, state);
  const { spawn, processes } = fakeSpawner();
  const runs = fakeRuns(fails);
  const events: HostEvent[] = [];
  const ended: LoopInfo[] = [];
  const loops = new LoopManager({
    stateDir: state,
    endpoint: ENDPOINT,
    repo,
    current: () => repo,
    emit: (event) => events.push(event),
    runs,
    spawn,
    claude: () => "/fake/claude",
    env: { PATH: "/usr/bin:/bin", HOME: "/home/x", ANTHROPIC_API_KEY: "sk-test", CLAUDECODE: "1" },
    extraServers: () => ({ blender: { type: "stdio", command: "uvx", args: ["blender-mcp"] } }),
    onEnd: (info) => ended.push(info),
    graceMs: 20,
    ...options,
  });
  return { repo, state, loops, processes, runs, events, ended };
}

describe("a background run with a fake claude", () => {
  test("the gate, the commit refusal, the files, the review pack and the record; no commit", async () => {
    const { repo, state, loops, processes, runs, events, ended } = await setup(1);
    const info = loops.start({ prompt: "fix the hat", take: "greet", budgetUsd: 1, maxTurns: 10, minutes: 30 });
    await until(() => processes.length === 1);
    const claude = processes[0]!;
    expect(claude.argv[0]).toBe("/fake/claude");
    expect(claude.options.cwd).toBe(repo);
    expect(claude.options.env.ANTHROPIC_API_KEY).toBeUndefined();
    expect(claude.options.env.CLAUDECODE).toBeUndefined();
    expect(claude.options.env.SCENITY_WORKBENCH_TOKEN).toBe(ENDPOINT.token);
    const mcp = JSON.parse(readFileSync(claude.argv[claude.argv.indexOf("--mcp-config") + 1]!, "utf8")) as {
      mcpServers: Record<string, unknown>;
    };
    expect(Object.keys(mcp.mcpServers).sort()).toEqual(["blender", "workbench"]);

    const head = await headCommit(repo);
    const denied = await loops.hook(info.loop, "PreToolUse", {
      tool_name: "Bash",
      tool_input: { command: "git add -A && git commit -m done" },
    });
    expect(JSON.stringify(denied)).toContain('"permissionDecision":"deny"');
    expect(await loops.hook(info.loop, "PreToolUse", { tool_input: { command: "git status" } })).toEqual({});
    writeFileSync(join(repo, "hat.ts"), "export const lift = 0;\n");
    await loops.hook(info.loop, "PostToolUse", {
      tool_name: "Write",
      tool_input: { file_path: join(repo, "hat.ts") },
    });

    const first = await loops.hook(info.loop, "Stop", { session_id: "s-1" });
    expect(first.decision).toBe("block");
    expect(String(first.reason)).toContain("1 FAIL wave");
    expect(await loops.hook(info.loop, "Stop", { session_id: "s-1" })).toEqual({});

    for (const line of streamLines()) claude.options.onOutput("stdout", line);
    claude.end(0);
    const done = await loops.done(info.loop);
    expect(done).toMatchObject({ status: "done", session: "s-1", turns: 3, costUsd: 0.0123, stopReason: "success" });
    expect(done.files).toEqual(["hat.ts"]);
    expect(done.startHead).toBe(head);
    expect(done.endHead).toBe(head);
    expect(done.gate.refusals).toBe(1);
    // The Stop gate gave the last verdict: the host runs no gate check of its own after the end.
    expect(done.endCheck).toBeNull();
    expect(done.review).toEqual({ run: "review-1", status: "passed", outDir: `${repo}/out` });
    expect(runs.calls.map((call) => call.command)).toEqual(["motion", "motion", "review"]);
    expect(runs.calls[2]?.args).toEqual(["greet", "--ref", head]);
    expect(existsSync(done.record!)).toBe(true);
    expect(done.record!.startsWith(state)).toBe(true);
    expect(ended).toHaveLength(1);
    const lines = events.filter((event) => event.type === "loops.progress").map((event) => event.line);
    expect(lines).toContain("refused: git add -A && git commit -m done");
    expect(lines.at(-1)).toContain("no commit by the run");
    expect(loops.list()[0]?.lines?.length).toBeGreaterThan(3);
  });

  test("the wall-clock limit stops the run (SIGINT, then SIGTERM)", async () => {
    const { loops, processes } = await setup(0, { minuteMs: 60 });
    const info = loops.start({ prompt: "long", budgetUsd: 1, maxTurns: 10, minutes: 1 });
    const done = await loops.done(info.loop);
    expect(done.status).toBe("timeout");
    expect(done.stopReason).toBe("timeout");
    expect(processes[0]?.signals).toEqual(["SIGINT", "SIGTERM"]);
    expect(done.review).toBeNull();
  });

  test("a run that ends at its turn limit gets the gate check of the host; the review pack follows", async () => {
    // The CLI calls no Stop hook at the turn limit. Without the gate check of the host, the run has no gate verdict.
    const { state, loops, processes, runs, events } = await setup(1);
    const info = loops.start({ prompt: "fix", take: "greet", budgetUsd: 1, maxTurns: 2, minutes: 30 });
    await until(() => processes.length === 1);
    const claude = processes[0]!;
    const end = { type: "result", subtype: "error_max_turns", is_error: true, num_turns: 3, session_id: "s-2" };
    claude.options.onOutput("stdout", `${JSON.stringify(end)}\n`);
    claude.end(1);
    const done = await loops.done(info.loop);
    expect(done).toMatchObject({ status: "failed", stopReason: "error_max_turns" });
    expect(done.endCheck).toMatchObject({ end: "ended at the turn limit", pass: false, summary: "1 FAIL wave" });
    expect(runs.calls.map((call) => [call.command, call.args[0]])).toEqual([
      ["motion", "greet"],
      ["review", "greet"],
    ]);
    expect(done.review?.status).toBe("passed");
    const record = JSON.parse(readFileSync(done.record!, "utf8")) as Pick<LoopInfo, "endCheck">;
    expect(record.endCheck?.pass).toBe(false);
    expect(done.record!.startsWith(state)).toBe(true);
    const lines = events.filter((event) => event.type === "loops.progress").map((event) => event.line);
    expect(lines).toContain("ended at the turn limit; gate: fail: 1 FAIL wave");
  });

  test("a run with a take that ends at the time limit gets the gate check; a run without a take does not", async () => {
    const { loops, runs } = await setup(0, { minuteMs: 60 });
    const info = loops.start({ prompt: "long", take: "greet", budgetUsd: 1, maxTurns: 10, minutes: 1 });
    const done = await loops.done(info.loop);
    expect(done.status).toBe("timeout");
    expect(done.endCheck).toMatchObject({ end: "ended at the time limit", pass: true, summary: "9 pass" });
    const plain = loops.start({ prompt: "long", budgetUsd: 1, maxTurns: 10, minutes: 1 });
    expect((await loops.done(plain.loop)).endCheck).toBeNull();
    expect(runs.calls.filter((call) => call.command === "motion")).toHaveLength(1);
  });

  test("the owner stops a run", async () => {
    const { loops, processes } = await setup(0);
    const info = loops.start({ prompt: "x", take: "greet", budgetUsd: 1, maxTurns: 10, minutes: 30 });
    await until(() => processes.length === 1);
    await loops.stop(info.loop);
    const done = await loops.done(info.loop);
    expect(done.status).toBe("stopped");
    expect(done.review).toBeNull();
    expect(done.endCheck).toBeNull();
  });

  test("a run in a new worktree installs the packages and makes the generated files first", async () => {
    // A new worktree without `bun run generate` has no token CSS, and its lab does not load.
    const { repo, loops, processes } = await setup(0);
    const info = loops.start({ prompt: "x", budgetUsd: 1, maxTurns: 10, minutes: 30, worktree: true });
    await until(() => processes.length === 1);
    expect(processes[0]?.argv.slice(1)).toEqual(["install", "--frozen-lockfile"]);
    processes[0]?.end(0);
    await until(() => processes.length === 2);
    expect(processes[1]?.argv.slice(1)).toEqual(["run", "generate"]);
    expect(processes[1]?.options.cwd).toBe(processes[0]?.options.cwd);
    expect(processes[1]?.options.cwd).not.toBe(repo);
    processes[1]?.end(0);
    await until(() => processes.length === 3);
    expect(processes[2]?.argv[0]).toBe("/fake/claude");
    expect(processes[2]?.options.cwd).not.toBe(repo);
    await loops.stop(info.loop);
    expect((await loops.done(info.loop)).status).toBe("stopped");
  });

  test(
    "a real process group ends at the wall-clock limit; its environment has no API key",
    async () => {
      const { parent, repo } = await makeRepo();
      const state = tempDir("loop-real");
      made.push(parent, state);
      const script = join(state, "fake-claude.ts");
      writeFileSync(
        script,
        [
          "const key = process.env.ANTHROPIC_API_KEY === undefined ? 'none' : 'set';",
          "console.log(JSON.stringify({ type: 'system', subtype: 'init', session_id: 'real', model: 'm' }));",
          "console.log(JSON.stringify({ type: 'assistant', message: { content: [{ type: 'text', text: 'key ' + key }] } }));",
          "setInterval(() => undefined, 1000);",
        ].join("\n"),
      );
      const events: HostEvent[] = [];
      const loops = new LoopManager({
        stateDir: state,
        endpoint: ENDPOINT,
        repo,
        current: () => repo,
        emit: (event) => events.push(event),
        runs: fakeRuns(0),
        spawn: (argv, options) => spawnRun([process.execPath, script, ...argv.slice(1)], options),
        claude: () => "claude",
        env: { ...process.env, ANTHROPIC_API_KEY: "sk-test" },
        minuteMs: 1500,
        graceMs: 200,
      });
      const info = loops.start({ prompt: "x", budgetUsd: 0.1, maxTurns: 1, minutes: 1 });
      const done = await loops.done(info.loop);
      expect(done.status).toBe("timeout");
      expect(done.session).toBe("real");
      const lines = events.filter((event) => event.type === "loops.progress").map((event) => event.line);
      expect(lines).toContain("Claude: key none");
    },
    ciWaitMs(15_000),
  );
});

describe("the generated files of a run", () => {
  test("they go to the state folder with mode 600", () => {
    const state = tempDir("loop-files");
    made.push(state);
    const files = writeLoopFiles(state, ENDPOINT, "bg-9");
    expect(files.dir).toBe(join(state, "claude", "loops", "bg-9"));
    expect(Bun.file(files.settings).size > 0).toBe(true);
    // statSync, not `stat -f %Lp`: GNU stat reads -f as the file system, so the CLI form fails on the Linux runner.
    for (const path of [files.mcpConfig, files.settings]) expect(statSync(path).mode & 0o777).toBe(0o600);
    expect(statSync(files.dir).mode & 0o777).toBe(0o700);
  });
});
