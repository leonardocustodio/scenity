// SPDX-License-Identifier: Apache-2.0
// The tools of the plugins in the search box: a command for each tool, a form from the input schema, the run on the
// host and the toast of its text.
import { afterEach, describe, expect, it, vi } from "vitest";
import { startPluginToolCommands, toolCommandId, toolInput } from "../../src/scene/agent/pluginToolCommands";
import { pageKeys } from "../../src/scene/settings/pageKeys";
import { WindowNotices } from "../../src/studio/shell/dialogs";

const SPIN = {
  name: "demo_spin_time",
  description: "The time of one turn of a spinner.",
  inputSchema: { properties: { speed: { type: "number", description: "The speed in degrees per second" } } },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the tools of the plugins", () => {
  it("have a command ID and an input from the texts of the form", () => {
    expect(toolCommandId("demo_spin_time")).toBe("tool.demoSpinTime");
    expect(toolInput(SPIN, { speed: "90" })).toEqual({ speed: 90 });
    expect(toolInput(SPIN, { speed: "" })).toEqual({});
  });

  it("are commands: a run asks each field, runs the tool and shows its text", async () => {
    const sent: unknown[] = [];
    vi.stubGlobal("fetch", (input: string, init?: RequestInit) => {
      if (input.startsWith("/api/agent/tools?")) return Promise.resolve(Response.json({ tools: [SPIN] }));
      sent.push(JSON.parse(init?.body as string));
      return Promise.resolve(Response.json({ content: [{ type: "text", text: "Once in 4 s." }] }));
    });
    const notices = new WindowNotices();
    const stop = await startPluginToolCommands("spin", notices);
    expect(pageKeys().registry.named("tool.demoSpinTime")?.title).toBe("Run the plugin tool demo_spin_time");
    expect(pageKeys().run("tool.demoSpinTime")).toBeNull();
    await vi.waitFor(() => expect(notices.state.dialog?.request.input?.label).toBe("The speed in degrees per second"));
    notices.answer("go", "90");
    await vi.waitFor(() => expect(notices.state.toasts.at(-1)?.text).toBe("Once in 4 s."));
    expect(sent).toEqual([{ project: "spin", name: "demo_spin_time", input: { speed: 90 } }]);
    stop();
    expect(pageKeys().registry.named("tool.demoSpinTime")).toBeUndefined();
  });

  it("are none when the host does not answer", async () => {
    vi.stubGlobal("fetch", () => Promise.reject(new Error("offline")));
    const stop = await startPluginToolCommands("spin", new WindowNotices());
    expect(pageKeys().registry.named("tool.demoSpinTime")).toBeUndefined();
    stop();
  });
});
