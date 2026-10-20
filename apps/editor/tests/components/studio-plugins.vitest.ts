// SPDX-License-Identifier: Apache-2.0
// The studio face of a plugin: the check of a definition and of its API version, the texts, the panels in an error
// boundary, the commands with their context and `activate`. Also the error card of a panel that throws, while the
// editor continues to work.
import { flushPromises, mount } from "@vue/test-utils";
import { afterEach, describe, expect, it } from "vitest";
import { h, markRaw, type Component, type FunctionalComponent } from "vue";
import { defineStudioPlugin, STUDIO_API_VERSION, type StudioContext } from "../../src/studio/extensions/api";
import ContributionBoundary from "../../src/studio/extensions/ContributionBoundary.vue";
import { pluginSettingsStore } from "../../src/studio/extensions/pluginSettings";
import {
  definitionProblem,
  installStudioPlugin,
  type StudioPageContext,
  type StudioPluginHost,
} from "../../src/studio/extensions/installStudioPlugin";
import type { PageKeyCommandSpec } from "../../src/scene/settings/pageKeys";
import type { PanelSpec } from "../../src/studio/shell/panels";
import { editorI18n, t } from "../../src/texts";

const context: StudioPageContext = {
  project: "demo",
  documents: {
    entities: () => [{ id: "wheel", name: "Wheel", components: { "demo.spin": { speed: 45 } } }],
    listen: () => () => undefined,
  },
  selection: { ids: () => [], set: (ids) => void selected.push([...ids]), listen: () => () => undefined },
  commands: { run: () => Promise.resolve() },
  panels: { open: () => undefined },
  notify: { toast: () => undefined },
};
const selected: string[][] = [];

/** A host that keeps what the install gives. */
function fakeHost() {
  const panels: PanelSpec[] = [];
  const contents = new Map<string, { component: unknown; props: Readonly<Record<string, unknown>> }>();
  const commands: PageKeyCommandSpec[] = [];
  const errors: string[] = [];
  const added: Record<string, unknown[]> = {};
  const keep =
    (point: string) =>
    (...values: unknown[]): (() => void) => {
      (added[point] ??= []).push(values.length === 1 ? values[0] : values);
      return () => {
        added[point] = (added[point] ?? []).slice(1);
      };
    };
  const host: StudioPluginHost = {
    points: {
      addComponentIcon: keep("icons"),
      addWidget: keep("widgets"),
      addPreset: keep("presets"),
      addOverlay: keep("overlays"),
      addStatusItem: keep("status"),
      addProblems: keep("problems"),
      refreshProblems: () => undefined,
      addPageTool: keep("tools"),
      addContextLines: keep("lines"),
      addDocsLink: keep("docs"),
      addToolbarButton: keep("toolbar"),
      addSceneTool: keep("tools3d"),
      addPreview: keep("previews"),
      addRecipes: keep("recipes"),
      addSettings: keep("settings"),
      addMenuItem: keep("menus"),
    },
    context,
    registerPanel: (spec) => {
      panels.push(spec);
      return () => panels.splice(panels.indexOf(spec), 1);
    },
    setPanel: (id, content) => void contents.set(id, content),
    registerCommands: (specs) => {
      commands.push(...specs);
      return () => commands.splice(0);
    },
    failed: (plugin, name, error) =>
      void errors.push(`${plugin} ${name}: ${error instanceof Error ? error.message : String(error)}`),
  };
  return { host, panels, contents, commands, errors, added };
}

/** The panel of the test plugin: a functional component with the context of the plugin. */
const panelOf: FunctionalComponent<{ ctx: StudioContext }> = (props) =>
  h("p", { "data-testid": "plugin-panel" }, props.ctx.t("hello-title"));
panelOf.props = ["ctx"];
const Panel = markRaw(panelOf);

afterEach(() => {
  document.body.innerHTML = "";
  selected.splice(0);
});

