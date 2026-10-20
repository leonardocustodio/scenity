// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { brotliCompressSync, gzipSync } from "node:zlib";
import {
  closure,
  findChunk,
  formatReport,
  indexAssets,
  judge,
  KB,
  measureBuild,
  parseEdges,
  parseIndexHtml,
  readExceptions,
  type Budget,
  type EntrySpec,
} from "./size-budget";

let roots: string[] = [];

/** Make a build folder in a temporary folder from a map of paths and texts. */
function build(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "size-budget-"));
  roots.push(root);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
  return root;
}

afterEach(() => {
  roots.forEach((root) => {
    rmSync(root, { recursive: true, force: true });
  });
  roots = [];
});

const INDEX = [
  "<!doctype html><html><head>",
  '<script type="module" crossorigin src="/assets/index-AAAA.js"></script>',
  '<link rel="modulepreload" crossorigin href="/assets/vue-BBBB.js">',
  '<link rel="stylesheet" crossorigin href="/assets/index-CCCC.css">',
  "</head><body></body></html>",
].join("\n");

/**
 * The entry spec of the tests: a worker entry and a core entry with a fallback name. A plugin gives the spec
 * of its own entries (for example plugins/<plugin>/editor/scripts/sizeBudgets.ts).
 */
const SPEC: EntrySpec = {
  budgets: [
    { id: "worker", label: "Render worker", limitBytes: 300 * KB },
    { id: "core", label: "Main-thread core", limitBytes: 300 * KB },
  ],
  groups: (context) => ({
    worker: context.entry("room3dWorker"),
    core: context.entry("room3dCoreGl") ?? context.entry("room3dCore"),
  }),
};

/** A small build: a shell, the 3D render worker, the main-thread core and the page-side 3D chunks. */
function sampleBuild(): string {
  return build({
    "index.html": INDEX,
    "assets/index-AAAA.js":
      'import{a as e}from"./vue-BBBB.js";import"./polyfill-DDDD.js";const r=()=>import("./RoomScene-EEEE.js");',
    "assets/vue-BBBB.js": "export const a=1;",
    "assets/polyfill-DDDD.js": "globalThis.x=1;",
    "assets/RoomScene-EEEE.js":
      'import{a}from"./vue-BBBB.js";import{m}from"./model-HHHH.js";' +
      'const w=new Worker(new URL("room3dWorker-IIII.js",import.meta.url),{type:"module"});' +
      'const c=()=>import("./room3dCoreGl-FFFF.js");',
    "assets/model-HHHH.js": `export const m="${"model ".repeat(200)}";`,
    "assets/room3dWorker-IIII.js": 'import{t}from"./three-GGGG.js";self.onmessage=()=>{};',
    "assets/three-GGGG.js": `export const t="${"three ".repeat(200)}";`,
    "assets/room3dCoreGl-FFFF.js": 'import{c}from"./room3dCore-JJJJ.js";',
    "assets/room3dCore-JJJJ.js": 'import{t}from"./three-GGGG.js";import{m}from"./model-HHHH.js";export const c=1;',
    "assets/index-CCCC.css": "body{margin:0}",
    "assets/index-AAAA.js.map": "{}",
  });
}

describe("parseEdges", () => {
  test("separates static imports, re-exports and side-effect imports from lazy imports and workers", () => {
    const edges = parseEdges(
      "assets/RoomScene-EEEE.js",
      'import{a as b}from"./x.js";import"./y.js";export{c}from"./z.js";const l=()=>import("./lazy.js");' +
        'new Worker(new URL("w.js",import.meta.url));import{q}from"vue";',
    );
    expect(edges.static).toEqual(["assets/x.js", "assets/y.js", "assets/z.js"]);
    expect(edges.lazy).toEqual(["assets/lazy.js", "assets/w.js"]);
  });

  test("reads the file list of __vite__mapDeps as lazy edges", () => {
    const edges = parseEdges(
      "assets/a.js",
      'const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["assets/b.js","assets/c.css"])))=>i.map(i=>d[i]);',
    );
    expect(edges.static).toEqual([]);
    expect(edges.lazy).toEqual(["assets/b.js", "assets/c.css"]);
  });
});

