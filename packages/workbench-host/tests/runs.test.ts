// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the runs:
 * - the check of the arguments, and the flags that the host adds;
 * - a run with an injected process (output, summary, output folder, images);
 * - one WebGL run at a time per checkout, and the cancel (SIGINT, then SIGTERM);
 * - the file route, the real spawner, and the requests through a host.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { startHost } from "../src/host";
import { isEventOf, type HostEvent, type RunInfo } from "../src/protocol";
import { planRun, summarize, WEB_DIR } from "../src/runArgs";
import { RunManager, runFilesHttp, spawnRun, type RunExit, type RunSpawner, type SpawnOptions } from "../src/runs";
import { cleanup, fakeCommand, FakePage, makeRepo, rejectsWith, tempDir, until } from "./helpers";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const dir = tempDir("runs");
const checkout = join(dir, "checkout");
mkdirSync(join(checkout, WEB_DIR), { recursive: true });
const made: string[] = [dir];
afterAll(() => cleanup(...made));

/** A fake process: the test sends output and ends it; signals go to a list and SIGTERM ends it. */
interface FakeRun {
  readonly argv: readonly string[];
  readonly options: SpawnOptions;
  readonly signals: string[];
  end(code: number | null): void;
}

function fakeSpawner(): { spawn: RunSpawner; runs: FakeRun[] } {
  const runs: FakeRun[] = [];
  const spawn: RunSpawner = (argv, options) => {
    let end: (exit: RunExit) => void = () => undefined;
    const exited = new Promise<RunExit>((resolve) => (end = resolve));
    const signals: string[] = [];
    runs.push({ argv, options, signals, end: (code) => end({ code, signal: null }) });
    return {
      exited,
      signal(signal) {
        signals.push(signal);
        if (signal !== "SIGINT") end({ code: null, signal });
      },
    };
  };
  return { spawn, runs };
}

describe("the arguments", () => {
  const plan = (command: string, args: unknown[], confirm = false) =>
    planRun(checkout, command, args, { runId: "r1", confirm, ref: "abc123", bun: "bun" });

  test("only commands of the allowlist run, as an argument list from the repo root", () => {
    expect(() => plan("rm", ["-rf"])).toThrow("not a run of the project");
    expect(() => plan("parity", [])).toThrow("not a run of the project");
    const motion = plan("motion", ["greet"]);
    expect(motion.cwd).toBe(join(checkout, WEB_DIR));
    expect(motion.argv.slice(0, 5)).toEqual(["bun", "run", "labs", "motion", "greet"]);
    expect(motion.gpu).toBe(true);
  });

  test("shell characters and paths outside the checkout are refused", () => {
    for (const bad of ["greet; rm -rf /", "a|b", "a&b", "$(id)", "`id`", "a\nb", "a>b"]) {
      expect(() => plan("motion", [bad])).toThrow();
    }
    expect(() => plan("shot", ["--out", "/tmp/elsewhere"])).toThrow("not in the checkout");
    expect(() => plan("shot", ["--out=../../.."])).toThrow("not in the checkout");
    expect(() => plan("shot", ["--out", "~/x"])).toThrow('without "~"');
    expect(() => plan("motion", [1])).toThrow("must be a text");
    expect(plan("shot", ["--out", "apps/editor/test-results/mine"]).outDir).toBe(
      join(checkout, WEB_DIR, "apps/editor/test-results/mine"),
    );
    expect(plan("verify", ["--url", "http://127.0.0.1:5173"]).args).toEqual(["--url", "http://127.0.0.1:5173"]);
  });

  test("the host adds --dry, --ref and --out", () => {
    expect(plan("asset", ["lamp_pole"]).args).toEqual(["lamp_pole", "--dry"]);
    expect(plan("promote", []).args).toEqual(["--dry"]);
    expect(plan("promote", [], true).args).toEqual([]);
    const review = plan("review", ["greet"]);
    expect(review.args.slice(0, 3)).toEqual(["greet", "--ref", "abc123"]);
    expect(review.outDir).toBe(join(checkout, WEB_DIR, "apps/editor/test-results/room3d/workbench/review-r1"));
    expect(review.args.slice(-2)).toEqual(["--out", review.outDir ?? ""]);
    expect(plan("review", ["greet", "--ref", "HEAD~2"]).args).toContain("HEAD~2");
    expect(plan("tune-apply", ["wave.hand.y:-0.004", "--dry"]).gpu).toBe(false);
    expect(plan("stills", ["--check"]).gpu).toBe(false);
    expect(plan("verify", []).outDir).toBeNull();
  });

  test("the summary is the last lines without the ANSI codes", () => {
    expect(summarize("$ bun run labs x\na\n\n\u001b[31mFAIL\u001b[0m x\n$ bun y\n", 2)).toBe("a\nFAIL x");
  });

  test("the summary has no wait for the GPU lock (the verdict line of the Stop gate)", () => {
    const output =
      "room3d: waiting for the GPU lock of process 34104 (/tmp/scenity-room3d-gpu.lock)\ntake greet: 9 pass\n";
    expect(summarize(output).split("\n")[0]).toBe("take greet: 9 pass");
  });
});

