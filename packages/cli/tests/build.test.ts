// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity build`: the build of the showroom into a temp folder (the report, the documents, the assets, the player
 * entries in their budgets, no dev code), a budget that is too low, planted dev code (a marker, a dev module, plugin
 * code that the project does not list, a marker of a plugin face) and the arguments of the command. The build uses
 * `--check`, so it writes nothing into the samples.
 */
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ProjectDocument } from "@scenity/scene";
import {
  buildPath,
  checkPlayer,
  engineMarkers,
  entryBudgets,
  gateFails,
  joinMarkerSets,
  parseBuildArgs,
  playerGroups,
  pluginMarkers,
  readBuildProject,
  readMarkerFace,
  REPORT_FILE,
  runBuild,
  runBuildCommand,
  type BuildReport,
  type BuiltFile,
} from "../src/build/index";
import type { ProjectPlugin } from "../src/vite/resolve";
import { copyPoster } from "../src/build/posters";
import type { SceneDocument } from "@scenity/scene";

const SHOWROOM = join(import.meta.dir, "../../../samples/showroom");
const temp = mkdtempSync(join(tmpdir(), "scenity-build-"));
const out = join(temp, "dist");
let report: BuildReport;

beforeAll(async () => {
  report = (await runBuild({ dir: SHOWROOM, out, check: true })).report;
}, 300_000);
afterAll(() => rmSync(temp, { recursive: true, force: true }));

/** Write a file of the build (a planted fault) and give a function that removes it. */
function plant(path: string, text: string): () => void {
  const file = join(out, ...path.split("/"));
  writeFileSync(file, text);
  return () => rmSync(file, { force: true });
}

