// SPDX-License-Identifier: Apache-2.0
/**
 * The Vite plugin of the project plugins: the plugin list of a project, the code of the virtual modules and a real
 * build. An empty project bundles no plugin code. A project with a plugin bundles it in a chunk of its own. The tests
 * also check the full reload in dev, the packages of the workspace above a sample project, and a plugin package of
 * another npm scope.
 */
import { afterAll, describe, expect, test } from "bun:test";
import { EventEmitter } from "node:events";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { build, type Plugin, type Rollup, type ViteDevServer } from "vite";
import { PLUGINS_MODULE, resolveProjectPlugins, scenityPlugins } from "../src/vite/plugins";

const temp = mkdtempSync(join(tmpdir(), "scenity-cli-vite-"));
afterAll(() => rmSync(temp, { recursive: true, force: true }));

const MARKER = "doors-plugin-code-7f3a";

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

/** A temp project with the given plugin entries and no scenes. */
function project(name: string, plugins: readonly string[]): string {
  const dir = join(temp, name);
  const doc = { format: "scenity.project/1", id: name, name, scenes: [], plugins };
  put(join(dir, "scenity.project.json"), JSON.stringify(doc));
  put(
    join(dir, "main.js"),
    'import { loadPlugins } from "virtual:scenity/plugins";\nexport const ready = loadPlugins();\n',
  );
  return dir;
}

function doorsPlugin(dir: string): void {
  put(join(dir, "plugins/doors/runtime.ts"), `export default { id: "doors", marker: "${MARKER}" };\n`);
}

/** The message of the error of a promise, or "" when it resolves. */
async function errorOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
    return "";
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

type Load = (this: unknown, id: string) => Promise<string | undefined>;
type ResolveId = (this: unknown, id: string) => string | undefined;

const hookContext = {
  addWatchFile: () => undefined,
  error: (message: string) => {
    throw new Error(message);
  },
};

async function moduleCode(plugin: Plugin, id: string): Promise<{ resolved: string | undefined; code?: string }> {
  const resolved = (plugin.resolveId as ResolveId).call(hookContext, id);
  if (resolved === undefined) return { resolved };
  const code = await (plugin.load as Load).call(hookContext, resolved);
  return code === undefined ? { resolved } : { resolved, code };
}

async function bundle(dir: string): Promise<Rollup.OutputChunk[]> {
  const result = await build({
    root: dir,
    configFile: false,
    logLevel: "silent",
    plugins: [scenityPlugins({ project: dir })],
    build: { write: false, minify: false, rollupOptions: { input: join(dir, "main.js") } },
  });
  const outputs = Array.isArray(result) ? result : [result];
  return outputs.flatMap((output) => ("output" in output ? output.output.filter((item) => item.type === "chunk") : []));
}

describe("resolveProjectPlugins", () => {
  test("finds a folder, a file, a package.json field, and a plugin with no runtime face", async () => {
    const dir = project("mixed", ["./plugins/doors", "./plugins/lamps/face.ts", "./plugins/notes", "./plugins/fans"]);
    doorsPlugin(dir);
    put(join(dir, "plugins/lamps/face.ts"), "export default {};\n");
    put(join(dir, "plugins/notes/package.json"), JSON.stringify({ scenity: { runtime: "./src/face.ts" } }));
    put(join(dir, "plugins/notes/src/face.ts"), "export default {};\n");
    mkdirSync(join(dir, "plugins/fans"), { recursive: true });
    const found = await resolveProjectPlugins(dir);
    expect(found.plugins.map((plugin) => [plugin.key, plugin.runtime?.slice(dir.length)])).toEqual([
      ["doors", "/plugins/doors/runtime.ts"],
      ["lamps", "/plugins/lamps/face.ts"],
      ["notes", "/plugins/notes/src/face.ts"],
      ["fans", undefined],
    ]);
  });

  test("finds a package of the workspace above the project when the project cannot resolve it", async () => {
    const root = join(temp, "workspace");
    put(join(root, "package.json"), JSON.stringify({ name: "root", workspaces: { packages: ["libs/*", "!libs/x"] } }));
    put(join(root, "libs/doors/package.json"), JSON.stringify({ name: "@demo/doors" }));
    put(join(root, "libs/doors/src/runtime.ts"), "export default {};\n");
    const dir = join(root, "samples/demo");
    put(
      join(dir, "scenity.project.json"),
      JSON.stringify({ format: "scenity.project/1", id: "demo", name: "Demo", scenes: [], plugins: ["@demo/doors"] }),
    );
    const found = await resolveProjectPlugins(dir);
    expect(found.plugins.map((plugin) => [plugin.key, plugin.runtime])).toEqual([
      ["doors", join(root, "libs/doors/src/runtime.ts")],
    ]);
  });

  test("finds the host face: a package.json field, else host.ts; a file entry has none", async () => {
    const dir = project("hosts", ["./plugins/doors", "./plugins/notes", "./plugins/lamps/face.ts"]);
    doorsPlugin(dir);
    put(join(dir, "plugins/doors/host.ts"), "export default {};\n");
    put(join(dir, "plugins/notes/package.json"), JSON.stringify({ scenity: { host: "./src/workbench.ts" } }));
    put(join(dir, "plugins/notes/src/workbench.ts"), "export default {};\n");
    put(join(dir, "plugins/lamps/face.ts"), "export default {};\n");
    const found = await resolveProjectPlugins(dir);
    expect(found.plugins.map((plugin) => [plugin.key, plugin.host?.slice(dir.length)])).toEqual([
      ["doors", "/plugins/doors/host.ts"],
      ["notes", "/plugins/notes/src/workbench.ts"],
      ["lamps", undefined],
    ]);
    put(join(dir, "plugins/notes/package.json"), JSON.stringify({ scenity: { host: "./src/gone.ts" } }));
    expect(await errorOf(resolveProjectPlugins(dir))).toMatch(/the host face "\.\/src\/gone\.ts" does not exist/);
  });

  test("loads a plugin package of each npm scope: the project document names it, not its scope", async () => {
    const dir = project("scoped", ["@acme/demo-runtime"]);
    const pkg = join(dir, "node_modules/@acme/demo-runtime");
    const scenity = { runtime: "./src/face.ts", host: "./src/workbench.ts", editor: "./src/lab.ts" };
    put(join(pkg, "package.json"), JSON.stringify({ name: "@acme/demo-runtime", scenity }));
    put(join(pkg, "src/face.ts"), `export default { id: "demo", marker: "${MARKER}" };\n`);
    put(join(pkg, "src/workbench.ts"), "export default {};\n");
    put(join(pkg, "src/lab.ts"), "export default {};\n");
    const found = await resolveProjectPlugins(dir);
    expect(found.plugins.map((plugin) => [plugin.key, plugin.runtime, plugin.host, plugin.editor])).toEqual([
      ["demo-runtime", join(pkg, "src/face.ts"), join(pkg, "src/workbench.ts"), join(pkg, "src/lab.ts")],
    ]);
    const main = await moduleCode(scenityPlugins({ project: dir }), PLUGINS_MODULE);
    expect(main.code).toContain('() => import("virtual:scenity/plugins/demo-runtime")');
    const chunks = await bundle(dir);
    expect(chunks.find((chunk) => !chunk.isEntry)?.code).toContain(MARKER);
  }, 30_000);

  test("refuses a plugin folder that does not exist and a package that is not installed", async () => {
    expect(await errorOf(resolveProjectPlugins(project("missing", ["./plugins/gone"])))).toMatch(/does not exist/);
    expect(await errorOf(resolveProjectPlugins(project("nopackage", ["@nobody/no-plugin"])))).toMatch(/not installed/);
  });
});

