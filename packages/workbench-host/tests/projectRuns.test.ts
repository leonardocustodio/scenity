// SPDX-License-Identifier: Apache-2.0
/**
 * The runs of a project come from its manifest and its host plugins.
 *
 * - The run list of the built-in plugins (the lab) equals the recorded list (`fixtures/labRuns.json`, from
 *   `RUN_COMMANDS` and `planRun`): the IDs, the command lines, the gate, the runs of the agent and the plan of each
 *   run (program, arguments, folder, output folder, GPU use).
 * - The showroom host has its manifest run `check` and the stop gate `scenity check`.
 * - A background run on a temporary copy of the showroom, with a fake claude and the real run of `scenity check` as
 *   its stop gate: the gate refuses "done" while the lantern is off the table, and lets the run end when it is back.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { cpSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { startHost } from "../src/host";
import { LoopManager } from "../src/loops";
import { projectInfo, loadHostProject } from "../src/project";
import type { ProjectRun, RequestResult } from "../src/protocol";
import { planRun } from "../src/runArgs";
import { agentRuns, builtInRunCatalog, projectRunCatalog, runCatalog, type RunCatalog } from "../src/runCatalog";
import { RunManager, type RunExit, type RunSpawner, type SpawnOptions } from "../src/runs";
import { toolListings } from "../src/tools/index";
import { scaleTestTimeouts } from "./ciTiming";
import { cleanup, fakeCommand, FakePage, makeRepo, tempDir, until } from "./helpers";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const SHOWROOM = resolve(import.meta.dir, "../../../samples/showroom");
const made: string[] = [];
afterAll(() => cleanup(...made));

/** The recorded run list of the lab, and the plan of each run for some argument lists. */
interface RunFixture {
  readonly commands: readonly string[];
  readonly agent: readonly string[];
  readonly lines: Readonly<Record<string, string>>;
  readonly gate: string;
  readonly plans: readonly {
    readonly command: string;
    readonly args: readonly string[];
    readonly confirm: boolean;
    readonly ref: string | null;
    readonly plan: Record<string, unknown>;
  }[];
}

const BEFORE = JSON.parse(readFileSync(join(import.meta.dir, "fixtures", "labRuns.json"), "utf8")) as RunFixture;

describe("the runs of the lab equal the recorded runs", () => {
  const catalog = builtInRunCatalog();

  test("the IDs, the command lines, the gate and the runs of the agent", () => {
    expect(catalog.runs.map((run) => run.id)).toEqual([...BEFORE.commands]);
    expect(Object.fromEntries(catalog.runs.map((run) => [run.id, run.command]))).toEqual(BEFORE.lines);
    expect(catalog.gate?.command).toBe(BEFORE.gate);
    expect(catalog.gate?.id).toBe("motion");
    expect(agentRuns(catalog).map((run) => run.id)).toEqual([...BEFORE.agent]);
  });

  test("the plan of each run: program, arguments, folder, output folder and GPU use", () => {
    for (const item of BEFORE.plans) {
      const options = { runId: "R", bun: "bun", confirm: item.confirm, ref: item.ref, catalog };
      const { argv, args, cwd, outDir, gpu } = planRun("/repo", item.command, item.args, options);
      const plan: Record<string, unknown> = { argv, args, cwd, outDir, gpu };
      expect({ command: item.command, args: item.args, plan }).toEqual({
        command: item.command,
        args: item.args,
        plan: item.plan,
      });
    }
  });
});

describe("the runs of a manifest", () => {
  test("the showroom has its manifest run and the stop gate `scenity check`", async () => {
    const project = await loadHostProject(SHOWROOM);
    expect(project.runCatalog.runs.map((run) => [run.id, run.command, run.kind])).toEqual([
      ["check", "scenity check", "check"],
    ]);
    expect(project.runCatalog.gate?.id).toBe("check");
    expect(projectInfo(project).gate).toBe("scenity check");
    const plan = planRun(SHOWROOM, "check", [], { runId: "R", bun: "bun", catalog: project.runCatalog });
    expect(plan.argv[0]).toBe("bun");
    expect(plan.argv[1]?.endsWith(join("packages", "cli", "src", "cli.ts"))).toBe(true);
    expect(plan.argv.slice(2)).toEqual(["check"]);
    expect(plan).toMatchObject({ cwd: SHOWROOM, outDir: null, gpu: false });
  });

  test("a manifest run replaces a plugin run; a project with no gate gets `scenity check`", () => {
    const plugin = {
      id: "p",
      tools: [],
      contextLines: {},
      paths: {},
      runs: { commands: { lint: "bun run lint", check: "bun run old" }, gate: "lint" },
    };
    const both = projectRunCatalog([plugin], { runs: { check: "scenity check" } }, true);
    expect(both.runs.map((run) => [run.id, run.command])).toEqual([
      ["lint", "bun run lint"],
      ["check", "scenity check"],
    ]);
    expect(both.gate?.id).toBe("lint");
    const none = projectRunCatalog([], {}, true);
    expect(none.gate).toMatchObject({ id: "gate", command: "scenity check", kind: "check" });
    expect(none.gate?.sequence).toEqual({ flag: "--sequence", required: false });
    expect(projectRunCatalog([], undefined, false).gate).toBeNull();
  });

  test("the showroom host gives its runs, its gate and `workbench_run` for them", async () => {
    const parent = tempDir("runs-showroom");
    const state = tempDir("runs-state");
    made.push(parent, state);
    const dir = join(parent, "showroom");
    cpSync(SHOWROOM, dir, { recursive: true });
    const host = await startHost({ checkout: dir, stateDir: state, serverCommand: fakeCommand, watch: false });
    const page = await FakePage.open(host.endpoint);
    try {
      const hello = (await page.call("host.hello")) as RequestResult<"host.hello">;
      expect(hello.project?.runs).toEqual({ check: "scenity check" });
      expect(hello.project?.gate).toBe("scenity check");
      const commands = (await page.call("runs.commands")) as RequestResult<"runs.commands">;
      expect(commands.gate).toBe("check");
      expect(commands.runs.map((run: ProjectRun) => run.id)).toEqual(["check"]);
      const tool = toolListings().find((listing) => listing.name === "workbench_run");
      expect(JSON.stringify(tool?.inputSchema)).toContain('"enum":["check"]');
    } finally {
      page.close();
      await host.stop();
    }
  });
});

