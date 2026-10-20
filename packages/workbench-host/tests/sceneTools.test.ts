// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the generic Claude tools of the host: `scene_query`, `scene_commands` and
 * `scene_command` against a fake scene page. The page answers the bridge calls `scene.query`, `commands`,
 * `proposalMode`, `command` and `url` as the scene page does (apps/editor `src/scene/sceneBridgeCalls.ts`). It uses
 * the real scene channel, runner and commands of `@scenity/editor-core` and the generic garden scene of its tests. The
 * checks: the schemas, a query, a command run that changes the document as one undo step, and the proposal path.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, readDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  createCommandRegistry,
  createRunner,
  editProblems,
  EMPTY_VIEW,
  entityTarget,
  HIERARCHY_COMMANDS,
  PRESET_COMMANDS,
  queryScene,
  SceneChannel,
  sceneOpKind,
  TRANSFORM_COMMANDS,
  type CommandHost,
  type CommandOptions,
  type HierarchyOp,
  type HierarchyState,
  type Proposal,
  type ProposalMode,
} from "../../editor-core/src/index";
import { CORE_TOOLS, handleToolRequest, toolListings } from "../src/tools/index";
import type { ToolResult } from "../src/tools/kit";
import type { SurfacePort } from "../src/tools/context";
import { scaleTestTimeouts } from "./ciTiming";
import { fakeContext } from "./fakeLab";

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

const GARDEN = join(import.meta.dir, "..", "..", "editor-core", "tests", "fixtures", "garden.scene.json");
const components = builtinRegistry();
/** The bytes of a picture of the fake page. */
const WEBP = new Uint8Array([82, 73, 70, 70]);

function garden(): SceneDocument {
  const read = readDocument(readFileSync(GARDEN, "utf8"), "scene");
  if (!read.ok) throw new Error(JSON.stringify(read.errors));
  return read.doc;
}

/** A fake scene page: the garden in a scene channel, the runner of the page and the bridge calls of the tools. */
function scenePage() {
  const channel = new SceneChannel<SceneDocument>({ doc: garden(), registry: components, patch: () => undefined });
  const registry = createCommandRegistry<HierarchyState, CommandHost, HierarchyOp>();
  registry.register(HIERARCHY_COMMANDS);
  registry.register(TRANSFORM_COMMANDS);
  registry.register(PRESET_COMMANDS);
  const proposals = { value: [] as readonly Proposal<HierarchyOp>[] };
  const mode = { value: "propose" as ProposalMode };
  const kinds = [sceneOpKind(components)];
  const runner = createRunner<HierarchyState, CommandHost, HierarchyOp>({
    registry,
    state: () => ({ doc: channel.doc, view: EMPTY_VIEW, selection: entityTarget("table"), selected: [] }),
    host: { select: () => undefined, undo: () => channel.undo(), redo: () => channel.redo() },
    apply: (edit) => ({ step: channel.apply(edit).applied, pending: [], sent: [] }),
    problems: (edit) => editProblems(edit, kinds, { known: () => false, defaults: new Map() }),
    proposals,
    mode,
    keepMode: () => undefined,
  });
  const answers: Record<string, (args: readonly unknown[]) => unknown> = {
    "scene.query": (args) => queryScene(channel.doc, args[0] ?? {}),
    commands: () => runner.listings(),
    proposalMode: () => mode.value,
    url: () => "http://127.0.0.1:5176/scene.html?project=garden&edit=1",
    command: (args) => runner.run(String(args[0]), args[1], args[2] as CommandOptions),
    camera: () => true,
    "scene.pick": (args) =>
      args[0] === 0
        ? null
        : {
            entity: "table",
            component: null,
            sub: (args[2] as { sub?: unknown }).sub === undefined ? undefined : "top",
            point: [0, 0.75, 0],
            distance: 3.2,
          },
    selection: () => ["bench"],
    sheet: (args) => ({
      width: 1280,
      height: 400,
      mime: "image/webp",
      bytes: WEBP,
      simMs: [null, null],
      cameras: (args[0] as { cameras?: string[] }).cameras ?? ["page camera"],
      take: null,
      lanes: null,
    }),
    frame: () => undefined,
    capture: (args) => ({ simMs: null, width: Number(args[0]), height: 600, mime: "image/webp", bytes: WEBP }),
  };
  const calls: string[] = [];
  const port: SurfacePort = {
    async call(name, args = []) {
      calls.push(name);
      const answer = answers[name];
      if (answer === undefined) throw new Error(`No call "${name}".`);
      return await answer(args);
    },
  };
  return { port, channel, runner, mode, proposals, calls };
}

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : "[image]")).join("\n");
}