describe("the studio face of a plugin", () => {
  it("installs the texts, the panels and the commands, runs activate, and takes them out again", async () => {
    const { host, panels, contents, commands } = fakeHost();
    let active = false;
    const face = defineStudioPlugin({
      id: "hello",
      apiVersion: STUDIO_API_VERSION,
      texts: { "./i18n/en-US/hello.ftl": "hello-title = Hello panel\nhello-select = Select the wheels\n" },
      contributes: {
        panels: [
          {
            id: "hello.stats",
            title: "hello-title",
            area: "right",
            component: () => Promise.resolve({ default: Panel as Component }),
          },
        ],
        commands: [
          {
            id: "hello.selectWheels",
            title: "hello-select",
            agents: true,
            run: (ctx) => ctx.selection.set(ctx.documents.entities().map((item) => item.id)),
          },
        ],
      },
      activate: () => {
        active = true;
        return () => {
          active = false;
        };
      },
    });
    const result = installStudioPlugin(face, host);
    expect(result).toMatchObject({ id: "hello", error: null, warnings: [] });
    expect(t("hello-title")).toBe("Hello panel");
    expect(panels.map((panel) => [panel.id, panel.title, panel.area])).toEqual([
      ["hello.stats", "hello-title", "right"],
    ]);
    expect(commands.map((command) => [command.id, command.title, command.agents])).toEqual([
      ["hello.selectWheels", "Select the wheels", true],
    ]);
    await commands[0]?.run({});
    expect(selected).toEqual([["wheel"]]);
    expect(active).toBe(true);
    // The panel content is the error boundary with the lazy component of the plugin.
    const content = contents.get("hello.stats");
    const wrapper = mount(content?.component as Component, {
      props: content?.props ?? {},
      global: { plugins: [editorI18n().plugin] },
    });
    await flushPromises();
    await flushPromises();
    expect(wrapper.get("[data-testid=plugin-panel]").text()).toBe("Hello panel");
    wrapper.unmount();
    result.dispose();
    expect(active).toBe(false);
    expect(panels).toEqual([]);
    expect(commands).toEqual([]);
  });

  it("warns for an old API version and refuses a newer one, an ID with no prefix, and a value that is not a face", () => {
    const { host, panels } = fakeHost();
    const old = installStudioPlugin(
      {
        id: "old",
        apiVersion: STUDIO_API_VERSION - 1,
        contributes: { panels: [{ id: "stats", title: "x", component: () => Promise.resolve({ default: Panel }) }] },
      },
      host,
    );
    expect(old.error).toBeNull();
    expect(old.warnings[0]).toContain("old apiVersion");
    expect(old.warnings[1]).toContain('must start with "old."');
    expect(panels).toEqual([]);
    expect(installStudioPlugin({ id: "new", apiVersion: STUDIO_API_VERSION + 1 }, host).error).toContain(
      "does not load it",
    );
    expect(definitionProblem(null)).toContain("not an object");
    expect(definitionProblem({ id: "Bad Id", apiVersion: 1 })).toContain("lower-case");
    expect(definitionProblem({ id: "x" })).toContain("no apiVersion");
  });

  it("turns a contribution off after three errors in a row, and Turn on starts it again", async () => {
    const Throws = markRaw((() => {
      throw new Error("the widget broke");
    }) as FunctionalComponent);
    const wrapper = mount(ContributionBoundary, {
      props: {
        load: () => Promise.resolve({ default: Throws }),
        ctx: { ...context, plugin: "hello", t, settings: pluginSettingsStore("hello") },
        name: "hello.dial",
      },
      global: { plugins: [editorI18n().plugin] },
    });
    const settle = async (): Promise<void> => {
      await flushPromises();
      await flushPromises();
    };
    await settle();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      expect(wrapper.find("[data-testid=contribution-error]").exists()).toBe(true);
      await wrapper.get("[data-testid=contribution-again]").trigger("click");
      await settle();
    }
    expect(wrapper.get("[data-testid=contribution-off]").text()).toContain("3");
    await wrapper.get("[data-testid=contribution-on]").trigger("click");
    await settle();
    // Turn on starts it again. It has one error, so the card shows Try again.
    expect(wrapper.find("[data-testid=contribution-off]").exists()).toBe(false);
    expect(wrapper.find("[data-testid=contribution-error]").exists()).toBe(true);
    wrapper.unmount();
  });

  it("shows an error card for a panel that throws, and Try again loads it again", async () => {
    let fail = true;
    const Throws = markRaw((() => {
      if (fail) throw new Error("the panel broke");
      return h("p", { "data-testid": "plugin-panel" }, "works");
    }) as FunctionalComponent);
    const errors: string[] = [];
    const wrapper = mount(ContributionBoundary, {
      props: {
        load: () => Promise.resolve({ default: Throws }),
        ctx: { ...context, plugin: "hello", t, settings: pluginSettingsStore("hello") },
        name: "hello.stats",
        failed: (name: string, error: unknown) => void errors.push(`${name}: ${String(error)}`),
      },
      global: { plugins: [editorI18n().plugin] },
    });
    await flushPromises();
    await flushPromises();
    expect(wrapper.get("[data-testid=contribution-error]").text()).toContain("the panel broke");
    expect(errors).toEqual(["hello.stats: Error: the panel broke"]);
    fail = false;
    await wrapper.get("[data-testid=contribution-again]").trigger("click");
    await flushPromises();
    await flushPromises();
    expect(wrapper.get("[data-testid=plugin-panel]").text()).toBe("works");
    wrapper.unmount();
  });
});

