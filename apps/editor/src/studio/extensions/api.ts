// SPDX-License-Identifier: Apache-2.0
/**
 * The studio face of a plugin (docs/plugins.md, docs/studio-plugins.md): the public API of the editor window for
 * plugins, `@scenity/editor/studio`. The studio face is the module of the `scenity.studio` field of the package.json
 * of the plugin (else `studio.ts` or `src/studio.ts`). Its default export is `defineStudioPlugin(...)`.
 *
 * A contribution gets a context (`StudioContext`): the open scene, the selection, the commands, the panels, the toasts
 * and the texts of the plugin. Edits go through commands, so they get undo, keys, the history and an agent tool. The
 * component of a panel gets the services of the shell from the hooks of this module (hooks.ts).
 */
import type { ArgSpec } from "@scenity/editor-core";
import type { Component } from "vue";

// The hooks of the components of panels. The core panels use the same hooks.
export {
  EmptyState,
  useAgentAsk,
  usePanelState,
  usePanelVisible,
  useRoleReason,
  useViewerReason,
  type AgentAsk,
  type RoleAction,
} from "./hooks";

// The adapter of a lab face: a studio face from the parts of a lab face that work in the editor window.
export { adaptLabFace, type AdaptedLabFace, type KeptLabPart } from "./labFace";

/** The spec of an argument of a command: its type, its description, and its limits or values. */
export type StudioArgSpec = ArgSpec;

/** The version of this API. The editor accepts this version and the previous version. */
export const STUDIO_API_VERSION = 1;

/** The place of a panel in the default layout. */
export type StudioPanelArea = "left" | "right" | "bottom" | "floating";

/** A lazy Vue component: the code loads on the first use. */
export type LazyComponent = () => Promise<{ readonly default: Component } | Component>;

/** One entity of the open scene, as a frozen view. */
export interface StudioEntityView {
  readonly id: string;
  readonly name: string | undefined;
  readonly components: Readonly<Record<string, unknown>>;
}

/** The context of each contribution of a plugin. */
export interface StudioContext {
  /** The ID of the plugin. */
  readonly plugin: string;
  /** The name of the project on the dev server. */
  readonly project: string;
  /** The open documents: frozen views, and a listener of their changes. No direct writes. */
  readonly documents: {
    /** The entities of the open scene. With `component`, only the entities that have that component. */
    entities(component?: string): readonly StudioEntityView[];
    /** Call `listener` after each change of the open scene. The result stops it. */
    listen(listener: () => void): () => void;
  };
  readonly selection: {
    ids(): readonly string[];
    set(ids: readonly string[]): void;
    listen(listener: (ids: readonly string[]) => void): () => void;
  };
  readonly commands: {
    /** Run a command of the editor window (the plugin is the actor). */
    run(id: string, args?: Readonly<Record<string, unknown>>): Promise<void>;
  };
  readonly panels: { open(id: string): void };
  readonly notify: { toast(title: string, text?: string): void };
  /** The settings of the plugin: the values of the person. The `settings` point gives their form. */
  readonly settings: {
    value(): Readonly<Record<string, unknown>>;
    set(value: Readonly<Record<string, unknown>>): void;
    listen(listener: () => void): () => void;
  };
  /** A text of the plugin (its Fluent files) or of the editor. */
  t(id: string, args?: Readonly<Record<string, unknown>>): string;
}

/** A dock panel. The ID starts with the ID of the plugin and a dot. */
export interface StudioPanel {
  readonly id: string;
  /** The Fluent ID of the title. */
  readonly title: string;
  /** The URL of an SVG icon (an `import ... from "./icon.svg?url"`), else the icon of plugins. */
  readonly icon?: string;
  readonly area?: StudioPanelArea;
  /** The component of the panel. It gets the prop `ctx` (`StudioContext`). */
  readonly component: LazyComponent;
}