describe("scenity build of the showroom", () => {
  test("the build passes the budgets and the marker gate, and writes the report", () => {
    expect(report.problems).toEqual([]);
    expect(report.passed).toBe(true);
    expect(report.entries.map((entry) => [entry.id, entry.result])).toEqual([
      ["player", "ok"],
      ["element", "ok"],
      ["worker", "ok"],
      ["plugins", "ok"],
      ["lazy", "ok"],
    ]);
    for (const entry of report.entries) {
      expect(entry.limitKB).not.toBeNull();
      expect(entry.gzip).toBeGreaterThan(0);
      console.log(`[build-size] ${entry.id}: ${(entry.gzip / 1024).toFixed(1)} KB gzip of ${String(entry.limitKB)} KB`);
    }
    expect(report.markers.found).toEqual([]);
    expect(report.markers.modules).toEqual([]);
    const written = JSON.parse(readFileSync(join(out, REPORT_FILE), "utf8")) as BuildReport;
    expect(written).toEqual(report);
  });

  test("the build has the page, the documents, the assets with the manifest and the player, and no source map", () => {
    const paths = report.files.map((file) => file.path);
    // The poster of the scene goes into the build next to the documents.
    const documents = ["project/scenity.project.json", "project/scenes/main.scene.json", "project/posters/main.webp"];
    for (const path of ["index.html", ...documents]) {
      expect(paths).toContain(path);
    }
    expect(paths).toContain("project/build/manifest.json");
    expect(paths).toContain("player/index.js");
    expect(paths).toContain("player/element.js");
    expect(paths).toContain("player/plugins.js");
    expect(paths.some((path) => /^player\/assets\/sceneWorker-[^/]+\.js$/.test(path))).toBe(true);
    expect(paths.some((path) => path.endsWith(".map"))).toBe(false);
    expect(report.assets).toMatchObject({ mode: "checked" });
    expect(report.assets.files).toBe(paths.filter((path) => path.startsWith("project/build/")).length);
    expect(readFileSync(join(out, "index.html"), "utf8")).toContain('src="project/scenity.project.json"');
    // The documents are canonical: the copy equals the source file.
    const source = readFileSync(join(SHOWROOM, "scenes/main.scene.json"), "utf8");
    expect(readFileSync(join(out, "project/scenes/main.scene.json"), "utf8")).toBe(source);
  });

  test("a budget that is too low fails", () => {
    const project = readBuildProject(SHOWROOM);
    const low: ProjectDocument = { ...project, build: { ...project.build, budgets: { worker: { gzipKB: 10 } } } };
    const checked = checkPlayer(join(out, "player"), low, engineMarkers(), []);
    const worker = checked.entries.find((entry) => entry.id === "worker");
    expect(worker?.result).toBe("exceeded");
    expect(checked.problems.some((problem) => problem.includes('"worker"') && problem.includes("10 KB"))).toBe(true);
    // The other entries have no budget in this copy of the project.
    expect(checked.entries.find((entry) => entry.id === "player")?.result).toBe("no budget");
  });

  test("a budget of an entry that the build does not have is a problem", () => {
    const problems: string[] = [];
    const project = readBuildProject(SHOWROOM);
    entryBudgets({ ...project, build: { budgets: { page: { gzipKB: 1 } } } }, problems);
    expect(problems).toEqual(['build.budgets names "page", but the build has no such entry']);
  });

  test("a planted marker and a planted dev module fail the gate", () => {
    const project = readBuildProject(SHOWROOM);
    const map = {
      version: 3,
      sources: ["../../../packages/runtime-dev/src/document/devDocumentCore.ts"],
      mappings: "",
    };
    const removers = [
      plant("player/assets/planted.js", 'post({type:"inspectScene"});globalThis.__room3dLab=1;'),
      plant("player/assets/planted.js.map", JSON.stringify(map)),
    ];
    try {
      const checked = checkPlayer(join(out, "player"), project, engineMarkers(), []);
      expect(gateFails(checked.gate)).toBe(true);
      const ids = checked.gate.found.map((item) => item.marker.id);
      expect(ids).toContain("inspectScene");
      expect(ids).toContain("__room3dLab");
      expect(checked.gate.modules.map((item) => item.module.id)).toEqual(["packages/runtime-dev"]);
    } finally {
      for (const remove of removers) remove();
    }
  });

  test("plugin code passes only for a plugin of the project, and a plugin face adds markers", async () => {
    const project = readBuildProject(SHOWROOM);
    const pluginDir = join(temp, "plugins", "acme");
    mkdirSync(pluginDir, { recursive: true });
    const face =
      'export default { markers: [{ id: "acme.secret", what: "a dev string of acme", text: "acme.secret" }] };';
    writeFileSync(join(pluginDir, "markers.ts"), face);
    const map = { version: 3, sources: [join(pluginDir, "runtime.ts")], mappings: "" };
    const removers = [
      plant("player/assets/acme.js", 'export const a="acme.secret";'),
      plant("player/assets/acme.js.map", JSON.stringify(map)),
    ];
    try {
      const unlisted = checkPlayer(join(out, "player"), project, engineMarkers(), []);
      expect(unlisted.gate.modules.map((item) => item.module.id)).toEqual(["plugins"]);
      const plugin: ProjectPlugin = {
        entry: "./plugins/acme",
        key: "acme",
        dir: pluginDir,
        runtime: undefined,
        host: undefined,
      };
      const markers = joinMarkerSets(engineMarkers(), await pluginMarkers([plugin]));
      const listed = checkPlayer(join(out, "player"), project, markers, [pluginDir]);
      expect(listed.gate.modules).toEqual([]);
      expect(listed.gate.found.map((item) => item.marker.id)).toEqual(["acme.secret"]);
      expect(gateFails(listed.gate)).toBe(true);
    } finally {
      for (const remove of removers) remove();
    }
  });
});

