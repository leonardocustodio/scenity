// SPDX-License-Identifier: Apache-2.0
/**
 * The component registry of the scene page: the built-in components and the components of the runtime faces of the
 * project plugins (`virtual:scenity/project-plugins`). The scene channel checks the ops against it, and the inspector
 * makes the widgets of each component from it. A second component with a known ID gets a warning and stays out.
 */
import { builtinRegistry, type ComponentRegistry } from "@scenity/scene";
import { loadProjectPlugins } from "virtual:scenity/project-plugins";

export async function pageRegistry(project: string): Promise<ComponentRegistry> {
  const registry = builtinRegistry();
  for (const plugin of await loadProjectPlugins(project)) {
    for (const component of plugin.components) {
      if (registry.has(component.id)) console.warn(`the plugin "${plugin.id}" gives "${component.id}" again`);
      else registry.register(component);
    }
  }
  return registry;
}

/** The registry of the edit mode (`edit=1`), or undefined: the page without the edit mode loads no plugin code. */
export async function editRegistry(params: URLSearchParams, project: string): Promise<ComponentRegistry | undefined> {
  return params.get("edit") === "1" ? pageRegistry(project) : undefined;
}
