// SPDX-License-Identifier: Apache-2.0
// The tools of the host faces of the plugins: the spin sample gives `demo_spin_time`. The list does not include a tool
// with the name of a core tool. A restricted project gives no tool. The routes list and run the tools.
import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { BridgeHub } from "../src/bridgeHub";
import { loadPluginTools, PluginTools, pluginToolApi } from "../src/agents/pluginTools";

const SPIN = join(import.meta.dir, "..", "..", "..", "samples", "spin");

describe("the tools of the plugins", () => {
  test("the host face of the spin sample gives its tool; a core name keeps the core tool", async () => {
    expect((await loadPluginTools(SPIN, new Set())).map((tool) => tool.name)).toEqual(["demo_spin_time"]);
    expect(await loadPluginTools(SPIN, new Set(["demo_spin_time"]))).toEqual([]);
  });

  test("a restricted project gives no tool", async () => {
    const tools = new PluginTools({ dirOf: () => null, core: new Set() });
    expect(await tools.load("spin")).toEqual([]);
    expect(tools.get("spin")).toEqual([]);
  });

  test("the routes list the tools with their schemas and run one", async () => {
    const tools = new PluginTools({ dirOf: (project) => (project === "spin" ? SPIN : null), core: new Set() });
    const call = (path: string, init?: RequestInit): Promise<Response> => {
      const url = new URL(path, "http://127.0.0.1");
      return pluginToolApi(tools, new BridgeHub(), new Request(url, init), url);
    };
    const listed = (await (await call("/api/agent/tools?project=spin")).json()) as {
      tools: { name: string; inputSchema: { properties: Record<string, { type: string }> } }[];
    };
    expect(listed.tools[0]?.inputSchema.properties.speed?.type).toBe("number");
    const run = (input: unknown): Promise<unknown> =>
      call("/api/agent/tools/run", {
        method: "POST",
        body: JSON.stringify({ project: "spin", name: "demo_spin_time", input }),
      }).then((response) => response.json());
    expect(await run({ speed: 90 })).toMatchObject({ content: [{ text: "A spinner at 90 deg/s turns once in 4 s." }] });
    expect(await run({ speed: 0 })).toMatchObject({ isError: true });
    expect((await call("/api/agent/tools/other")).status).toBe(404);
  });
});
