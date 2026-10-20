// SPDX-License-Identifier: Apache-2.0
/**
 * The types of the virtual modules of the project plugins. The Vite plugin `scenityPlugins` of `@scenity/cli/vite`
 * makes them. A consumer adds this file to the `include` of its tsconfig.
 */
declare module "virtual:scenity/plugins" {
  import type { RuntimePlugin } from "@scenity/runtime/plugins";

  /** The key of each plugin with a runtime face, in the order of the project document. */
  export const pluginKeys: readonly string[];
  /**
   * The runtime face of each plugin, in the order of `pluginKeys`. Each plugin is a chunk of its own. `set` names the
   * plugin set of a host with many projects: the scene server of the editor gives the plugins of the project with that
   * name. A build of one project ignores it.
   */
  export function loadPlugins(set?: string): Promise<RuntimePlugin[]>;
}

declare module "virtual:scenity/plugins/*" {
  import type { RuntimePlugin } from "@scenity/runtime/plugins";

  /** The runtime face of one plugin. */
  const plugin: RuntimePlugin;
  export default plugin;
}
