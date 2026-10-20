// SPDX-License-Identifier: Apache-2.0
/**
 * The plugins of the editor: the one module of the editor app that registers the plugins for the core
 * (src/core/plugin.ts). The editor names no plugin. The generated module `generated/editorPlugins.ts` imports the
 * editor face of each plugin of the project of the editor (the `scenity.project` field of the root package.json). The
 * Vite config writes it from the project document (`@scenity/cli/editor`). `virtual:scenity/plugins` gives the runtime
 * faces of the same plugins.
 */
import type { RuntimePlugin } from "@scenity/runtime/plugins";
import { loadPlugins } from "virtual:scenity/plugins";
import type { App } from "vue";
import { registerEditorPlugin, type EditorPlugin } from "./core/plugin";
import { editorPlugins } from "./generated/editorPlugins";

/** The editor faces of the project. The core holds one plugin: the first editor face. */
const plugins: readonly EditorPlugin[] = editorPlugins;
const plugin = plugins[0];
if (plugin !== undefined) registerEditorPlugin(plugin);

/**
 * The runtime faces of the project plugins (the project of vite.config.ts) through `virtual:scenity/plugins`. The
 * plugin host checks them (a lazy chunk: it holds the scene builder). The first view of the scene loads them and gives
 * the runtime plugin to the main-thread core.
 */
async function runtimePlugins(): Promise<readonly RuntimePlugin[]> {
  const [{ PluginHost }, list] = await Promise.all([import("@scenity/runtime/plugins"), loadPlugins()]);
  return new PluginHost(list).plugins;
}

for (const each of plugins) each.useRuntimePlugins?.(runtimePlugins);

/**
 * The types of the editor face of the first plugin that the core reads (the take model, the content browser, the
 * layout checks, the scene input, the inspect report, the metric values, the room kit). The values reach the core
 * through `EditorPlugin.scene` (src/core/sceneSource.ts).
 *
 * The types come from the module name `virtual:scenity/editor-types`. Only the type check reads this name (the
 * `paths` of a tsconfig.json). The tsconfig.json of the editor gives the types of the editor core; the tsconfig.json of
 * a plugin outside the checkout gives the types of its editor face, so the check reads the core with them.
 */
export type {
  BrowserItem,
  BrowserTree,
  DebugLayer,
  IndexShot,
  InspectReport,
  ItemScene,
  LabEvent,
  LabMember,
  LabMock,
  LabState,
  LayoutCheck,
  LayoutChecks,
  LayoutReport,
  MetricName,
  MetricValue,
  PluginLabApi,
  PresetName,
  ProposalLayout,
  Room3DManifest,
  Room3DRenderer,
  RoomKit,
  RoomLight,
  SaveCheck,
  SceneInput,
  SocketName,
} from "virtual:scenity/editor-types";

/** Start the data sources of the plugins in the app before it mounts. */
export function installPlugins(app: App): void {
  for (const each of plugins) each.install?.(app);
}
