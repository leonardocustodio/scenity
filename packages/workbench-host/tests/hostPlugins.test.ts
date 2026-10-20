// SPDX-License-Identifier: Apache-2.0
/**
 * The host plugin API. The host loads the host faces of the plugins of the project (no static import):
 *
 * - The showroom (no plugins) lists only the core tools, also through `GET /tools/` of a started host. The host starts
 *   with no promote files. A promote then takes the defaults of the project folder.
 * - A project plugin with a host face (`host.ts`) gives its rows of the context packet; a bad face stops the load.
 * - The built-in plugins come from the default project of the workspace (`scenity.project` of the root package.json).
 * - The page adds its tools (the bridge calls `tools` and `tools.call`) and its lines (`contextLines`).
 * - With no plugin rows, the packet shows the entities of the inspect report of the scene.
 */
import { afterAll, afterEach, describe, expect, test } from "bun:test";
import { cpSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { buildPacket } from "../src/context";
import { startHost } from "../src/host";
import { builtInPlugins, defaultProjectDir, hostPlugins, loadHostPlugins, useHostPlugins } from "../src/plugins";
import { loadHostProject } from "../src/project";
import { promoteFiles } from "../src/promote";
import { HOST_PATHS, TOKEN_HEADER } from "../src/protocol";
import { allToolListings, CORE_TOOLS, handleToolRequest, workbenchTools } from "../src/tools/index";
import { makeToolContext } from "../src/tools/context";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeLab, type Answers } from "./fakeLab";
import { cleanup, fakeCommand, rejectsWith, tempDir } from "./helpers";
import { LAB_FIXTURE, useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const ROOT = resolve(import.meta.dir, "../../..");
const SHOWROOM = join(ROOT, "samples/showroom");
const CORE_NAMES = CORE_TOOLS.map((tool) => tool.name);
const made: string[] = [];
afterAll(() => cleanup(...made));
// Each test gives the host back its built-in plugins.
afterEach(() => useHostPlugins(null));

/** A tool context round a fake page with these answers (the visible scene frame). */
function pageContext(answers: Answers) {
  const lab = fakeLab(answers);
  const ctx = makeToolContext({
    surface: () => lab.port,
    scene: "editor",
    checkout: SHOWROOM,
    git: () => Promise.resolve({ branch: "main", changed: [] }),
    now: () => new Date("2026-10-16T10:00:00.000Z"),
  });
  return { ctx, calls: lab.calls };
}

/** A temporary project with one plugin folder and the given host face text. */
function projectWith(face: string): string {
  const dir = join(tempDir("plugin-project"), "lamps-project");
  made.push(dir);
  mkdirSync(join(dir, "plugins/lamps"), { recursive: true });
  const doc = { format: "scenity.project/1", id: "lamps", name: "Lamps", scenes: [], plugins: ["./plugins/lamps"] };
  writeFileSync(join(dir, "scenity.project.json"), JSON.stringify(doc));
  writeFileSync(join(dir, "plugins/lamps/host.ts"), face);
  return dir;
}

describe("the plugins of a project", () => {
  test("the showroom has no host plugins and lists only the core tools", async () => {
    const project = await loadHostProject(SHOWROOM);
    expect(project.plugins).toEqual([]);
    useHostPlugins(project.plugins);
    expect(workbenchTools().map((tool) => tool.name)).toEqual(CORE_NAMES);
    expect(promoteFiles()).toEqual({});
  });

  test("a host started on the showroom lists the core tools at GET /tools/ and gives back the built-in plugins", async () => {
    const parent = tempDir("showroom-tools");
    const state = tempDir("showroom-tools-state");
    made.push(parent, state);
    const dir = join(parent, "showroom");
    cpSync(SHOWROOM, dir, { recursive: true });
    const host = await startHost({ checkout: dir, stateDir: state, serverCommand: fakeCommand, watch: false });
    try {
      expect(hostPlugins()).toEqual([]);
      const response = await fetch(`${host.endpoint.origin}${HOST_PATHS.tools}`, {
        headers: { [TOKEN_HEADER]: host.endpoint.token },
      });
      const body = (await response.json()) as { tools: { name: string }[] };
      expect(body.tools.map((tool) => tool.name)).toEqual(CORE_NAMES);
    } finally {
      await host.stop();
    }
    expect(hostPlugins()).toBe(builtInPlugins());
  });

  test("a plugin folder with a host face gives its rows; a bad face stops the load", async () => {
    const face = [
      "export default {",
      '  id: "lamps", tools: [], runs: { commands: { lamps: "echo lamps" } }, paths: {},',
      '  contextLines: { members: () => ["  lamp rows"] },',
      "};",
    ].join("\n");
    const project = await loadHostProject(projectWith(face));
    expect(project.plugins.map((plugin) => plugin.id)).toEqual(["lamps"]);
    // A manifest with no workbench part gets the runs and the surfaces of its plugins.
    expect(project.runs).toEqual({ lamps: "echo lamps" });
    expect(project.surfaces.map((surface) => surface.id)).toEqual(["editor"]);
    await rejectsWith(loadHostProject(projectWith("export default { id: 1 };\n")), "gives no host plugin");
  });

  test("the built-in plugins are the host faces of the default project of the workspace", () => {
    // The workspace has no default project. `SCENITY_PROJECT` names one (here the lab fixture).
    expect(JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"))).not.toHaveProperty("scenity");
    expect(defaultProjectDir(ROOT, {})).toBeNull();
    const dir = defaultProjectDir();
    expect(dir).toBe(LAB_FIXTURE);
    const doc = JSON.parse(readFileSync(join(dir ?? "", "scenity.project.json"), "utf8")) as { plugins: string[] };
    expect(builtInPlugins().map((plugin) => plugin.id)).toEqual(
      loadHostPlugins(dir ?? "", doc.plugins).map((plugin) => plugin.id),
    );
    expect(builtInPlugins().length).toBeGreaterThan(0);
    expect(defaultProjectDir(tempDir("no-workspace"), {})).toBeNull();
  });
});

describe("the tools of the page", () => {
  const LAMPS = {
    name: "scene_lamps",
    description: "The lamps of the scene and their light values.",
    inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
  };
  const answers: Answers = {
    tools: [LAMPS, { ...LAMPS, name: "lab_frame" }, { ...LAMPS, name: "Bad Name" }],
    "tools.call": (args: readonly unknown[]) => ({ text: `ran ${JSON.stringify(args)}`, isError: false }),
  };

  test("the list has the host tools, then the page tools whose names are free", async () => {
    useHostPlugins([]);
    const { ctx } = pageContext(answers);
    const names = (await allToolListings(ctx)).map((listing) => listing.name);
    expect(names).toEqual([...CORE_NAMES, "scene_lamps"]);
  });

  test("a call of a page tool goes through the bridge; an unknown name names the page tools", async () => {
    useHostPlugins([]);
    const { ctx, calls } = pageContext(answers);
    const result = await handleToolRequest("scene_lamps", { on: true }, ctx);
    expect(result).toEqual({ content: [{ type: "text", text: 'ran ["scene_lamps",{"on":true}]' }] });
    expect(calls.at(-1)).toEqual({ call: "tools.call", args: ["scene_lamps", { on: true }] });
    const unknown = await handleToolRequest("scene_fans", {}, ctx);
    expect(unknown.isError).toBe(true);
    expect(JSON.stringify(unknown.content)).toContain("scene_lamps");
  });

  test("a page with no tools adds none", async () => {
    useHostPlugins([]);
    const { ctx } = pageContext({ tools: new Error("No call") });
    expect((await allToolListings(ctx)).map((listing) => listing.name)).toEqual(CORE_NAMES);
  });
});

describe("the context packet of a scene project", () => {
  const entity = (id: string, components: string[], visible = true) => ({ id, components, visible });
  const sceneAnswers = (more: Answers = {}): Answers => ({
    url: "http://127.0.0.1:5175/?project=showroom&paused=1&workbench=http://127.0.0.1:5199",
    inspect: {
      simMs: 0,
      entities: [
        entity("cart", ["model", "obstacle", "socket", "transform"]),
        entity("lamp", ["light", "transform"]),
        entity("hidden_box", ["model"], false),
        entity("front", ["camera", "transform"]),
      ],
    },
    contextLines: ["Lamps: 1 on."],
    ...more,
  });

  test("shows the entities on screen and the lines of the page, with no plugin rows", async () => {
    useHostPlugins([]);
    const { ctx } = pageContext(sceneAnswers());
    const { text } = await buildPacket(ctx);
    expect(text).toContain("Surface: editor · http://127.0.0.1:5175/?project=showroom&paused=1");
    expect(text).toContain("On screen at 0 ms:");
    expect(text).toMatch(/cart +\(model, obstacle, socket, …\) +lamp +\(light, transform\)/);
    expect(text).toMatch(/ {2}front +\(camera, transform\)/);
    expect(text).not.toContain("hidden_box");
    expect(text).toContain("Lamps: 1 on.");
  });

  test("a plugin with rows replaces the entity rows", async () => {
    const face = { id: "lamps", tools: [], runs: { commands: {} }, paths: {} };
    useHostPlugins([{ ...face, contextLines: { members: () => ["  lamp rows"] } }]);
    const { ctx } = pageContext(sceneAnswers({ contextLines: undefined }));
    const { text } = await buildPacket(ctx);
    expect(text).toContain("  lamp rows");
    expect(text).not.toContain("(light, transform)");
  });

  test("a scene with no entities says so", async () => {
    useHostPlugins([]);
    const { ctx } = pageContext(sceneAnswers({ inspect: { simMs: 0, entities: [] } }));
    expect((await buildPacket(ctx)).text).toContain("On screen at 0 ms:\n  no entities");
  });
});
