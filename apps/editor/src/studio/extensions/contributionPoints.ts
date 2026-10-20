// SPDX-License-Identifier: Apache-2.0
/**
 * The install of the contribution points of a studio face after the panels and the commands. The points are the
 * component icons, the widgets, the create presets, the overlays, the status items, the problem sources, the page
 * tools, the context lines and the docs links. Each ID starts with the ID of the plugin (for a page tool, the ID and
 * "_"). A contribution with a different ID gives a warning and does not install. An overlay renders in an error
 * boundary, as a panel does.
 */
import { createApp, markRaw, shallowRef, type Component } from "vue";
import { editorI18n, t } from "../../texts";
import type { CustomStatusItem } from "../shell/status";
import type {
  LazyComponent,
  StudioContext,
  StudioCreatePreset,
  StudioHandle,
  StudioPluginDefinition,
  StudioProblem,
  StudioSceneTool,
} from "./api";
import ContributionBoundary from "./ContributionBoundary.vue";
import type { PluginSettingsSection, PluginSettingsStore } from "./pluginSettings";
import { pluginIcon } from "./PluginIcon";

/** The registries of the editor window for the points. */
export interface StudioPointHost {
  addComponentIcon(id: string, icon: Component): () => void;
  addWidget(name: string, load: LazyComponent, ctx: StudioContext, failed: (error: unknown) => void): () => void;
  addPreset(preset: StudioCreatePreset & { readonly title: string }): () => void;
  addOverlay(spec: {
    readonly id: string;
    readonly title: () => string;
    readonly edge: "top" | "right" | "bottom" | "left";
    readonly order: number;
    readonly content: HTMLElement;
  }): () => void;
  addStatusItem(item: CustomStatusItem): () => void;
  addProblems(id: string, source: () => Promise<readonly StudioProblem[]>): () => void;
  /** Run the checks of Problems again (a change of the settings of a plugin). */
  refreshProblems(): void;
  addPageTool(tool: {
    readonly name: string;
    readonly description: string;
    readonly inputSchema: { readonly type: "object"; readonly [key: string]: unknown };
    run(input: Record<string, unknown>): Promise<{ text: string; isError: boolean }>;
  }): () => void;
  addContextLines(id: string, source: () => readonly string[]): () => void;
  addDocsLink(key: string, url: string): () => void;
  addToolbarButton(button: {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    run(): void;
  }): () => void;
  addSceneTool(tool: {
    readonly id: string;
    readonly title: string;
    readonly icon: string;
    activate(canvas: HTMLCanvasElement): () => void;
    /** The current handles of the tool, and a drag of one handle (toolHandles.ts). */
    readonly handles?: () => readonly StudioHandle[];
    readonly moveHandle?: (id: string, point: readonly [number, number, number], done: boolean) => void;
  }): () => void;
  addPreview(kind: string, load: LazyComponent, ctx: StudioContext, failed: (error: unknown) => void): () => void;
  addRecipes(recipes: readonly StudioRecipeView[]): () => void;
  addSettings(section: PluginSettingsSection): () => void;
  /** An item of a context menu with its label in the language of the page. */
  addMenuItem(item: { readonly menu: string; readonly command: string; readonly label: string }): () => void;
}

/** A recipe with its title in the language of the page, as the agent panel lists it. */
export interface StudioRecipeView {
  readonly id: string;
  readonly title: string;
  readonly prompt: string;
  readonly params: readonly { readonly name: string; readonly label: string; readonly default?: string }[];
  readonly source: "plugin";
}

/** The parts of one install: the plugin, its context, the warnings and the report of an error. */
interface PointParts {
  readonly def: StudioPluginDefinition;
  readonly ctx: StudioContext;
  readonly warnings: string[];
  readonly failed: (name: string, error: unknown) => void;
}