describe("a run", () => {
  test("the output streams, and the end gives the code, the summary, the folder and its images", async () => {
    const events: HostEvent[] = [];
    const { spawn, runs: started } = fakeSpawner();
    const runs = new RunManager({ emit: (event) => events.push(event), spawn });
    const seen: string[] = [];
    const { run, done } = runs.start(checkout, "sheet", ["--take", "greet"], {
      onOutput: (_, text) => seen.push(text),
    });
    const fake = started[0]!;
    expect(fake.options.env.NO_COLOR).toBe("1");
    const outDir = runs.info(run)?.outDir ?? "";
    mkdirSync(join(outDir, "frames"), { recursive: true });
    writeFileSync(join(outDir, "sheet.png"), "png");
    writeFileSync(join(outDir, "frames", "a.webp"), "webp");
    writeFileSync(join(outDir, "shots.json"), "{}");
    fake.options.onOutput("stdout", "room3d: rendering\n");
    fake.options.onOutput("stdout", "apps/editor/test-results/sheet.png  17 times\n");
    fake.end(0);
    const result = await done;
    expect(result.status).toBe("passed");
    expect(result.code).toBe(0);
    expect(result.summary).toBe("room3d: rendering\napps/editor/test-results/sheet.png  17 times");
    expect(result.images).toEqual([join(outDir, "frames", "a.webp"), join(outDir, "sheet.png")]);
    expect(seen[0]).toStartWith("$ bun run labs sheet --take greet --out ");
    // The chunks of 16 ms go as one event, before `runs.done`.
    const output = events.filter((event) => isEventOf(event, "runs.output"));
    expect(output).toHaveLength(1);
    expect(output.map((event) => (isEventOf(event, "runs.output") ? event.data : "")).join("")).toEndWith(
      "room3d: rendering\napps/editor/test-results/sheet.png  17 times\n",
    );
    expect(events.findIndex((event) => isEventOf(event, "runs.done"))).toBeGreaterThan(events.indexOf(output[0]!));
    const end = events.find((event) => isEventOf(event, "runs.done"));
    expect(end).toMatchObject({ run, code: 0, outDir, images: result.images });
    expect(runs.list()[0]?.output).toContain("17 times");
  });

  test("one WebGL run at a time per checkout; a run without WebGL and another checkout can start", async () => {
    const { spawn, runs: started } = fakeSpawner();
    const runs = new RunManager({ emit: () => undefined, spawn });
    runs.start(checkout, "motion", ["greet"]);
    expect(() => runs.start(checkout, "sheet", [])).toThrow("A WebGL run is running in this checkout: motion");
    const check = runs.start(checkout, "stills", ["--check"]);
    const other = join(dir, "other");
    mkdirSync(join(other, WEB_DIR), { recursive: true });
    runs.start(other, "shot", []);
    expect(runs.running(checkout)?.command).toBe("motion");
    started[0]!.end(1);
    started[1]!.end(0);
    expect((await check.done).status).toBe("passed");
    await until(() => runs.running(checkout) === null);
    expect(runs.list().find((info) => info.command === "motion")?.status).toBe("failed");
    expect(() => runs.start(checkout, "sheet", [])).not.toThrow();
  });

  test("a cancel sends SIGINT, then SIGTERM after the grace time", async () => {
    const { spawn, runs: started } = fakeSpawner();
    const runs = new RunManager({ emit: () => undefined, spawn, graceMs: 30 });
    const { run, done } = runs.start(checkout, "verify", ["--visual"]);
    await runs.cancel(run);
    expect(started[0]!.signals).toEqual(["SIGINT", "SIGTERM"]);
    expect((await done).status).toBe("cancelled");
    await rejectsWith(runs.cancel("nope"), "No run");
  });
});

