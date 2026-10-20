// SPDX-License-Identifier: Apache-2.0
/**
 * The create presets of the plugins (the `createPresets` point of a studio face). Each preset is the scene command
 * `entity.create.<id>` (Entity → Create, the search box, the agents), and the + menu of the hierarchy lists it after
 * the built-in presets. The page keeps its scene commands here for the faces, which load after the start of the window.
 */
import { shallowReactive } from "vue";
import type { SceneCommands } from "../hierarchy/sceneCommands";
import type { ScenePageEditor } from "../sceneEditor";

/** A preset of a plugin in the + menu: its ID and its label. */
export interface PluginPresetItem {
  readonly id: string;
  readonly label: string;
}

/** The presets of the plugins, in their order. */
export const PLUGIN_PRESETS = shallowReactive<PluginPresetItem[]>([]);

const commandsOf = new WeakMap<ScenePageEditor, SceneCommands>();

/** Keep the scene commands of the editor of the page. */
export function setSceneCommands(editor: ScenePageEditor, commands: SceneCommands): void {
  commandsOf.set(editor, commands);
}

/** The scene commands of the editor of the page, or undefined (no selection, or not made yet). */
export function sceneCommandsOf(editor: ScenePageEditor): SceneCommands | undefined {
  return commandsOf.get(editor);
}

/** Add a preset to the + menu; the result removes it. */
export function addPluginPreset(item: PluginPresetItem): () => void {
  PLUGIN_PRESETS.push(item);
  return () => {
    const at = PLUGIN_PRESETS.indexOf(item);
    if (at >= 0) PLUGIN_PRESETS.splice(at, 1);
  };
}