async function tool(page: ReturnType<typeof scenePage>, name: string, input: unknown) {
  const result = await handleToolRequest(name, input, fakeContext(page.port));
  return { result, text: textOf(result) };
}

const benchPlace = (page: ReturnType<typeof scenePage>): unknown =>
  (page.channel.doc.entities.bench?.components.transform as { position?: unknown } | undefined)?.position;

describe("the generic Claude tools", () => {
  test("are core tools with object schemas: the filters of the query and the command run", () => {
    const names = CORE_TOOLS.map((item) => item.name);
    expect(names).toContain("scene_query");
    expect(names).toContain("scene_commands");
    expect(names).toContain("scene_command");
    expect(names).toContain("scene_check");
    const listing = (name: string) => toolListings().find((item) => item.name === name)?.inputSchema;
    expect(Object.keys(listing("scene_query")?.properties ?? {}).sort()).toEqual(
      ["component", "ids", "limit", "name", "tag", "under", "values", "where"].sort(),
    );
    expect(listing("scene_command")).toMatchObject({ required: ["command"] });
    expect(listing("scene_commands")?.properties).toHaveProperty("filter");
    const bad = handleToolRequest("scene_query", { limit: 0 }, fakeContext(scenePage().port));
    return bad.then((result) => {
      expect(result.isError).toBe(true);
      expect(textOf(result)).toContain("scene_query: bad input: limit");
    });
  });

  test("scene_query gives the entities of a filter with their transforms and values", async () => {
    const page = scenePage();
    const { text, result } = await tool(page, "scene_query", { component: "light", values: ["light"] });
    expect(result.isError).toBeUndefined();
    expect(text).toContain("2 of 4 entities match.");
    expect(text).toContain('lamp "Lamp" (under table) · components light, transform');
    expect(text).toContain("world position [0, 1.2, 0]");
    expect(text).toContain('values {"light":{"intensity":2,"target":"entity:table#top","type":"spot"}}');
    const none = await tool(page, "scene_query", { ids: ["pond"] });
    expect(none.result.isError).toBe(true);
    expect(none.text).toContain('No entity "pond" in the scene.');
  });

  test("scene_command gives the agent session of the call to the page", async () => {
    const page = scenePage();
    const hows: unknown[] = [];
    const port: SurfacePort = {
      call(name, args = []) {
        if (name === "command") hows.push(args[2]);
        return page.port.call(name, args);
      },
    };
    const session = { id: "s1", name: "Layout helper", colour: "#7c3aed" };
    await handleToolRequest(
      "scene_command",
      { command: "entity.move", args: { entity: "bench", x: 0.5 } },
      {
        ...fakeContext(port),
        session,
      },
    );
    expect(hows).toEqual([{ by: "claude", session }]);
  });

  test("an agent runs each command of the catalogue with checked arguments; a bad argument stops at the host", async () => {
    const page = scenePage();
    const listed = page.runner.listings().filter((item) => !item.owner);
    /** A valid value of an argument of the garden: an entity, a value of the list, a number in the range, a text. */
    const valueOf = (name: string, spec: Record<string, unknown>): unknown => {
      if (spec.type === "boolean") return true;
      if (spec.type === "number") return typeof spec.min === "number" ? spec.min : 0;
      if (Array.isArray(spec.values)) return spec.values[0];
      return name === "entity" ? "bench" : name === "parent" ? "table" : "Checked";
    };
    for (const command of listed) {
      const args = Object.fromEntries(
        Object.entries(command.args).map(([name, spec]) => [name, valueOf(name, spec as Record<string, unknown>)]),
      );
      const { text } = await tool(page, "scene_command", { command: command.id, args });
      expect(text, command.id).not.toMatch(/No argument|is missing|is a (number|text)|is one of/);
    }
    expect(page.calls.filter((call) => call === "command")).toHaveLength(listed.length);
    // The host checks the arguments: a wrong type and an unknown name never reach the page.
    const before = page.calls.length;
    const bad = await tool(page, "scene_command", {
      command: "entity.move",
      args: { entity: "bench", x: "far", w: 1 },
    });
    expect(bad.text).toBe('scene_command: entity.move: No argument "w" (entity, x, y, z, relative). "x" is a number.');
    expect(page.calls.slice(before)).toEqual(["commands"]);
  });

  test("scene_commands lists the commands with their arguments and the switch", async () => {
    const page = scenePage();
    const { text } = await tool(page, "scene_commands", { filter: "entity.move" });
    expect(text).toContain('Commands of the editor with "entity.move": 1 of');
    expect(text).toContain("entity.move (edit, entity): Move the entities to a world point (or by a vector)");
    expect(text).toContain("args: entity?: string, x?: number, y?: number, z?: number, relative?: boolean");
    expect(text).toContain("Proposal switch of the session: propose (Claude's edits are proposals).");
  });

  test("scene_command of Claude waits as a proposal; the accept of the owner is one undo step", async () => {
    const page = scenePage();
    const { text } = await tool(page, "scene_command", { command: "entity.move", args: { entity: "bench", x: 0.5 } });
    expect(text).toContain("Proposal p1 (entity.move: Move Bench to x 0.5): not applied.");
    expect(text).toContain("The owner accepts or rejects it in the editor.");
    expect(benchPlace(page)).toEqual([1.5, 0, -1]);
    // A mode "apply" of Claude alone stays a proposal: only the switch of the owner lets it apply.
    await tool(page, "scene_command", { command: "entity.move", args: { entity: "bench", x: 0.6 }, mode: "apply" });
    expect(page.proposals.value.map((item) => item.id)).toEqual(["p1", "p2"]);
    page.runner.accept("p1");
    expect(benchPlace(page)).toEqual([0.5, 0, -1]);
    page.channel.undo();
    expect(benchPlace(page)).toEqual([1.5, 0, -1]);
  });

  test("with the switch 'apply' scene_command changes the document as one undo step", async () => {
    const page = scenePage();
    page.mode.value = "apply";
    const { text } = await tool(page, "scene_command", { command: "entity.move", args: { entity: "bench", z: 2 } });
    expect(text).toContain("Applied entity.move (Move Bench to z 2) as one step of the undo history.");
    expect(text).toContain("URL: ");
    expect(benchPlace(page)).toEqual([1.5, 0, 2]);
    expect(page.channel.undo()).toBe(true);
    expect(benchPlace(page)).toEqual([1.5, 0, -1]);
    const bad = await tool(page, "scene_command", { command: "entity.fly" });
    expect(bad.result.isError).toBe(true);
    expect(bad.text).toStartWith("scene_command: ");
  });

  test("scene_measure gives the distance of two entities or points; scene_frame gives one picture", async () => {
    const page = scenePage();
    const { text } = await tool(page, "scene_measure", { from: "table", to: "bench" });
    expect(text).toBe("table to bench: 1.803 m (x 1.5, y 0, z -1).");
    expect((await tool(page, "scene_measure", { from: "0,0,0", to: "0,2,0" })).text).toBe(
      "0,0,0 to 0,2,0: 2 m (x 0, y 2, z 0).",
    );
    const missing = await tool(page, "scene_measure", { from: "table", to: "pond" });
    expect(missing.result.isError).toBe(true);
    const frame = await handleToolRequest("scene_frame", { camera: "front", width: 800 }, fakeContext(page.port));
    expect(frame.content).toEqual([
      { type: "text", text: "Frame from front (800 × 600)" },
      { type: "image", data: "UklGRg==", mimeType: "image/webp" },
    ]);
    expect(page.calls.slice(-3)).toEqual(["camera", "frame", "capture"]);
  });

  test("scene_pick names the entity, the sub-target and its place; without a point, the selection", async () => {
    const page = scenePage();
    const { text } = await tool(page, "scene_pick", { x: 200, y: 150, sub: ["socket"] });
    expect(text).toContain("Hit entity:table#top at [0, 0.75, 0], 3.2 m from the camera.");
    expect(text).toContain('table "Table" (root)');
    expect((await tool(page, "scene_pick", { x: 0, y: 0 })).text).toBe("Nothing under the point.");
    const selected = await tool(page, "scene_pick", {});
    expect(selected.text).toContain("Selected: bench.");
    expect(selected.text).toContain("world position [1.5, 0, -1]");
    const half = await tool(page, "scene_pick", { x: 3 });
    expect(half.result.isError).toBe(true);
  });

  test("scene_sheet gives one picture of the cameras of the page", async () => {
    const page = scenePage();
    const sheet = await handleToolRequest("scene_sheet", { cameras: ["front", "top"] }, fakeContext(page.port));
    expect(sheet.content[0]).toEqual({
      type: "text",
      text: "Sheet of the open scene · 2 cells · now · cameras front, top\nPicture: 1280×400 image/webp.",
    });
    expect(sheet.content[1]).toMatchObject({ type: "image", mimeType: "image/webp" });
  });
});