describe("parseIndexHtml and findChunk", () => {
  test("give the entry script, the style sheets and a chunk", () => {
    expect(parseIndexHtml(INDEX)).toEqual({ entry: "assets/index-AAAA.js", css: ["assets/index-CCCC.css"] });
    expect(findChunk(["assets/RoomScene-EEEE.js", "assets/RoomScene-KKKK.css"], "RoomScene")).toBe(
      "assets/RoomScene-EEEE.js",
    );
    expect(findChunk(["assets/RoomView-X.js"], "RoomScene")).toBeNull();
  });
});

describe("closure", () => {
  test("follows static edges, and lazy edges only on request; it names missing files", () => {
    const graph: Record<string, { static: string[]; lazy: string[] }> = {
      a: { static: ["b"], lazy: ["c"] },
      b: { static: ["missing"], lazy: [] },
      c: { static: [], lazy: [] },
    };
    const edgesOf = (path: string) => graph[path] ?? null;
    const plain = closure(["a"], edgesOf);
    expect([...plain.files].sort()).toEqual(["a", "b"]);
    expect([...plain.missing]).toEqual(["missing"]);
    expect([...closure(["a"], edgesOf, true).files].sort()).toEqual(["a", "b", "c"]);
    // A stop file is not in the closure, and the closure does not follow its edges.
    expect([...closure(["a"], edgesOf, true, new Set(["b"])).files].sort()).toEqual(["a", "c"]);
  });
});

describe("judge", () => {
  const exception = { budget: "worker", allowKB: 300, reason: "r", record: "records/x.md" };

  test("a measure within the limit is ok, and an exception for it is stale", () => {
    expect(judge(100 * KB, 200 * KB, undefined)).toEqual({ result: "ok", allowBytes: null, stale: false });
    expect(judge(100 * KB, 200 * KB, exception)).toEqual({ result: "ok", allowBytes: 300 * KB, stale: true });
  });

  test("a measure above the limit passes only within the allowance", () => {
    expect(judge(250 * KB, 200 * KB, exception).result).toBe("exception");
    expect(judge(301 * KB, 200 * KB, exception).result).toBe("exceeded");
    expect(judge(250 * KB, 200 * KB, undefined).result).toBe("exceeded");
  });
});

