// SPDX-License-Identifier: Apache-2.0
/**
 * Tests of the MCP tools of the workbench: each tool against a fake lab
 * surface with scripted bridge answers, the registry and the errors of `handleToolRequest`.
 */
import { describe, expect, test } from "bun:test";
import { composeTools, CORE_TOOLS, handleToolRequest, toolListings, workbenchTools } from "../src/tools/index";
import type { ToolDef, ToolResult } from "../src/tools/kit";
import { fakeContext, fakeLab, labAnswers } from "./fakeLab";
import { scaleTestTimeouts } from "./ciTiming";
import { useLabFixture } from "./labFixture";

// The built-in project of the host is the lab fixture (a lab surface, the `labs` runs, the stop gate).
useLabFixture();

// A CI runner gets SCENITY_CI_WAIT_FACTOR times the timeouts (ciTiming.ts).
scaleTestTimeouts();

function textOf(result: ToolResult): string {
  return result.content.map((block) => (block.type === "text" ? block.text : `[image ${block.mimeType}]`)).join("\n");
}

async function run(name: string, input: unknown, answers = labAnswers()) {
  const lab = fakeLab(answers);
  const result = await handleToolRequest(name, input, fakeContext(lab.port));
  return { result, text: textOf(result), calls: lab.calls };
}

describe("the registry", () => {
  test("has the core tools, each with a description and an object schema", () => {
    expect(CORE_TOOLS.map((tool) => tool.name)).toEqual([
      "studio_state",
      "lab_state",
      "lab_frame",
      "lab_tune",
      "lab_tunes",
      "lab_open",
      "lab_browse",
      "lab_pick",
      "lab_marks",
      "scene_query",
      "scene_commands",
      "scene_command",
      "scene_batch",
      "scene_frame",
      "scene_measure",
      "scene_pick",
      "scene_sheet",
      "asset_search",
      "asset_import",
      "lab_measure",
      "lab_console",
      "lab_sheet",
      "workbench_after",
      "workbench_run",
      "job_run",
      "job_status",
      "job_output",
      "ui_state",
      "ui_reveal",
      "ui_highlight",
      "ui_notify",
      "scene_check",
    ]);
    // A host plugin adds its tools after the core tools (the lab fixture adds the two aliases).
    expect(workbenchTools().map((tool) => tool.name)).toEqual([
      ...CORE_TOOLS.map((tool) => tool.name),
      "lab_commands",
      "lab_edit",
    ]);
    for (const listing of toolListings()) {
      expect(listing.description.length).toBeGreaterThan(40);
      expect(listing.inputSchema.type).toBe("object");
      expect(listing.inputSchema).not.toHaveProperty("$schema");
    }
  });

  test("loads studio_state, lab_state and lab_frame with the first prompt and the others on search", () => {
    const always = toolListings()
      .filter((listing) => listing._meta?.["anthropic/alwaysLoad"] === true)
      .map((listing) => listing.name);
    // The lab fixture has no check tool. studio_state is the first call of a session.
    expect(always).toEqual(["studio_state", "lab_state", "lab_frame"]);
  });

  test("puts a plugin tool with the name of a core tool in its place and the other plugin tools after the core", () => {
    const tool = (name: string, description: string) => ({ ...CORE_TOOLS[0], name, description }) as ToolDef;
    const core = [tool("a", "core a"), tool("b", "core b")];
    const tools = composeTools(core, [tool("c", "plugin c"), tool("a", "plugin a")]);
    expect(tools.map((item) => `${item.name}:${item.description}`)).toEqual(["a:plugin a", "b:core b", "c:plugin c"]);
  });

  test("adds the examples of a plugin to the description of a core tool that it keeps", () => {
    const tool = (name: string, description: string) => ({ ...CORE_TOOLS[0], name, description }) as ToolDef;
    const core = [tool("a", "core a"), tool("b", "core b")];
    const tools = composeTools(core, [tool("a", "plugin a")], { a: "note a", b: "note b" });
    expect(tools.map((item) => `${item.name}:${item.description}`)).toEqual(["a:plugin a", "b:core b note b"]);
  });

  test("gives a tool error for an unknown tool, a bad input and a failure of the surface", async () => {
    expect((await run("lab_fly", {})).result.isError).toBe(true);
    const bad = await run("lab_frame", { width: 4000 });
    expect(bad.result.isError).toBe(true);
    expect(bad.text).toContain("width");
    const failed = await run(
      "lab_frame",
      { camera: "moon" },
      { ...labAnswers(), camera: new Error('No camera "moon".') },
    );
    expect(failed.result).toEqual({
      content: [{ type: "text", text: 'lab_frame: No camera "moon".' }],
      isError: true,
    });
  });
});