const message = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The entries of a list whose ID starts with the prefix. Each other entry gives a warning. */
function owned<T>(parts: PointParts, list: readonly T[], idOf: (item: T) => string, prefix: string): T[] {
  return list.filter((item) => {
    if (idOf(item).startsWith(prefix)) return true;
    parts.warnings.push(t("plugin-not-prefixed", { id: parts.def.id, name: idOf(item), prefix }));
    return false;
  });
}

/** Mount an overlay of a plugin in an element of its own (an app with the texts of the editor). */
function mountOverlay(load: LazyComponent, name: string, parts: PointParts): { element: HTMLElement; stop(): void } {
  const element = document.createElement("div");
  element.dataset.contribution = name;
  const app = createApp(ContributionBoundary, {
    load,
    ctx: parts.ctx,
    name,
    failed: (_name: string, error: unknown) => parts.failed(name, error),
  });
  app.use(editorI18n().plugin).mount(element);
  return { element, stop: () => app.unmount() };
}

/** The status items. Each text updates after a change of the scene or of the selection. */
function installStatus(parts: PointParts, host: StudioPointHost): (() => void)[] {
  const prefix = `${parts.def.id}.`;
  return owned(parts, parts.def.contributes?.statusItems ?? [], (item) => item.id, prefix).flatMap((item) => {
    const version = shallowRef(0);
    const bump = (): void => {
      version.value += 1;
    };
    const safe = (read: () => string): string => {
      try {
        return read();
      } catch (error) {
        parts.failed(item.id, error);
        return "—";
      }
    };
    return [
      host.addStatusItem({
        id: item.id,
        text: () => safe(() => item.text(parts.ctx)),
        ...(item.title === undefined ? {} : { title: () => safe(() => item.title?.(parts.ctx) ?? "") }),
        ...(item.command === undefined ? {} : { command: item.command }),
        version,
      }),
      parts.ctx.documents.listen(bump),
      parts.ctx.selection.listen(bump),
    ];
  });
}

/** The page tools, the context lines and the problem sources: the points of the agents and of Problems. */
function installAgentPoints(parts: PointParts, host: StudioPointHost): (() => void)[] {
  const { def, ctx } = parts;
  const contributes = def.contributes ?? {};
  const tools = owned(parts, contributes.pageTools ?? [], (tool) => tool.name, `${def.id}_`).map((tool) =>
    host.addPageTool({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.input,
      run: async (input) => {
        try {
          return { text: await tool.run(ctx, input), isError: false };
        } catch (error) {
          parts.failed(tool.name, error);
          return { text: message(error), isError: true };
        }
      },
    }),
  );
  const context =
    contributes.contextLines === undefined
      ? []
      : [host.addContextLines(def.id, () => contributes.contextLines?.(ctx) ?? [])];
  const problems = owned(parts, contributes.problemSources ?? [], (source) => source.id, `${def.id}.`).map((source) =>
    host.addProblems(source.id, async () => {
      try {
        return await source.problems(ctx);
      } catch (error) {
        parts.failed(source.id, error);
        return [];
      }
    }),
  );
  // A change of the settings of the plugin can change its problems.
  const again = problems.length === 0 ? [] : [ctx.settings.listen(() => host.refreshProblems())];
  return [...tools, ...context, ...problems, ...again];
}