describe("the public surface of the studio API", () => {
  it("exports the version, defineStudioPlugin and the hooks of panels; a change of the surface changes this test", async () => {
    const api = await import("../../src/studio/extensions/api");
    expect(Object.keys(api).sort()).toEqual([
      "EmptyState",
      "STUDIO_API_VERSION",
      "adaptLabFace",
      "defineStudioPlugin",
      "useAgentAsk",
      "usePanelState",
      "usePanelVisible",
      "useRoleReason",
      "useViewerReason",
    ]);
    expect(api.STUDIO_API_VERSION).toBe(1);
    const face = { id: "x", apiVersion: 1 };
    expect(api.defineStudioPlugin(face)).toBe(face);
  });
});

describe("the contribution points of a studio face", () => {
  it("gives each point to its registry, with the prefix of the plugin", async () => {
    const { host, added, errors } = fakeHost();
    const result = installStudioPlugin(
      defineStudioPlugin({
        id: "hello",
        apiVersion: STUDIO_API_VERSION,
        contributes: {
          componentIcons: { "hello.bob": "/icons/bob.svg", "other.thing": "/x.svg" },
          widgets: { "hello.curve": () => Promise.resolve({ default: Panel }) },
          createPresets: [
            { id: "hello.box", label: "hello-title", name: "Box", components: { shape: { kind: "box" } } },
          ],
          overlays: [
            { id: "hello.readout", title: "hello-title", component: () => Promise.resolve({ default: Panel }) },
          ],
          statusItems: [
            {
              id: "hello.count",
              text: (ctx) => `${String(ctx.documents.entities().length)} wheels`,
              command: "hello.selectWheels",
            },
          ],
          problemSources: [
            {
              id: "hello.check",
              problems: () => [{ key: "a", level: "warn", title: "A wheel is loose", entities: ["wheel"] }],
            },
            { id: "hello.broken", problems: () => Promise.reject(new Error("the check broke")) },
          ],
          pageTools: [
            {
              name: "hello_count",
              description: "Count the wheels.",
              input: { type: "object" },
              run: (ctx) => String(ctx.documents.entities().length),
            },
            {
              name: "hello_fail",
              description: "Fail.",
              input: { type: "object" },
              run: () => Promise.reject(new Error("no")),
            },
            { name: "other_tool", description: "Not prefixed.", input: { type: "object" }, run: () => "x" },
          ],
          contextLines: () => ["Hello: 1 wheel."],
          docs: { "panel:hello.stats": "https://example.com/hello" },
        },
      }),
      host,
    );
    expect(result.warnings).toEqual([
      'The plugin hello has the contribution other.thing: its ID must start with "hello.".',
      'The plugin hello has the contribution other_tool: its ID must start with "hello_".',
    ]);
    expect(added.icons?.length).toBe(1);
    expect((added.widgets?.[0] as unknown[])[0]).toBe("hello.curve");
    expect(added.presets?.[0]).toMatchObject({ id: "hello.box", title: "Hello panel", name: "Box" });
    expect(added.overlays?.[0]).toMatchObject({ id: "hello.readout", edge: "right" });
    expect((added.overlays?.[0] as { title: () => string }).title()).toBe("Hello panel");
    const status = added.status?.[0] as { text: () => string; command: string };
    expect([status.text(), status.command]).toEqual(["1 wheels", "hello.selectWheels"]);
    const problems = added.problems as [string, () => Promise<unknown>][];
    const check = problems[0]?.[1];
    const broken = problems[1]?.[1];
    expect(await check?.()).toEqual([{ key: "a", level: "warn", title: "A wheel is loose", entities: ["wheel"] }]);
    expect(await broken?.()).toEqual([]);
    expect(errors).toEqual(["hello hello.broken: the check broke"]);
    const [count, fail] = added.tools as { name: string; run(input: object): Promise<unknown> }[];
    expect(await count?.run({})).toEqual({ text: "1", isError: false });
    expect(await fail?.run({})).toEqual({ text: "no", isError: true });
    const lines = (added.lines as [string, () => string[]][])[0]?.[1];
    expect(lines?.()).toEqual(["Hello: 1 wheel."]);
    expect(added.docs).toEqual([["panel:hello.stats", "https://example.com/hello"]]);
    result.dispose();
    expect(added.icons).toEqual([]);
  });

  it("puts the parts into the registries of the page", async () => {
    const { addComponentIcon, componentIcon } = await import("../../src/scene/inspector/componentIcons");
    const { addCustomWidget, customWidget } = await import("../../src/scene/inspector/customWidgets");
    const { addDocsLink, docsLinkOf } = await import("../../src/scene/extensions/docsLinks");
    const parts = await import("../../src/scene/extensions/pageAgentParts");
    const { WindowStatus } = await import("../../src/studio/shell/status");
    const { shallowRef } = await import("vue");
    const stops = [
      addComponentIcon("hello.bob", Panel),
      addCustomWidget("hello.curve", Panel),
      addDocsLink("component:hello.bob", "https://example.com/bob"),
      parts.addPageTool({
        name: "hello_count",
        description: "Count.",
        inputSchema: { type: "object" },
        run: () => Promise.resolve({ text: "2", isError: false }),
      }),
      parts.addContextLines("hello", () => ["Hello."]),
    ];
    expect(componentIcon("hello.bob")).toBe(Panel);
    expect(customWidget("hello.curve")).toBe(Panel);
    expect(docsLinkOf("component:hello.bob")).toBe("https://example.com/bob");
    expect(parts.pluginPageTools()).toEqual([
      { name: "hello_count", description: "Count.", inputSchema: { type: "object" } },
    ]);
    expect(await parts.runPluginPageTool("hello_count", {})).toEqual({ text: "2", isError: false });
    expect(() => parts.runPluginPageTool("nope", {})).toThrow('No page tool "nope"');
    expect(parts.pluginContextLines()).toEqual(["Hello."]);
    const status = new WindowStatus();
    const remove = status.addCustom({ id: "hello.count", text: () => "2 wheels", version: shallowRef(0) });
    expect([...status.custom.keys()]).toEqual(["hello.count"]);
    remove();
    for (const stop of stops) stop();
    expect(componentIcon("hello.bob")).not.toBe(Panel);
    expect(customWidget("hello.curve")).toBeNull();
    expect(parts.pluginPageTools()).toEqual([]);
    expect(status.custom.size).toBe(0);
  });
});