describe("lab_frame", () => {
  test("goes to the frame in order, then gives the URL, the time, the metrics and one image", async () => {
    const { result, text, calls } = await run("lab_frame", {
      take: "greet",
      item: "clip_wave_hello",
      tune: { "wave.hand.y": -0.004 },
      debug: ["ik"],
      camera: "side",
      t: 6350,
      width: 640,
    });
    expect(calls.map((item) => item.call)).toEqual([
      "load",
      "open",
      "tune",
      "debug",
      "camera",
      "pause",
      "seek",
      "frame",
      "measure",
      "capture",
      "url",
    ]);
    expect(calls.find((item) => item.call === "capture")?.args).toEqual([640, null, 400]);
    expect(calls.find((item) => item.call === "open")?.args).toEqual(["clip_wave_hello", { play: false }]);
    expect(result.content.filter((block) => block.type === "image")).toEqual([
      { type: "image", data: "UklGRiQAAABXRUJQ", mimeType: "image/webp" },
    ]);
    expect(text).toContain("Frame at 6350 ms · take greet · camera side · visible frame");
    expect(text).toContain("bo: ik.reachError 0.012 m");
    expect(text.split("\n").length).toBeLessThanOrEqual(12);
  });

  test("uses the shadow frame on request and a default width of 1280 px", async () => {
    const lab = fakeLab();
    const shadow = fakeLab();
    const ctx = { ...fakeContext(lab.port), surface: (id: string) => (id === "shadow" ? shadow.port : lab.port) };
    await handleToolRequest("lab_frame", { where: "shadow" }, ctx);
    expect(lab.calls).toEqual([]);
    expect(shadow.calls.find((item) => item.call === "capture")?.args).toEqual([1280, null, 800]);
  });

  test("gives one pane or the grid of the split screen", async () => {
    const pane = await run("lab_frame", { width: 640, pane: 2 });
    expect(pane.calls.find((item) => item.call === "capture")?.args).toEqual([640, null, 400, { pane: 2 }]);
    const grid = await run("lab_frame", { width: 640, grid: true });
    expect(grid.calls.find((item) => item.call === "capture")?.args).toEqual([640, null, 400, { grid: true }]);
  });

  test("refuses an item without a scene with the words of the lab", async () => {
    const { result, text } = await run("lab_frame", { item: "clip_wave_off" }, { ...labAnswers(), open: false });
    expect(result.isError).toBe(true);
    expect(text).toContain('the item "clip_wave_off" has no scene');
  });
});

describe("the tune tools", () => {
  test("lab_tune sets a known path and gives the tune-apply text", async () => {
    const { text, calls } = await run("lab_tune", { path: "wave.hand.y", value: -0.004 });
    expect(calls.find((item) => item.call === "tune")?.args).toEqual(["wave.hand.y", -0.004]);
    expect(text).toContain('bun run labs tune-apply "wave.hand.y:-0.004"');
    const bad = await run("lab_tune", { path: "wave.nothing", value: 1 });
    expect(bad.result.isError).toBe(true);
    expect(bad.calls.some((item) => item.call === "tune")).toBe(false);
  });

  test("lab_tunes lists the changed values first and keeps a filter", async () => {
    const { text } = await run("lab_tunes", {});
    const lines = text.split("\n");
    expect(lines[0]).toBe("Tunables: 2 of 2.");
    expect(lines[1]).toContain("wave.hand.y = -0.004 (tuned) · default 0");
    expect((await run("lab_tunes", { filter: "lean" })).text).toContain('Tunables with "lean": 1 of 2.');
  });
});

describe("the browser tools", () => {
  test("lab_open opens an item and gives its scene and the URL", async () => {
    const { text, calls } = await run("lab_open", { key: "clip_wave_hello", play: true });
    expect(calls[0]).toEqual({ call: "open", args: ["clip_wave_hello", { play: true }] });
    expect(text).toContain("Opened clip_wave_hello: one wave");
    expect(text).toContain("take greet · window 5000–9000 ms · moment 6350 ms · camera side · cast bo · exact");
  });

  test("lab_browse lists the children with their scenes", async () => {
    const { text, calls } = await run("lab_browse", { path: "team/bo" });
    expect(calls[0]).toEqual({ call: "browse", args: ["team/bo"] });
    expect(text).toContain("clip_wave_off · stop the wave · clip · no scene");
  });
});

describe("lab_state and lab_console", () => {
  test("lab_state gives the packet and the short lab state", async () => {
    const { text } = await run("lab_state", {});
    expect(text).toContain("Workbench context · ");
    expect(text).toContain('Lab state: {"members":[{"id":"bo"');
    expect(text).not.toContain('"look"');
  });

  test("lab_console gives the entries since the last call and clears them", async () => {
    const lab = fakeLab();
    const ctx = fakeContext(lab.port);
    const first = textOf(await handleToolRequest("lab_console", {}, ctx));
    expect(first).toContain("Console of the lab: 1 errors, 1 warnings.");
    expect(first).toContain("TypeError: the lamp is undefined");
    expect(first).toContain("Dev server: ready on port 52140");
    const quiet = fakeLab({ ...labAnswers(), console: { errors: [], warnings: [] } });
    const second = textOf(await handleToolRequest("lab_console", {}, { ...ctx, surface: () => quiet.port }));
    expect(second).toContain("0 errors, 0 warnings");
  });
});

describe("shownUrl", () => {
  test("takes the workbench parameter out of a URL and keeps the rest as it is", async () => {
    const { shownUrl } = await import("../src/tools/kit");
    expect(shownUrl("http://h/?workbench=http://w&t=1")).toBe("http://h/?t=1");
    expect(shownUrl("http://h/?t=1&workbench=http://w")).toBe("http://h/?t=1");
    expect(shownUrl("http://h/?a=1&workbench=x&tune=a:1")).toBe("http://h/?a=1&tune=a:1");
    expect(shownUrl("http://h/?workbench=x")).toBe("http://h/");
  });
});
