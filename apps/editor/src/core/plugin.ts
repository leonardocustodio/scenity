// SPDX-License-Identifier: Apache-2.0
/**
 * The editor plugin: the static interface between the editor core (src/core) and the editor face of a plugin. The
 * editor registers its plugin in one module (src/plugins.ts) before the page starts. Then the core reads the parts of
 * the plugin through `editorPlugin()`. The virtual module `virtual:scenity/plugins` gives the plugins of the project.
 * The command kit, the runner, the ops and the history are in `@scenity/editor-core`. The plugin registers its
 * commands in the registry of the editor and gives the op kinds of its edits.
 *
 * A core module reads the plugin only in a function, never when the module loads. The plugin imports core modules,
 * thus the order of the module loads must not matter. The core reads some types of the plugin (the take model, the
 * content browser, the layout checks) through src/plugins.ts. That module is the only module that imports the plugin.
 */
import type { BridgeCallDef, PageToolInfo, PageToolResult } from "@scenity/bridge";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { PickKind } from "@scenity/runtime-dev";
import type { RuntimePlugin } from "@scenity/runtime/plugins";
import type { App } from "vue";
import type { PluginLabApi } from "../plugins";
import type { EditorBrowser } from "./browser/tree";
import type { CameraName, NamedView } from "./cameras";
import type { EditorChecks } from "./checks";
import type { EditorPlacement } from "./edit/placement";
import type { OpKind } from "@scenity/editor-core";
import type { CoreCommands } from "./editor/commandKit";
import type { LabCommandRegistry } from "./editor/commands";
import type { EditorOverlays } from "./editor/labParts";
import type { EditorLayout } from "./editor/layout";
import type { EditorScene } from "./sceneSource";
import type { EditorSequence } from "./sequence";
import type { EditorDockTab, EditorTab } from "./tabs";
import type { ApiContext } from "./useLabApi";

/** The named cameras of a plugin (cameras.ts). */
export interface EditorCameras {
  /** The views by name, in their order; a null view is the framing of the scene (`overview`). */
  readonly views: Readonly<Record<CameraName, NamedView | null>>;
  /** The cameras of the panes 1 to 3 of a split screen without `cams` (pane 0 is the main pane). */
  readonly paneDefaults: readonly CameraName[];
}

/** The editor face of a plugin. */
export interface EditorPlugin {
  /** The name of the plugin, for example "showroom". */
  readonly id: string;
  /** Start the data sources of the plugin in the app before it mounts (for example an SDK). */
  install?(app: App): void;
  /**
   * Receive the load function of the runtime faces of the project plugins (`virtual:scenity/plugins`). The plugin
   * calls it when its scene needs a runtime face, for example in the first view of the scene.
   */
  useRuntimePlugins?(load: () => Promise<readonly RuntimePlugin[]>): void;
  /**
   * Register every command of the editor in the registry, in the order of the palette: the generic commands of the
   * core (`core`, by group) and the commands of the plugin (made with `defineCommand`).
   */
  registerCommands(registry: LabCommandRegistry, core: CoreCommands): void;
  /** The op kinds of the edits of the plugin (for example the tune values and the events of its takes). */
  readonly ops: readonly OpKind[];
  /** The tabs of the side panel and the sections of the View tab. */
  readonly tabs: readonly EditorTab[];
  /** The named cameras. */
  readonly cameras: EditorCameras;
  /** The take model: the takes, the state at a time, the moments and the lanes. */
  readonly sequence: EditorSequence;
  /** The motion checks of the takes and the order of the metrics and the members in the graph. */
  readonly checks: EditorChecks;
  /** The content browser: its tree, the icons, the pictures and the reviews of the clip families. */
  readonly browser: EditorBrowser;
  /** The tabs of the dock under the scene, before the tabs of the core (the asset browser). */
  readonly dockTabs?: readonly EditorDockTab[];
  /** The kinds of the items that the editor can select (`selection.set`, the pick). */
  readonly selectionKinds: readonly PickKind[];
  /** The room kit of the scene editor: the editor paths, the snap targets, the warnings, the groups, the measure ends. */
  readonly placement: EditorPlacement;
  /** The layout checks of the scene: the current report, the save gate, the checks of a proposal and of a save. */
  readonly layout: EditorLayout;
  /** The tools over the scene and the command runner that starts them. */
  readonly overlays: EditorOverlays;
  /** The view of the scene, the source of its views, the recorded tracks and the keys of the plugin on the page. */
  readonly scene: EditorScene;
  /** The methods of the plugin in the script API (`globalThis.__room3dLab`). */
  apiExtensions(context: ApiContext): PluginLabApi;
  /**
   * The typed bridge calls of the methods of the plugin (`defineBridgeCall` of `@scenity/bridge`). The bridge checks
   * the arguments of each call with the definition that the host face of the plugin also uses.
   */
  readonly bridgeCalls?: readonly BridgeCallDef[];
  /**
   * The tools of the page for Claude. The workbench host lists them (the bridge call `tools`) after its own tools.
   * It runs them through the bridge (`tools.call`).
   */
  readonly tools?: readonly PageTool[];
  /** The lines of the context packet that the page gives (the bridge call `contextLines`). */
  contextLines?(): readonly string[] | Promise<readonly string[]>;
  /**
   * The current scene document of the page, with the tune values of the page in it. The bridge call `scene.query` of
   * the tool `scene_query` reads it. Absent: the page has no scene document.
   */
  sceneDocument?(tunes: Readonly<Record<string, number>>): SceneDocument | null;
}

/** One tool of the page: its name, its description, the JSON Schema of its input and its run function. */
export interface PageTool extends PageToolInfo {
  /** Run the tool. A text is a result without an error. The function checks its input itself. */
  run(input: Record<string, unknown>): PageToolResult | string | Promise<PageToolResult | string>;
}

let registered: EditorPlugin | null = null;

/** Register the plugin of the editor (src/plugins.ts). A second call replaces the first plugin (a test). */
export function registerEditorPlugin(plugin: EditorPlugin): void {
  registered = plugin;
}

/** The registered plugin, or null before a module registers one. */
export function registeredPlugin(): EditorPlugin | null {
  return registered;
}

/** The registered plugin. It fails when no module registered a plugin. */
export function editorPlugin(): EditorPlugin {
  if (registered === null) throw new Error("No editor plugin: the editor registers its plugin in src/plugins.ts.");
  return registered;
}