/** A command of the editor window. The ID starts with the ID of the plugin and a dot, in camelCase words. */
export interface StudioCommand {
  readonly id: string;
  /** The Fluent ID of the title. */
  readonly title: string;
  readonly keys?: readonly string[];
  /** The arguments: each name with its type and its description, for the search box and the agent tool. */
  readonly args?: Readonly<Record<string, StudioArgSpec>>;
  /** True: the agents can run it. */
  readonly agents?: boolean;
  /** The menu of the menu bar: `<menu>` or `<menu>/<submenu>` (the Fluent ID `menu-<menu>-<submenu>` names it). */
  readonly menu?: string;
  /** The reason why the command cannot run, or null. */
  when?(ctx: StudioContext): string | null;
  run(ctx: StudioContext, args: Readonly<Record<string, unknown>>): void | Promise<void>;
}

/**
 * An item of a context menu: `hierarchy` (the menu of an entity row, and the command gets `{ entity }`) or
 * `hierarchy.empty` (the menu of the empty tree). The command is a command of the plugin or of the editor.
 */
export interface StudioMenuItem {
  readonly menu: "hierarchy" | "hierarchy.empty";
  readonly command: string;
  /** The Fluent ID of the label. */
  readonly label: string;
}

/** A problem of a plugin for the Problems panel. */
export interface StudioProblem {
  /** The key of the problem, stable from one check to the next. */
  readonly key: string;
  readonly level: "error" | "warn";
  readonly title: string;
  readonly detail?: string;
  /** The entities that Go to selects. */
  readonly entities?: readonly string[];
  readonly fixes?: readonly { readonly id: string; readonly label: string; run(): unknown }[];
}

/** A source of problems: a check of the plugin. The Problems panel runs it after each change of the scene. */
export interface StudioProblemSource {
  readonly id: string;
  problems(ctx: StudioContext): readonly StudioProblem[] | Promise<readonly StudioProblem[]>;
}

/** An overlay of the Scene view (a small panel over the view). */
export interface StudioOverlay {
  readonly id: string;
  /** The Fluent ID of the title. */
  readonly title: string;
  readonly edge?: "top" | "right" | "bottom" | "left";
  readonly order?: number;
  /** The component of the overlay. It gets the prop `ctx`. */
  readonly component: LazyComponent;
}

/** An item of the status bar: its current text, and the command of a press. */
export interface StudioStatusItem {
  readonly id: string;
  /** The current text. The bar reads it again after each change of the scene or of the selection. */
  text(ctx: StudioContext): string;
  title?(ctx: StudioContext): string;
  readonly command?: string;
}

/** A tool of the agents that runs in the editor window. The name starts with the plugin ID and "_". */
export interface StudioPageTool {
  readonly name: string;
  readonly description: string;
  /** The JSON Schema of the input: an object schema. */
  readonly input: { readonly type: "object"; readonly [key: string]: unknown };
  run(ctx: StudioContext, input: Readonly<Record<string, unknown>>): string | Promise<string>;
}

/** An entry of the create menu: an entity with components. */
export interface StudioCreatePreset {
  readonly id: string;
  /** The Fluent ID of the label of the menu item. */
  readonly label: string;
  /** The name of the new entity. */
  readonly name: string;
  /** The name of a lucide icon (for example "box"). */
  readonly icon?: string;
  readonly components: Readonly<Record<string, unknown>>;
}

/** A button of the toolbar of the Scene view that runs a command. */
export interface StudioToolbarButton {
  readonly id: string;
  /** The Fluent ID of the title (the tooltip and the name of the button). */
  readonly title: string;
  /** The URL of an SVG icon. */
  readonly icon: string;
  readonly command: string;
}

/**
 * A tool of the Scene view: a toggle button of the toolbar. While the tool is active, it gets the pointer input of
 * the canvas of the view (its listeners). Escape or a second press makes it inactive.
 */
export interface StudioSceneTool {
  readonly id: string;
  readonly title: string;
  readonly icon: string;
  /** Make the tool active. The result makes it inactive. */
  activate(ctx: StudioContext, view: { readonly canvas: HTMLCanvasElement }): () => void;
  /**
   * The handles of the tool while it is active: world points that the editor draws over the Scene view. The editor
   * reads them again at each frame of the view.
   */
  handles?(ctx: StudioContext): readonly StudioHandle[];
  /**
   * A drag of a handle on the level plane of its point. It gets the new point at each move (`done` false), then at
   * the release (`done` true). An edit of the scene goes through a command at the release, so it is one undo step.
   */
  moveHandle?(ctx: StudioContext, id: string, point: readonly [number, number, number], done: boolean): void;
}