/** A fake `claude`: the test ends it. */
function fakeClaude(): { spawn: RunSpawner; processes: { options: SpawnOptions; end(code: number): void }[] } {
  const processes: { options: SpawnOptions; end(code: number): void }[] = [];
  const spawn: RunSpawner = (_argv, options) => {
    let end: (exit: RunExit) => void = () => undefined;
    const exited = new Promise<RunExit>((done) => (end = done));
    processes.push({ options, end: (code) => end({ code, signal: null }) });
    return { exited, signal: (signal) => end({ code: null, signal }) };
  };
  return { spawn, processes };
}

/** The scene file of the copy: a write of the lantern place, and a write of the file as it was. */
function lantern(dir: string): { move(position: number[]): void; restore(): void } {
  const file = join(dir, "scenes", "main.scene.json");
  const text = readFileSync(file, "utf8");
  return {
    move(position) {
      const doc = JSON.parse(text) as { entities: Record<string, { components: { transform: object } }> };
      const entity = doc.entities.lantern;
      if (entity === undefined) throw new Error("the showroom has no lantern");
      entity.components.transform = { ...entity.components.transform, position };
      writeFileSync(file, `${JSON.stringify(doc, null, 2)}\n`);
    },
    restore: () => writeFileSync(file, text),
  };
}

describe("a loop on the showroom with `scenity check` as its stop gate", () => {
  test("the gate refuses done while the lantern is off the table, and passes when it is back", async () => {
    const { parent, repo } = await makeRepo();
    const state = tempDir("loop-showroom");
    made.push(parent, state);
    cpSync(SHOWROOM, repo, { recursive: true });
    const project = await loadHostProject(repo);
    const catalog: RunCatalog = project.runCatalog;
    // The real runs of the host: `scenity check` runs in the copy.
    const runs = new RunManager({ emit: () => undefined, catalog: () => catalog, outputBatchMs: 0 });
    const { spawn, processes } = fakeClaude();
    const loops = new LoopManager({
      stateDir: state,
      endpoint: { origin: "http://127.0.0.1:4999", token: "a".repeat(64) },
      repo,
      current: () => repo,
      emit: () => undefined,
      runs,
      catalog: () => catalog,
      spawn,
      claude: () => "/fake/claude",
      env: { PATH: process.env.PATH ?? "", HOME: "/home/x" },
      graceMs: 20,
    });
    const info = loops.start({ prompt: "keep the lantern on the table", budgetUsd: 1, maxTurns: 10, minutes: 30 });
    await until(() => processes.length === 1, 30_000, "the fake claude");
    const scene = lantern(repo);
    scene.move([1.5, 0.8, 0]);
    // One iteration of the fake agent ends: the gate run fails, so Claude continues.
    const refused = await loops.hook(info.loop, "Stop", { session_id: "s-1" });
    expect(refused.decision).toBe("block");
    expect(String(refused.reason)).toContain("scenity check");
    expect(String(refused.reason)).toContain("showroom.lanternOnTable");
    // The agent puts the lantern back: the gate passes, so the run may end.
    scene.restore();
    expect(await loops.hook(info.loop, "Stop", { session_id: "s-1" })).toEqual({});
    const end = { type: "result", subtype: "success", is_error: false, num_turns: 2, session_id: "s-1", result: "ok" };
    processes[0]?.options.onOutput("stdout", `${JSON.stringify(end)}\n`);
    processes[0]?.end(0);
    const done = await loops.done(info.loop);
    expect(done).toMatchObject({ status: "done", sequence: null, endCheck: null, review: null });
    expect(done.gate.refusals).toBe(1);
    expect(done.gate.last).toStartWith("pass:");
    expect(runs.list().map((run) => [run.command, run.status])).toEqual([
      ["check", "passed"],
      ["check", "failed"],
    ]);
  }, 60_000);
});

describe("the catalog of a run table", () => {
  test("a string run gets the defaults; a write run is not for the agent", () => {
    const catalog = runCatalog({ lint: "bun run lint", save: { command: "bun x save", kind: "write" } }, null);
    expect(catalog.runs[0]).toMatchObject({ id: "lint", label: "lint", kind: "tool", gpu: false, agent: true });
    expect(catalog.runs[1]).toMatchObject({ id: "save", agent: false });
    expect(catalog.gate).toBeNull();
    expect(catalog.outRoot).toBe("test-results/workbench");
  });
});
