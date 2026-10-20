// SPDX-License-Identifier: Apache-2.0
// The adapter of a lab face (docs/lab-to-studio.md). The tabs and the dock tabs of a lab face are panels of the studio,
// with the labels as Fluent texts. Its page tools are page tools of the window. Its context lines (also from a promise)
// go to the agents. The parts that need the lab page are in `kept` with a reason.
import { flushPromises, mount } from "@vue/test-utils";
import { describe, expect, it } from "vitest";
import { defineComponent, h, type Component } from "vue";
import type { EditorPlugin } from "../../src/core/plugin";
import { adaptLabFace } from "../../src/studio/extensions/labFace";
import {
  definitionProblem,
  installStudioPlugin,
  type StudioPluginHost,
} from "../../src/studio/extensions/installStudioPlugin";
import type { PanelSpec } from "../../src/studio/shell/panels";
import { t } from "../../src/texts";
import { fixtureLabPlugin } from "../fixtures/lab-plugin/labPlugin";

const Crew = defineComponent({ render: () => h("p", "crew") });

/** A lab face with tabs, a dock tab, two page tools and context lines; the lab parts are empty stand-ins. */
const lab = {
  id: "rig",
  registerCommands: () => undefined,
  ops: [],
  tabs: [
    { value: "crew", label: "The crew", component: Crew },
    { value: "viewOptions", label: "View {options}", component: Crew, at: "view" },
  ],
  dockTabs: [{ value: "clips", label: "Clips", component: Crew }],
  cameras: { views: {}, paneDefaults: [] },
  selectionKinds: [],
  tools: [
    {
      name: "rig_count",
      description: "Count the people of the crew.",
      inputSchema: { type: "object", properties: {} },
      run: () => "4 people",
    },
    {
      name: "rig_fail",
      description: "A tool that fails.",
      inputSchema: { type: "object" },
      run: () => ({ text: "no crew", isError: true }),
    },
  ],
  contextLines: () => Promise.resolve(["The crew has 4 people."]),
} as unknown as EditorPlugin;

/** A host that keeps the panels and the points. */
function fakeHost() {
  const panels: PanelSpec[] = [];
  const added: Record<string, unknown[]> = {};
  const keep =
    (point: string) =>
    (...values: unknown[]): (() => void) => {
      (added[point] ??= []).push(values.at(-1));
      return () => undefined;
    };
  const point = new Proxy({}, { get: (_target, name) => keep(String(name)) });
  const host = {
    points: point,
    context: {
      project: "demo",
      documents: { entities: () => [], listen: () => () => undefined },
      selection: { ids: () => [], set: () => undefined, listen: () => () => undefined },
      commands: { run: () => Promise.resolve() },
      panels: { open: () => undefined },
      notify: { toast: () => undefined },
    },
    registerPanel: (spec: PanelSpec) => {
      panels.push(spec);
      return () => undefined;
    },
    setPanel: () => undefined,
    registerCommands: () => () => undefined,
    failed: () => undefined,
  } as unknown as StudioPluginHost;
  return { host, panels, added };
}

describe("the adapter of a lab face", () => {
  it("makes panels with Fluent titles, page tools and context lines; the lab parts are kept with a reason", async () => {
    const { face, kept } = adaptLabFace(lab);
    expect(definitionProblem(face)).toBeNull();
    const { host, panels, added } = fakeHost();
    const installed = installStudioPlugin(face, host);
    expect(installed.error).toBeNull();
    expect(installed.warnings).toEqual([]);
    expect(panels.map((panel) => [panel.id, panel.area, t(panel.title)])).toEqual([
      ["rig.crew", "right", "The crew"],
      ["rig.viewOptions", "right", "View {options}"],
      ["rig.clips", "bottom", "Clips"],
    ]);
    // The window gives each result as a text and an error flag.
    const tools = added.addPageTool as {
      name: string;
      run(input: object): Promise<{ text: string; isError: boolean }>;
    }[];
    expect(tools.map((tool) => tool.name)).toEqual(["rig_count", "rig_fail"]);
    expect(await tools[0]?.run({})).toEqual({ text: "4 people", isError: false });
    const failed = await tools[1]?.run({});
    expect(failed?.isError).toBe(true);
    expect(failed?.text).toContain("no crew");
    // The lines of a promise come after the activation.
    const lines = added.addContextLines?.[0] as () => readonly string[];
    await flushPromises();
    expect(lines()).toEqual(["The crew has 4 people."]);
    expect(kept.map((part) => part.part)).toEqual(["registerCommands", "cameras"]);
    expect(kept.every((part) => part.reason.length > 0)).toBe(true);
    installed.dispose();
  });

  it("gives a face with no tabs and no tools no texts and no context lines", () => {
    const bare: Partial<EditorPlugin> = { ...lab, tabs: [], dockTabs: [], tools: [] };
    delete bare.contextLines;
    const { face } = adaptLabFace(bare as EditorPlugin);
    expect(face.texts).toEqual({});
    expect(face.contributes?.panels).toEqual([]);
    expect("contextLines" in (face.contributes ?? {})).toBe(false);
    expect("activate" in face).toBe(false);
  });

  it("runs the lab fixture in the studio: its take model is the Takes panel", async () => {
    const { face, kept } = adaptLabFace(fixtureLabPlugin);
    const { host, panels } = fakeHost();
    const installed = installStudioPlugin(face, host);
    expect(installed.error).toBeNull();
    expect(panels.map((panel) => [panel.id, panel.area, t(panel.title)])).toEqual([
      ["fixture-lab.takes", "bottom", t("lab-takes-title")],
    ]);
    expect(kept.map((part) => part.part)).toEqual(["sequence"]);
    const loaded = await face.contributes?.panels?.[0]?.component();
    const panel = mount(loaded as Component);
    expect(panel.get("[data-testid=lab-takes-take]").element).toHaveProperty("value", "greet");
    await panel.get("[data-testid=lab-takes-time]").setValue("2000");
    expect(panel.findAll("[data-testid=lab-takes-members] li").map((item) => item.text())).toEqual(["ada", "bo"]);
    expect(panel.get("[data-testid=lab-takes-marks]").text()).toContain("ada to door");
    await panel.get("[data-testid=lab-takes-moment-wave]").trigger("click");
    expect(panel.get("[data-testid=lab-takes-at]").text()).toBe(t("lab-takes-ms", { time: 4000 }));
    await panel.get("[data-testid=lab-takes-take]").setValue("parade");
    expect(panel.get("[data-testid=lab-takes-at]").text()).toBe(t("lab-takes-ms", { time: 0 }));
    panel.unmount();
    installed.dispose();
  });
});