describe("the files of a run", () => {
  test("only files under the output folder of a run are served", async () => {
    const { spawn, runs: started } = fakeSpawner();
    const runs = new RunManager({ emit: () => undefined, spawn });
    const { run, done } = runs.start(checkout, "shot", []);
    const outDir = runs.info(run)?.outDir ?? "";
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "a.png"), "png bytes");
    writeFileSync(join(dir, "secret.txt"), "secret");
    symlinkSync(join(dir, "secret.txt"), join(outDir, "link.txt"));
    started[0]!.end(0);
    await done;
    expect(runs.fileOf(run, "a.png")).toBe(join(outDir, "a.png"));
    expect(runs.fileOf(run, join(outDir, "a.png"))).toBe(join(outDir, "a.png"));
    expect(runs.fileOf(run, "../../secret.txt")).toBeNull();
    expect(runs.fileOf(run, "link.txt")).toBeNull();
    expect(runs.fileOf("nope", "a.png")).toBeNull();
    const http = runFilesHttp(runs);
    const url = (path: string) => new URL(`http://127.0.0.1/runs/${run}/file?path=${encodeURIComponent(path)}`);
    const ok = http(new Request(url("a.png")), url("a.png"));
    expect(ok?.status).toBe(200);
    expect(ok?.headers.get("content-type")).toBe("image/png");
    expect(await ok?.text()).toBe("png bytes");
    expect(http(new Request(url("link.txt")), url("link.txt"))?.status).toBe(404);
    expect(http(new Request("http://127.0.0.1/other"), new URL("http://127.0.0.1/other"))).toBeNull();
  });
});

describe("the real spawner", () => {
  test("it gives the output and the exit code; a signal ends the process group", async () => {
    const out: string[] = [];
    const options = {
      cwd: dir,
      env: { PATH: process.env.PATH ?? "" },
      onOutput: (_: string, text: string) => out.push(text),
    };
    const quick = spawnRun(
      [process.execPath, "-e", "console.log('hi'); console.error('err'); process.exit(3)"],
      options,
    );
    expect(await quick.exited).toEqual({ code: 3, signal: null });
    expect(out.join("")).toContain("hi");
    const slow = spawnRun([process.execPath, "-e", "setTimeout(() => {}, 60000)"], options);
    await Bun.sleep(100);
    slow.signal("SIGTERM");
    expect((await slow.exited).signal).toBe("SIGTERM");
  });
});

describe("the requests through a host", () => {
  test("runs.start, runs.list, runs.cancel, the file route and git.status", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("runs-state");
    made.push(parent, state);
    const { spawn, runs: started } = fakeSpawner();
    const token = "33".repeat(32);
    const host = await startHost({
      checkout: repo,
      stateDir: state,
      token,
      serverCommand: fakeCommand,
      watch: false,
      runSpawn: spawn,
    });
    const page = await FakePage.open(host.endpoint);
    try {
      const { run } = (await page.call("runs.start", { command: "review", args: ["greet"] })) as { run: string };
      await until(() => host.turns.start(repo) !== null);
      const info = host.runs.info(run)!;
      expect(info.args).toContain("--out");
      const outDir = info.outDir ?? "";
      mkdirSync(outDir, { recursive: true });
      writeFileSync(join(outDir, "REVIEW.md"), "# Review\n");
      started[0]!.options.onOutput("stdout", "REVIEW.md written\n");
      started[0]!.end(0);
      const done = await page.waitEvent((event) => isEventOf(event, "runs.done"));
      expect(done).toMatchObject({ run, code: 0, outDir });
      const list = (await page.call("runs.list")) as RunInfo[];
      expect(list[0]?.output).toContain("REVIEW.md written");
      const fetchFile = (path: string, withToken = true) =>
        fetch(`${host.endpoint.origin}/runs/${run}/file?path=${encodeURIComponent(path)}`, {
          headers: withToken ? { "x-workbench-token": token } : {},
        });
      expect(await (await fetchFile("REVIEW.md")).text()).toBe("# Review\n");
      expect((await fetchFile("REVIEW.md", false)).status).toBe(401);
      expect((await fetchFile("/etc/hosts")).status).toBe(404);
      const answer = await page.request("runs.start", { command: "shot", args: ["--take", "x;y"] });
      expect(answer.ok).toBe(false);
      const status = (await page.call("git.status")) as { branch: string };
      expect(status.branch).toBe("main");
    } finally {
      page.close();
      await host.stop();
    }
  });
});