describe("measureBuild", () => {
  test("measures the entries of a spec, without the shell", () => {
    const report = measureBuild(sampleBuild(), SPEC);
    expect(report.problems).toEqual([]);
    const byId = Object.fromEntries(report.measures.map((item) => [item.id, item]));
    expect(Object.keys(byId).sort()).toEqual(["core", "worker"]);
    expect(byId.worker?.files).toEqual(["assets/room3dWorker-IIII.js", "assets/three-GGGG.js"]);
    expect(byId.core?.files).toEqual([
      "assets/model-HHHH.js",
      "assets/room3dCore-JJJJ.js",
      "assets/room3dCoreGl-FFFF.js",
      "assets/three-GGGG.js",
    ]);
    for (const item of report.measures) {
      expect(item.result).toBe("ok");
      expect(item.gzip9).toBeGreaterThan(0);
      expect(item.gzip1).toBeGreaterThanOrEqual(item.gzip9);
    }
    expect(report.info["shell (the entry script of index.html and its static imports)"]?.files).toBe(3);
    expect(report.groups?.worker).toEqual(byId.worker?.files);
    expect(formatReport(report)).toContain("Render worker");
  });

  test("a build without the entries, or a run with no spec, has no measure and no problem", () => {
    const dist = build({ "index.html": INDEX, "assets/index-AAAA.js": "export{};", "assets/vue-BBBB.js": "" });
    const report = measureBuild(dist, SPEC);
    expect(report.measures).toEqual([]);
    expect(report.problems).toEqual([]);
    expect(measureBuild(sampleBuild()).measures).toEqual([]);
  });

  test("fails a budget above its limit, passes it with an exception, and names a stale exception", () => {
    const dist = sampleBuild();
    const tiny = { ...SPEC, budgets: [{ id: "worker", label: "Worker", limitBytes: 10 }] satisfies Budget[] };
    expect(measureBuild(dist, tiny).measures[0]?.result).toBe("exceeded");
    const allowed = measureBuild(dist, tiny, [{ budget: "worker", allowKB: 50, reason: "r", record: "x" }]);
    expect(allowed.measures[0]?.result).toBe("exception");
    expect(allowed.problems).toEqual([]);
    const stale = measureBuild(dist, SPEC, [{ budget: "core", allowKB: 50, reason: "r", record: "x" }]);
    expect(stale.problems).toEqual([
      'the exception of "core" is stale: the measure is within the limit, so remove the entry',
    ]);
  });

  test("the files that index.html names", () => {
    const html = INDEX.replace("<head>", '<head><script src="/assets/compat-NNNN.js" defer></script>');
    expect(indexAssets(html)).toEqual([
      "assets/compat-NNNN.js",
      "assets/index-AAAA.js",
      "assets/vue-BBBB.js",
      "assets/index-CCCC.css",
    ]);
  });

  test("leaves the precompressed copies out of the measures and names a stale copy", () => {
    const dist = sampleBuild();
    const worker = readFileSync(join(dist, "assets/room3dWorker-IIII.js"));
    writeFileSync(join(dist, "assets/room3dWorker-IIII.js.br"), brotliCompressSync(worker));
    writeFileSync(join(dist, "assets/room3dWorker-IIII.js.gz"), gzipSync(worker, { level: 9 }));
    const report = measureBuild(dist, SPEC);
    expect(report.problems).toEqual([]);
    const byId = Object.fromEntries(report.measures.map((item) => [item.id, item]));
    expect(byId.worker?.files).toEqual(["assets/room3dWorker-IIII.js", "assets/three-GGGG.js"]);
    expect(report.precompressed).toEqual({ br: 1, gz: 1 });
    expect(formatReport(report)).toContain("1 files .br, 1 files .gz");

    // A copy of an earlier build, and a copy without its file.
    writeFileSync(join(dist, "assets/vue-BBBB.js.gz"), gzipSync("export const a=2;"));
    writeFileSync(join(dist, "assets/gone-ZZZZ.js.br"), brotliCompressSync("x"));
    expect(measureBuild(dist, SPEC).problems).toEqual([
      "assets/gone-ZZZZ.js.br has no file of its own (a stale copy)",
      "assets/vue-BBBB.js.gz is not the gzip form of its file (a stale copy)",
    ]);
  });

  test("names a missing import and a build without index.html", () => {
    const dist = build({
      "index.html": INDEX,
      "assets/index-AAAA.js": 'import"./gone-ZZZZ.js";',
      "assets/room3dWorker-IIII.js": 'import"./lost-YYYY.js";',
    });
    const report = measureBuild(dist, SPEC);
    expect(report.problems).toContain("the shell imports assets/gone-ZZZZ.js, but the build has no such file");
    expect(report.problems).toContain(
      "assets/room3dWorker-IIII.js imports assets/lost-YYYY.js, but the build has no such file",
    );
    expect(measureBuild(build({})).problems[0]).toMatch(/has no index\.html/);
  });
});

describe("readExceptions", () => {
  test("reads the entries and refuses an entry without a reason", () => {
    const dir = build({
      "ok.json": JSON.stringify({ entries: [{ budget: "worker", allowKB: 300, reason: "r", record: "x" }] }),
      "bad.json": JSON.stringify({ entries: [{ budget: "worker", allowKB: 300, reason: "", record: "x" }] }),
    });
    expect(readExceptions(join(dir, "ok.json"), SPEC)).toHaveLength(1);
    expect(() => readExceptions(join(dir, "bad.json"), SPEC)).toThrow(/needs budget/);
    expect(() => readExceptions(join(dir, "ok.json"), { ...SPEC, budgets: [] })).toThrow(/needs budget/);
    expect(readExceptions(join(dir, "none.json"), SPEC)).toEqual([]);
  });
});