/** A handle of a scene tool: a world point that the person drags. */
export interface StudioHandle {
  readonly id: string;
  readonly point: readonly [number, number, number];
  /** The name of the handle (its tooltip and its name for a screen reader); a text of the plugin. */
  readonly label?: string;
}

/** The preview of an asset kind in the asset inspector. It gets the props `asset` and `url` (the source file). */
export interface StudioPreview {
  readonly kind: string;
  readonly component: LazyComponent;
}

/** A recipe of the agents: a saved prompt with parameters (`{name}` in the prompt). */
export interface StudioRecipe {
  readonly id: string;
  /** The Fluent ID of the title. */
  readonly title: string;
  readonly prompt: string;
  readonly params?: readonly { readonly name: string; readonly label: string; readonly default?: string }[];
}

/**
 * The settings of a plugin: the JSON Schema of its values (an object). `scope` "user" (the default): a section of
 * Preferences, the values of the person in this browser. "project": a section of Project settings, the values in the
 * project (`.scenity/plugin-settings.json`, shared through Git).
 */
export interface StudioSettings {
  /** The Fluent ID of the title of the section. */
  readonly title: string;
  readonly schema: { readonly type: "object"; readonly [key: string]: unknown };
  readonly scope?: "user" | "project";
}

/**
 * The parts that a plugin adds to the editor window (docs/studio-plugins.md). A widget gets the props `ctx`, `value`,
 * `label` and `set(value)` (an edit of the field, one undo step).
 */
export interface StudioContributions {
  readonly panels?: readonly StudioPanel[];
  readonly commands?: readonly StudioCommand[];
  /** The icon (the URL of an SVG file) of each component of the plugin. */
  readonly componentIcons?: Readonly<Record<string, string>>;
  /** The widget of each `custom` hint of the components of the plugin. */
  readonly widgets?: Readonly<Record<string, LazyComponent>>;
  readonly createPresets?: readonly StudioCreatePreset[];
  readonly overlays?: readonly StudioOverlay[];
  readonly statusItems?: readonly StudioStatusItem[];
  readonly problemSources?: readonly StudioProblemSource[];
  readonly pageTools?: readonly StudioPageTool[];
  /** The lines of the plugin in the context packet of the agents. */
  contextLines?(ctx: StudioContext): readonly string[];
  /** The docs links: `panel:<id>`, `component:<id>` or `command:<id>` to a URL. */
  readonly docs?: Readonly<Record<string, string>>;
  readonly toolbar?: readonly StudioToolbarButton[];
  readonly sceneTools?: readonly StudioSceneTool[];
  readonly previews?: readonly StudioPreview[];
  readonly recipes?: readonly StudioRecipe[];
  readonly settings?: StudioSettings;
  /** The items of the context menus. */
  readonly menus?: readonly StudioMenuItem[];
}

/** The studio face of a plugin. */
export interface StudioPluginDefinition {
  /** The ID of the plugin: a lower-case word, the prefix of its contributions. */
  readonly id: string;
  /** The version of the API that the plugin uses (`STUDIO_API_VERSION`). */
  readonly apiVersion: number;
  /**
   * The Fluent files of the plugin by their path, for example
   * `import.meta.glob("./i18n/{locale}/{name}.ftl", { query: "?raw", import: "default", eager: true })` with the
   * real locale and name (`./i18n/en-US/demo.ftl`).
   */
  readonly texts?: Readonly<Record<string, string>>;
  readonly contributes?: StudioContributions;
  /** Run one time when the editor window loads the plugin. The result runs when the window unloads it. */
  activate?(ctx: StudioContext): (() => void) | undefined;
}

/** The studio face of a plugin (an identity function that gives the types). */
export function defineStudioPlugin<T extends StudioPluginDefinition>(definition: T): T {
  return definition;
}
