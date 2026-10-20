// SPDX-License-Identifier: Apache-2.0
// The page tools and the page lines of the context packet. The bridge calls `tools`, `tools.call` and `contextLines`
// serve the parts of the editor plugin. If the editor has no registered plugin, the test registers a plugin with only
// an ID.
import { afterEach, describe, expect, it } from "vitest";
import { CONTEXT_LINES_CALL, PAGE_TOOL_CALL, PAGE_TOOLS_CALL } from "@scenity/bridge";
import { PAGE_BRIDGE_CALLS, pageContextLines, pageToolList, runPageTool } from "../../src/core/bridge/workbenchTools";
import { registeredPlugin, registerEditorPlugin, type EditorPlugin, type PageTool } from "../../src/core/plugin";

/** The plugin of the page: the registered one, else a plugin with only an ID (the tests read its tools and lines). */
const registered: EditorPlugin = registeredPlugin() ?? ({ id: "fixture" } as unknown as EditorPlugin);
registerEditorPlugin(registered);
afterEach(() => registerEditorPlugin(registered));

const LAMPS: PageTool = {
  name: "scene_lamps",
  description: "The lamps of the scene and their light values.",
  inputSchema: { type: "object", properties: { on: { type: "boolean" } } },
  run: (input) => (input.on === true ? "2 lamps on" : { text: "no lamp on", isError: true }),
};

describe("the page tools", () => {
  it("the plugin of this editor gives no page tools and no page lines", async () => {
    expect(pageToolList()).toEqual([]);
    expect(await pageContextLines()).toEqual([]);
  });

  it("lists the tools of the plugin without their run and runs one by name", async () => {
    registerEditorPlugin({ ...registered, tools: [LAMPS], contextLines: () => ["Lamps: 2 on."] });
    expect(pageToolList()).toEqual([
      { name: LAMPS.name, description: LAMPS.description, inputSchema: LAMPS.inputSchema },
    ]);
    expect(await runPageTool("scene_lamps", { on: true })).toEqual({ text: "2 lamps on", isError: false });
    expect(await runPageTool("scene_lamps", {})).toEqual({ text: "no lamp on", isError: true });
    await expect(runPageTool("scene_fans", {})).rejects.toThrow('No page tool "scene_fans". Tools: scene_lamps.');
    expect(await pageContextLines()).toEqual(["Lamps: 2 on."]);
  });

  it("serves the calls with the checks of @scenity/bridge", async () => {
    registerEditorPlugin({ ...registered, tools: [LAMPS] });
    expect(await PAGE_BRIDGE_CALLS[PAGE_TOOLS_CALL.name]([])).toHaveLength(1);
    expect(await PAGE_BRIDGE_CALLS[PAGE_TOOL_CALL.name](["scene_lamps", { on: true }])).toEqual({
      text: "2 lamps on",
      isError: false,
    });
    await expect(PAGE_BRIDGE_CALLS[PAGE_TOOL_CALL.name](["Bad Name"])).rejects.toThrow("the tool name is not valid");
    expect(await PAGE_BRIDGE_CALLS[CONTEXT_LINES_CALL.name]([])).toEqual([]);
  });
});
