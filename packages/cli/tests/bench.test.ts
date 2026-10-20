// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity bench` with fake measures: the arguments, the budget of a tier and a backend, the budget rows, the load rule
 * and the CPU renderer rule, the verdict and its exit codes, the report, the documents of the page server and the bench
 * page. No browser starts here: a smoke run of the command does the real run.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDocument } from "@scenity/scene";
import {
  benchBudget,
  benchExitCode,
  benchMarkdown,
  benchPageHtml,
  benchTarget,
  benchVerdict,
  BENCH_FORMAT,
  BENCH_PAGE,
  budgetRows,
  judgeRun,
  parseBenchArgs,
  reportName,
  serveBench,
  sourceDocument,
  toMeasure,
  writeBenchReport,
  type BenchMeasure,
  type BenchReport,
  type BenchRun,
  type LoadSample,
} from "../src/bench/index";

const SHOWROOM = join(import.meta.dir, "../../../samples/showroom");
const CHARACTERS = join(import.meta.dir, "../../../samples/characters");
const temp = mkdtempSync(join(tmpdir(), "scenity-bench-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const project = {
  format: "scenity.project/1",
  id: "shop",
  name: "Shop",
  scenes: ["scenes/a.scene.json"],
  quality: {
    budgets: {
      scene: { medium: { drawCalls: 50, triangles: 600_000, workP95Ms: 6, gpuP95Ms: 10, textures: 20 } },
      "scene.webgpu": { medium: { workP95Ms: 4 } },
    },
  },
} as ProjectDocument;

/** A fake measure of a GPU renderer: inside the medium budget. */
function measure(change: Partial<BenchMeasure> = {}): BenchMeasure {
  return {
    drawn: "webgl",
    renderer: "worker",
    tier: "medium",
    gpuName: "ANGLE (Apple, ANGLE Metal Renderer: Apple M3 Max)",
    software: false,
    firstFrameMs: 900,
    frames: 360,
    windowFrames: 300,
    statsFrames: 360,
    workP50: 1.5,
    workP95: 3.2,
    intervalP50: 16.7,
    intervalP95: 17.1,
    gpuP95Ms: null,
    drawCalls: 4,
    triangles: 476_004,
    instances: 500,
    entities: 505,
    visibleEntities: 500,
    assetBytes: 2_000_000,
    memory: { geometries: 10, textures: 3, programs: 5, gpuBytes: null, pageHeapMb: 20 },
    fallbacks: [],
    ...change,
  };
}

function load(one: number): LoadSample {
  return { avg: [one, one, one], uptime: `load averages: ${String(one)}` };
}

/** A judged run of a backend at a load. */
function run(m: BenchMeasure | null, loadNow = 2, backend: "webgl" | "webgpu" = "webgl"): BenchRun {
  const status = m === null ? "failed" : "ok";
  const base = {
    backend,
    status,
    note: m === null ? "no first frame" : null,
    measure: m,
    load: { before: load(loadNow), after: load(loadNow) },
  } as const;
  return judgeRun(base, benchBudget(project, "medium", backend), 4);
}

describe("the arguments", () => {
  test("the defaults and each value", () => {
    expect(parseBenchArgs([])).toEqual({
      options: { dir: ".", quick: false, build: false, maxLoad: 4 },
      json: false,
      check: false,
    });
    const parsed = parseBenchArgs([
      "samples/showroom",
      "--scene",
      "scenes/crowd.scene.json",
      "--backend",
      "both",
      "--tier",
      "medium",
      "--quick",
      "--check",
      "--json",
      "--lock",
      "/tmp/x.lock",
      "--max-load",
      "6",
    ]);
    expect(parsed?.options).toMatchObject({
      dir: "samples/showroom",
      scene: "scenes/crowd.scene.json",
      backend: "both",
      tier: "medium",
      quick: true,
      lock: "/tmp/x.lock",
      maxLoad: 6,
    });
    expect(parsed?.check).toBe(true);
    expect(parsed?.json).toBe(true);
  });

  test("a usage error", () => {
    expect(parseBenchArgs(["--backend", "vulkan"])).toBeNull();
    expect(parseBenchArgs(["--tier", "best"])).toBeNull();
    expect(parseBenchArgs(["--max-load", "high"])).toBeNull();
    expect(parseBenchArgs(["a", "b"])).toBeNull();
    expect(parseBenchArgs(["--scene"])).toBeNull();
    expect(parseBenchArgs(["--fast"])).toBeNull();
  });
});

describe("the budgets", () => {
  test("the group scene.<backend> replaces values of the group scene", () => {
    expect(benchBudget(project, "medium", "webgl")).toEqual(project.quality?.budgets?.scene?.medium ?? {});
    expect(benchBudget(project, "medium", "webgpu")?.workP95Ms).toBe(4);
    expect(benchBudget(project, "medium", "webgpu")?.drawCalls).toBe(50);
    expect(benchBudget(project, "high", "webgl")).toBeNull();
  });

  test("each value of the budget gets a row; the bench does not measure textures", () => {
    const budget = benchBudget(project, "medium", "webgl");
    if (budget === null) throw new Error("no budget");
    expect(budgetRows(budget, measure({ triangles: 700_000 }), null)).toEqual([
      { key: "drawCalls", limit: 50, value: 4, result: "pass" },
      { key: "gpuP95Ms", limit: 10, value: null, result: "not measured" },
      { key: "textures", limit: 20, value: null, result: "not measured" },
      { key: "triangles", limit: 600_000, value: 700_000, result: "over" },
      { key: "workP95Ms", limit: 6, value: 3.2, result: "pass" },
    ]);
  });
});

describe("the verdict and the load rule", () => {
  test("inside the budget at a low load: 0", () => {
    const verdict = benchVerdict([run(measure())], 4);
    expect(verdict).toMatchObject({ code: 0, passed: true, peakLoad: 2, maxLoad: 4, reasons: [] });
  });

  test("a time over its budget at a low load: 1", () => {
    const verdict = benchVerdict([run(measure({ workP95: 7.5 }))], 4);
    expect(verdict.code).toBe(1);
    expect(verdict.reasons).toEqual(["webgl: workP95Ms 7.5 > 6"]);
  });

  test("the budget of the backend: 5 ms passes on WebGL and fails on WebGPU", () => {
    expect(benchVerdict([run(measure({ workP95: 5 }))], 4).code).toBe(0);
    const gpu = run(measure({ workP95: 5, drawn: "webgpu" }), 2, "webgpu");
    expect(benchVerdict([gpu], 4).reasons).toEqual(["webgpu: workP95Ms 5 > 4"]);
  });

  test("a load over the limit: the times are not judged, 3, and the note says why", () => {
    const busy = run(measure({ workP95: 9 }), 9.5);
    expect(busy.rows.find((row) => row.key === "workP95Ms")?.result).toBe("not judged");
    expect(busy.note).toContain("the load 9.50 is over 4");
    const verdict = benchVerdict([busy], 4);
    expect(verdict.code).toBe(3);
    expect(verdict.peakLoad).toBe(9.5);
    expect(verdict.reasons[0]).toContain("workP95Ms not judged");
  });

  test("a count over its budget at a high load: 1, the count does not change with the load", () => {
    const verdict = benchVerdict([run(measure({ drawCalls: 80 }), 9.5)], 4);
    expect(verdict.code).toBe(1);
    expect(verdict.reasons[0]).toBe("webgl: drawCalls 80 > 50");
  });

  test("a CPU renderer: the times are not judged", () => {
    const cpu = run(measure({ software: true, gpuName: "ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device))" }));
    expect(cpu.note).toContain("draws on the CPU");
    expect(benchVerdict([cpu], 4).code).toBe(3);
  });

  test("a failed run: 1, also with no --check", () => {
    const failed = run(null);
    const report = { runs: [failed], verdict: benchVerdict([failed], 4) };
    expect(report.verdict.code).toBe(1);
    expect(benchExitCode(report, false)).toBe(1);
  });

  test("with no --check the verdict does not set the exit code", () => {
    const busy = run(measure(), 9.5);
    const report = { runs: [busy], verdict: benchVerdict([busy], 4) };
    expect(benchExitCode(report, false)).toBe(0);
    expect(benchExitCode(report, true)).toBe(3);
  });

  test("a backend that the browser does not give is n/a; with a budget it is not judged", () => {
    const other = judgeRun(
      {
        backend: "webgpu",
        status: "n/a",
        note: "the player drew with webgl",
        measure: measure(),
        load: { before: load(1), after: load(1) },
      },
      benchBudget(project, "medium", "webgpu"),
      4,
    );
    expect(other.rows).toEqual([]);
    expect(benchVerdict([other], 4).code).toBe(3);
  });
});

describe("the measure of the page", () => {
  test("the window frames, the statistics frames and the CPU renderer", () => {
    const first = { frames: 100 };
    const last = {
      frames: 700,
      workP50: 1.234,
      workP95: 3.456,
      drawCalls: 4,
      triangles: 476_004,
      backend: "webgl",
      renderer: "worker",
      gpu: null,
      fallbacks: [{ from: { backend: "webgpu" }, to: { backend: "webgl" }, reason: "no adapter" }],
    };
    const result = toMeasure(first, last, 812.6, { gpuName: "SwiftShader Device", pageHeapMb: 12.5 }, 100);
    expect(result).toMatchObject({
      windowFrames: 600,
      statsFrames: 600,
      workP50: 1.23,
      workP95: 3.46,
      firstFrameMs: 813,
      software: true,
      gpuP95Ms: null,
      instances: null,
      fallbacks: ["webgpu -> webgl: no adapter"],
    });
  });
});

describe("the report", () => {
  const runs = [run(measure()), run(measure({ workP95: 8 }), 6, "webgpu")];
  const report: BenchReport = {
    format: BENCH_FORMAT,
    project: "shop",
    scene: "scenes/crowd.scene.json",
    sequence: null,
    tier: "medium",
    quick: true,
    date: "2026-10-16T00:00:00.000Z",
    machine: { system: "darwin 25.0.0", cpu: "Apple M3 Max", cores: 16, memoryGb: 64 },
    build: { dir: "samples/showroom/dist", made: false },
    window: { warmupMs: 1000, windowMs: 5000 },
    runs,
    verdict: benchVerdict(runs, 4),
  };

  test("the Markdown table has a row per run, the budget rows and the verdict", () => {
    const text = benchMarkdown(report);
    expect(text).toContain("### shop: scenes/crowd.scene.json");
    expect(text).toContain(
      "| webgl | webgl worker | 900.00 | 1.50 | 3.20 | n/a | 17.10 | 4 | 476004 | 500 | 1.9 | 20.0 | 2.00 / 2.00 | pass |",
    );
    expect(text).toContain("| webgpu | workP95Ms | 8.00 | 4 | not judged |");
    expect(text).toContain("- Budgets: not judged (load 6.00, limit 4).");
  });

  test("the files of the report folder", () => {
    const out = join(temp, "report");
    writeBenchReport(report, out);
    expect(JSON.parse(readFileSync(join(out, "bench.json"), "utf8"))).toEqual(report);
    expect(readFileSync(join(out, "bench.md"), "utf8")).toBe(benchMarkdown(report));
  });
});

describe("the target of a run", () => {
  test("the first scene of a project, a scene and the scene of a sequence", () => {
    const read = (dir: string) =>
      JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as ProjectDocument;
    expect(benchTarget(SHOWROOM, read(SHOWROOM), {})).toEqual({ scene: "scenes/main.scene.json", sequence: null });
    expect(benchTarget(SHOWROOM, read(SHOWROOM), { scene: "scenes/crowd.scene.json" }).scene).toBe(
      "scenes/crowd.scene.json",
    );
    const walk = benchTarget(CHARACTERS, read(CHARACTERS), { sequence: "sequences/walk-wave.sequence.json" });
    expect(walk).toEqual({ scene: "scenes/main.scene.json", sequence: "sequences/walk-wave.sequence.json" });
    expect(reportName(walk, "high")).toBe("walk-wave-high");
    expect(() => benchTarget(SHOWROOM, read(SHOWROOM), { scene: "scenes/none.scene.json" })).toThrow(
      "is not a file of the project folder",
    );
  });
});

describe("the page server", () => {
  test("the scene documents come from the project folder in canonical form", () => {
    const crowd = sourceDocument(SHOWROOM, "scenes/crowd.scene.json");
    expect(crowd !== null && "text" in crowd && crowd.text.includes('"id": "crowd"')).toBe(true);
    expect(sourceDocument(SHOWROOM, "scenity.project.json")).toBeNull();
    expect(sourceDocument(SHOWROOM, "../showroom/scenes/none.scene.json")).toBeNull();
  });

  test("the bench page, the build files, the asset bytes and no path out of the build", async () => {
    const out = join(temp, "dist");
    mkdirSync(join(out, "project", "build"), { recursive: true });
    mkdirSync(join(out, "player"), { recursive: true });
    writeFileSync(join(out, "player", "element.js"), "export {};");
    writeFileSync(join(out, "project", "build", "a.glb"), new Uint8Array(1000));
    const server = serveBench(out, SHOWROOM, {
      scene: "scenes/crowd.scene.json",
      sequence: null,
      backend: "webgpu",
      tier: "medium",
    });
    try {
      const page = await (await fetch(server.origin + BENCH_PAGE)).text();
      expect(page).toBe(
        benchPageHtml({ scene: "scenes/crowd.scene.json", sequence: null, backend: "webgpu", tier: "medium" }),
      );
      expect(page).toContain('scene="scenes/crowd.scene.json" sequence="none" backend="webgpu" tier="medium"');
      expect(page).toContain('adaptive="false"');
      const scene = await fetch(`${server.origin}/project/scenes/crowd.scene.json`);
      expect(scene.headers.get("Content-Type")).toContain("json");
      expect((await scene.text()).includes('"id": "crowd"')).toBe(true);
      expect((await fetch(`${server.origin}/project/build/a.glb`)).status).toBe(200);
      expect(server.assetBytes()).toBe(1000);
      expect((await fetch(`${server.origin}/player/element.js`)).status).toBe(200);
      expect(server.assetBytes()).toBe(1000);
      expect((await fetch(`${server.origin}/%2e%2e/%2e%2e/package.json`)).status).toBe(404);
      server.resetBytes();
      expect(server.assetBytes()).toBe(0);
    } finally {
      server.stop();
    }
  });
});