describe("the parts of scenity build", () => {
  test("the plugin bundle leaves out the chunks of the main-thread cores", () => {
    const dir = join(temp, "groups");
    mkdirSync(join(dir, "assets"), { recursive: true });
    const files: Record<string, string> = {
      "index.js": 'import "./assets/shared.js"; const core = () => import("./assets/core.js");',
      "element.js": 'import "./assets/shared.js"; const plugins = () => import("./plugins.js");',
      "plugins.js": 'const demo = () => import("./assets/demo.js");',
      "assets/shared.js": "export const a = 1;",
      "assets/core.js": 'import "./three.js";',
      "assets/demo.js": 'import "./three.js"; import "./shared.js";',
      "assets/three.js": "export const b = 2;",
      "assets/sceneWorker-abc.js": "export const c = 3;",
    };
    const build = new Map<string, BuiltFile>();
    for (const [path, text] of Object.entries(files)) {
      writeFileSync(join(dir, path), text);
      build.set(path, { path, bytes: text.length, gzip9: text.length, gzip1: text.length, br: null, gz: null });
    }
    const problems: string[] = [];
    const groups = playerGroups(dir, build, problems);
    expect(problems).toEqual([]);
    expect(groups.plugins).toEqual(["assets/demo.js", "plugins.js"]);
    expect(groups.lazy).toEqual(["assets/core.js", "assets/three.js"]);
  });

  test("the plugin marker passes the plugin host of an engine package", () => {
    const marker = engineMarkers().modules.find((item) => item.id === "plugins");
    expect(marker?.pattern.test("/repo/packages/runtime/src/plugins/host.ts")).toBe(false);
    expect(marker?.pattern.test("/repo/plugins/acme/src/runtime.ts")).toBe(true);
    expect(marker?.pattern.test("/repo/samples/spin/plugins/demo/src/runtime.ts")).toBe(true);
  });

  test("the markers know the paths of the installed packages", () => {
    const { modules } = engineMarkers();
    const plugins = modules.find((item) => item.id === "plugins");
    const dev = modules.find((item) => item.id === "packages/runtime-dev");
    expect(plugins?.pattern.test("../../node_modules/@scenity/runtime/src/plugins/host.ts")).toBe(false);
    expect(plugins?.pattern.test("../../node_modules/@acme/demo/plugins/x.ts")).toBe(true);
    expect(dev?.pattern.test("../../node_modules/@scenity/runtime-dev/src/index.ts")).toBe(true);
    expect(dev?.pattern.test("../../node_modules/@scenity/runtime/src/index.ts")).toBe(false);
    const apps = modules.find((item) => item.id === "apps");
    expect(apps?.pattern.test("../../node_modules/@scenity/editor/src/scene/main.ts")).toBe(true);
    expect(apps?.pattern.test("../../node_modules/.bun/x/node_modules/@scenity/editor/src/plugins.ts")).toBe(true);
    expect(apps?.pattern.test("../../node_modules/@scenity/editor-core/src/index.ts")).toBe(false);
  });

  test("the arguments of the command", () => {
    expect(parseBuildArgs(["samples/showroom", "--out", "x", "--check"])).toEqual({
      options: { dir: "samples/showroom", out: "x", check: true },
      json: false,
    });
    expect(parseBuildArgs([])).toEqual({ options: { dir: ".", check: false }, json: false });
    expect(parseBuildArgs(["--out"])).toBeNull();
    expect(parseBuildArgs(["a", "b"])).toBeNull();
    expect(parseBuildArgs(["--fast"])).toBeNull();
  });

  test("a usage error exits with 2, a folder with no project with 1", async () => {
    expect((await runBuildCommand(["--fast"])).code).toBe(2);
    const empty = join(temp, "empty");
    mkdirSync(empty, { recursive: true });
    const result = await runBuildCommand([empty, "--out", join(temp, "empty-out")]);
    expect(result.code).toBe(1);
    expect(result.out.join("\n")).toContain("has no scenity.project.json");
    expect(existsSync(join(temp, "empty-out"))).toBe(false);
  });

  test("a poster: its build path, a scene out of the project folder, and a missing file", () => {
    const scene = JSON.parse(readFileSync(join(SHOWROOM, "scenes/main.scene.json"), "utf8")) as SceneDocument;
    const target = join(temp, "posters");
    const place = { dir: join(SHOWROOM, "scenes"), path: "../scenes/main.scene.json", buildPath };
    const external = copyPoster({ ...place, out: buildPath(place.path) }, scene, target);
    expect(external.file).toBe("external/posters/main.webp");
    expect(external.doc.poster).toBe("../posters/main.webp");
    expect(existsSync(join(target, "external/posters/main.webp"))).toBe(true);
    const missing = copyPoster({ ...place, out: "a.scene.json" }, { ...scene, poster: "nope.webp" }, target);
    expect(missing.problem).toContain("names the poster nope.webp, but the file does not exist");
  });

  test("a document path out of the project folder goes to external/", () => {
    expect(buildPath("scenes/main.scene.json")).toBe("scenes/main.scene.json");
    expect(buildPath("../../plugins/x/scenes/a.scene.json")).toBe("external/plugins/x/scenes/a.scene.json");
  });

  test("a markers face with a bad kind or no pattern does not read", () => {
    expect(() => readMarkerFace({ markers: [{ id: "a", what: "b", kind: "fatal", text: "a" }] }, "face.ts")).toThrow(
      "the kind is lab, dev or info",
    );
    expect(() => readMarkerFace({ modules: [{ id: "a", what: "b" }] }, "face.ts")).toThrow("a pattern is a RegExp");
    const face = readMarkerFace({ modules: [{ id: "a", what: "b", pattern: "/x/" }] }, "face.ts");
    expect(face.modules[0]?.pattern.test("/a/x/b.ts")).toBe(true);
  });
});