describe("the virtual modules", () => {
  test("an empty project gives an empty list and no import", async () => {
    const plugin = scenityPlugins({ project: project("empty", []) });
    const main = await moduleCode(plugin, PLUGINS_MODULE);
    expect(main.resolved).toBe(`\0${PLUGINS_MODULE}`);
    expect(main.code).toContain("export const pluginKeys = [];");
    expect(main.code).not.toContain("import(");
    expect(await moduleCode(plugin, "./other.js")).toEqual({ resolved: undefined });
  });

  test("a project with one plugin imports it through its own virtual module", async () => {
    const dir = project("one", ["./plugins/doors"]);
    doorsPlugin(dir);
    const plugin = scenityPlugins({ project: dir });
    const main = await moduleCode(plugin, PLUGINS_MODULE);
    expect(main.code).toContain('export const pluginKeys = ["doors"];');
    expect(main.code).toContain('() => import("virtual:scenity/plugins/doors")');
    const doors = await moduleCode(plugin, `${PLUGINS_MODULE}/doors`);
    expect(doors.resolved).toBe(`\0${PLUGINS_MODULE}/doors`);
    expect(doors.code).toBe(`export { default } from ${JSON.stringify(join(dir, "plugins/doors/runtime.ts"))};\n`);
    expect(await errorOf(moduleCode(plugin, `${PLUGINS_MODULE}/lamps`))).toMatch(/no runtime plugin "lamps"/);
  });
});

describe("vite build", () => {
  test("an empty project bundles no plugin code", async () => {
    const chunks = await bundle(project("build-empty", []));
    expect(chunks).toHaveLength(1);
    expect(chunks.some((chunk) => chunk.code.includes(MARKER))).toBe(false);
  }, 30_000);

  test("a project with a plugin bundles it in a chunk of its own", async () => {
    const dir = project("build-one", ["./plugins/doors"]);
    doorsPlugin(dir);
    const chunks = await bundle(dir);
    expect(chunks).toHaveLength(2);
    const entry = chunks.find((chunk) => chunk.isEntry);
    const lazy = chunks.find((chunk) => !chunk.isEntry);
    expect(entry?.code.includes(MARKER)).toBe(false);
    expect(lazy?.code).toContain(MARKER);
  }, 30_000);
});

describe("dev server", () => {
  test("a change of a plugin file or of the project document reloads the page", async () => {
    const dir = project("dev", ["./plugins/doors"]);
    doorsPlugin(dir);
    const sent: unknown[] = [];
    const watcher = Object.assign(new EventEmitter(), { add: () => undefined });
    const server = {
      watcher,
      ws: { send: (payload: unknown) => sent.push(payload) },
      config: { logger: { error: () => undefined } },
      moduleGraph: { idToModuleMap: new Map(), getModuleById: () => undefined, invalidateModule: () => undefined },
    } as unknown as ViteDevServer;
    const plugin = scenityPlugins({ project: dir });
    (plugin.configureServer as (server: ViteDevServer) => void)(server);
    await resolveProjectPlugins(dir);
    const settle = () => new Promise((done) => setTimeout(done, 20));
    watcher.emit("change", join(dir, "main.js"));
    await settle();
    expect(sent).toEqual([]);
    watcher.emit("change", join(dir, "plugins/doors/runtime.ts"));
    await settle();
    expect(sent).toEqual([{ type: "full-reload" }]);
    watcher.emit("change", join(dir, "scenity.project.json"));
    await settle();
    expect(sent).toHaveLength(2);
  });
});