/** The toolbar buttons, the scene tools, the previews, the recipes and the settings section. */
function installViewPoints(parts: PointParts, host: StudioPointHost): (() => void)[] {
  const { def, ctx } = parts;
  const contributes = def.contributes ?? {};
  const prefix = `${def.id}.`;
  const buttons = owned(parts, contributes.toolbar ?? [], (button) => button.id, prefix).map((button) =>
    host.addToolbarButton({
      id: button.id,
      title: t(button.title),
      icon: button.icon,
      run: () => void ctx.commands.run(button.command).catch((error: unknown) => parts.failed(button.id, error)),
    }),
  );
  const tools = owned(parts, contributes.sceneTools ?? [], (tool) => tool.id, prefix).map((tool) =>
    host.addSceneTool({
      id: tool.id,
      title: t(tool.title),
      icon: tool.icon,
      activate: (canvas) => {
        try {
          return tool.activate(ctx, { canvas });
        } catch (error) {
          parts.failed(tool.id, error);
          return () => undefined;
        }
      },
      ...toolHandleParts(tool, ctx, (error) => parts.failed(tool.id, error)),
    }),
  );
  const previews = (contributes.previews ?? []).map((preview) =>
    host.addPreview(preview.kind, preview.component, ctx, (error) => parts.failed(`preview:${preview.kind}`, error)),
  );
  const recipes = owned(parts, contributes.recipes ?? [], (recipe) => recipe.id, prefix).map((recipe) => ({
    id: recipe.id,
    title: t(recipe.title),
    prompt: recipe.prompt,
    params: recipe.params ?? [],
    source: "plugin" as const,
  }));
  const settings = contributes.settings;
  return [
    ...buttons,
    ...tools,
    ...previews,
    ...(recipes.length === 0 ? [] : [host.addRecipes(recipes)]),
    ...(settings === undefined
      ? []
      : [
          host.addSettings({
            plugin: def.id,
            scope: settings.scope ?? "user",
            title: () => t(settings.title),
            schema: settings.schema,
            store: ctx.settings as PluginSettingsStore,
          }),
        ]),
  ];
}

/** Install the points of a studio face after its panels and commands. The result has a remove function for each. */
export function installPoints(parts: PointParts, host: StudioPointHost): (() => void)[] {
  const { def, ctx } = parts;
  const contributes = def.contributes ?? {};
  const prefix = `${def.id}.`;
  const icons = owned(parts, Object.entries(contributes.componentIcons ?? {}), ([id]) => id, prefix).map(([id, url]) =>
    host.addComponentIcon(id, pluginIcon(url)),
  );
  const widgets = owned(parts, Object.entries(contributes.widgets ?? {}), ([name]) => name, prefix).map(
    ([name, load]) => host.addWidget(name, load, ctx, (error) => parts.failed(name, error)),
  );
  const presets = owned(parts, contributes.createPresets ?? [], (preset) => preset.id, prefix).map((preset) =>
    host.addPreset({ ...preset, title: t(preset.label) }),
  );
  const overlays = owned(parts, contributes.overlays ?? [], (overlay) => overlay.id, prefix).flatMap((overlay) => {
    const mounted = mountOverlay(overlay.component, overlay.id, parts);
    const remove = host.addOverlay({
      id: overlay.id,
      title: () => t(overlay.title),
      edge: overlay.edge ?? "right",
      order: overlay.order ?? 100,
      content: markRaw(mounted.element),
    });
    return [remove, () => mounted.stop()];
  });
  const docs = Object.entries(contributes.docs ?? {}).map(([key, url]) => host.addDocsLink(key, url));
  const menus = (contributes.menus ?? []).map((item) =>
    host.addMenuItem({ menu: item.menu, command: item.command, label: t(item.label) }),
  );
  return [
    ...icons,
    ...widgets,
    ...presets,
    ...overlays,
    ...installStatus(parts, host),
    ...installAgentPoints(parts, host),
    ...installViewPoints(parts, host),
    ...docs,
    ...menus,
  ];
}

/** The handle parts of a scene tool for the page. An error of the plugin gives no handle and goes to `failed`. */
function toolHandleParts(
  tool: StudioSceneTool,
  ctx: StudioContext,
  failed: (error: unknown) => void,
): Pick<Parameters<StudioPointHost["addSceneTool"]>[0], "handles" | "moveHandle"> {
  if (tool.handles === undefined) return {};
  return {
    handles: () => {
      try {
        return tool.handles?.(ctx) ?? [];
      } catch (error) {
        failed(error);
        return [];
      }
    },
    moveHandle: (id, point, done) => {
      try {
        tool.moveHandle?.(ctx, id, point, done);
      } catch (error) {
        failed(error);
      }
    },
  };
}