describe("the view points of a studio face", () => {
  it("gives the toolbar, the scene tools, the previews, the recipes and the settings to their registries", () => {
    const { host, added } = fakeHost();
    const runs: string[] = [];
    host.context.commands.run = (id) => {
      runs.push(id);
      return Promise.resolve();
    };
    let on = 0;
    const moved: [string, number[], boolean][] = [];
    installStudioPlugin(
      defineStudioPlugin({
        id: "hello",
        apiVersion: STUDIO_API_VERSION,
        texts: {
          "./i18n/en-US/hello-view.ftl":
            "hello-tool = Paint lanes\nhello-recipe = Add a crossing\nhello-settings = Hello\nhello-menu = Make a wheel\n",
        },
        contributes: {
          toolbar: [{ id: "hello.reset", title: "hello-tool", icon: "/i.svg", command: "hello.selectWheels" }],
          sceneTools: [
            {
              id: "hello.paint",
              title: "hello-tool",
              icon: "/i.svg",
              activate: () => {
                on += 1;
                return () => {
                  on -= 1;
                };
              },
              handles: () => [{ id: "a", point: [1, 0, 2] }],
              moveHandle: (_ctx, id, point, done) => {
                moved.push([id, [...point], done]);
              },
            },
          ],
          previews: [{ kind: "hello.route", component: () => Promise.resolve({ default: Panel }) }],
          recipes: [
            {
              id: "hello.crossing",
              title: "hello-recipe",
              prompt: "Add a crossing at {place}.",
              params: [{ name: "place", label: "Place" }],
            },
          ],
          settings: { title: "hello-settings", schema: { type: "object", properties: { speed: { type: "number" } } } },
          menus: [{ menu: "hierarchy", command: "hello.selectWheels", label: "hello-menu" }],
        },
      }),
      host,
    );
    // An item of the context menu of a hierarchy row, with its label in the language of the page.
    expect(added.menus?.[0]).toEqual({ menu: "hierarchy", command: "hello.selectWheels", label: "Make a wheel" });
    const button = added.toolbar?.[0] as { title: string; run(): void };
    expect(button.title).toBe("Paint lanes");
    button.run();
    expect(runs).toEqual(["hello.selectWheels"]);
    const tool = added.tools3d?.[0] as { activate(canvas: HTMLCanvasElement): () => void };
    const stop = tool.activate(document.createElement("canvas"));
    expect(on).toBe(1);
    stop();
    expect(on).toBe(0);
    // The handles of the tool and a drag of one.
    const handled = tool as unknown as {
      handles(): unknown[];
      moveHandle(id: string, point: readonly [number, number, number], done: boolean): void;
    };
    expect(handled.handles()).toEqual([{ id: "a", point: [1, 0, 2] }]);
    handled.moveHandle("a", [3, 0, 4], true);
    expect(moved).toEqual([["a", [3, 0, 4], true]]);
    expect((added.previews?.[0] as unknown[])[0]).toBe("hello.route");
    expect(added.recipes?.[0]).toEqual([
      {
        id: "hello.crossing",
        title: "Add a crossing",
        prompt: "Add a crossing at {place}.",
        params: [{ name: "place", label: "Place" }],
        source: "plugin",
      },
    ]);
    const section = added.settings?.[0] as {
      plugin: string;
      title(): string;
      store: { set(value: object): void; value(): object };
    };
    expect([section.plugin, section.title()]).toEqual(["hello", "Hello"]);
    section.store.set({ speed: 3 });
    expect(pluginSettingsStore("hello").value()).toEqual({ speed: 3 });
    expect(JSON.parse(localStorage.getItem("scenity.plugin.hello.settings") ?? "{}")).toEqual({ speed: 3 });
  });

  it("puts the recipes, the previews and the settings into the registries of the page", async () => {
    const { PLUGIN_RECIPES, addPluginRecipes } = await import("../../src/scene/agent/recipes");
    const { PLUGIN_PREVIEWS, addPluginPreview } = await import("../../src/assetBrowser/preview/previewKinds");
    const { PLUGIN_SETTINGS, addSettingsSection } = await import("../../src/studio/extensions/pluginSettings");
    const recipe = {
      id: "hello.crossing",
      title: "Add a crossing",
      prompt: "x",
      params: [],
      source: "plugin" as const,
    };
    const stops = [
      addPluginRecipes([recipe]),
      addPluginPreview("hello.route", Panel),
      addSettingsSection({
        plugin: "hello",
        scope: "user",
        title: () => "Hello",
        schema: { type: "object" },
        store: pluginSettingsStore("hello"),
      }),
    ];
    expect(PLUGIN_RECIPES).toEqual([recipe]);
    expect(PLUGIN_PREVIEWS.get("hello.route")).toBe(Panel);
    expect(PLUGIN_SETTINGS.map((section) => section.plugin)).toEqual(["hello"]);
    for (const stop of stops) stop();
    expect([PLUGIN_RECIPES.length, PLUGIN_PREVIEWS.size, PLUGIN_SETTINGS.length]).toEqual([0, 0, 0]);
  });
});
