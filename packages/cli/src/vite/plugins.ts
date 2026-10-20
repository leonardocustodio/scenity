// SPDX-License-Identifier: Apache-2.0
/**
 * The Vite plugin of the project plugins: the build bundles the runtime face of each plugin of the project, so no code
 * loads from a URL at run time.
 *
 * - `virtual:scenity/plugins` exports `pluginKeys` and `loadPlugins(): Promise<RuntimePlugin[]>`. It imports each
 *   plugin with a dynamic import, so the bundler can make one chunk for each plugin. An empty project gives an
 *   empty list and no plugin code.
 * - `virtual:scenity/plugins/<key>` exports the default export of the runtime face of one plugin.
 *
 * The render worker and the main-thread core import the same module. A worker gets one chunk for each plugin only
 * with `worker.format: "es"`.
 */
import { join, resolve } from "node:path";
import { PROJECT_FILE } from "@scenity/scene";
import type { Plugin, ViteDevServer } from "vite";
import { isInside, resolveProjectPlugins, type ProjectPlugin, type ProjectPlugins } from "./resolve.ts";

export {
  HOST_FILES,
  isInside,
  resolvePluginEntries,
  resolveProjectPlugins,
  RUNTIME_FILES,
  type ProjectPlugin,
  type ProjectPlugins,
} from "./resolve.ts";

/** The ID of the main virtual module. */
export const PLUGINS_MODULE = "virtual:scenity/plugins";
/** The prefix of the resolved IDs: Rollup and Vite do not give a module with this prefix to other plugins. */
const RESOLVED_PREFIX = "\0";

export interface ScenityPluginsOptions {
  /** The project folder: the folder of `scenity.project.json`. A relative path starts at the current folder. */
  readonly project: string;
}

/** A path for an import specifier: `/` as the separator. */
function importPath(path: string): string {
  return path.split("\\").join("/");
}

/**
 * The plugins in the project folder (`<project>/plugins/*`): a change of their files reloads the page in dev. A plugin
 * package outside the project (a workspace package) keeps the module updates of Vite, so the HMR of an editor face
 * in it still works.
 */
function localPlugins(found: ProjectPlugins): ProjectPlugin[] {
  return found.plugins.filter((plugin) => isInside(plugin.dir, found.projectDir));
}

/** The plugins with a runtime face. */
function runtimePlugins(plugins: readonly ProjectPlugin[]): ProjectPlugin[] {
  return plugins.filter((plugin) => plugin.runtime !== undefined);
}

/** The code of the main virtual module. */
export function mainModuleCode(plugins: readonly ProjectPlugin[]): string {
  const list = runtimePlugins(plugins);
  const loaders = list.map((plugin) => `  () => import(${JSON.stringify(`${PLUGINS_MODULE}/${plugin.key}`)}),`);
  return [
    "// The runtime plugins of the project. Each plugin is a dynamic import, so it can be a chunk of its own.",
    `export const pluginKeys = ${JSON.stringify(list.map((plugin) => plugin.key))};`,
    loaders.length === 0 ? "const loaders = [];" : ["const loaders = [", ...loaders, "];"].join("\n"),
    "export async function loadPlugins() {",
    "  const modules = await Promise.all(loaders.map((load) => load()));",
    "  return modules.map((module) => module.default);",
    "}",
    "",
  ].join("\n");
}

/** The code of the virtual module of one plugin. */
export function pluginModuleCode(plugin: ProjectPlugin): string {
  if (plugin.runtime === undefined) throw new Error(`the plugin "${plugin.entry}" has no runtime face`);
  return `export { default } from ${JSON.stringify(importPath(plugin.runtime))};\n`;
}

/** The Vite plugin. `project` is the project folder. */
export function scenityPlugins(options: ScenityPluginsOptions): Plugin {
  const projectDir = resolve(options.project);
  let cache: Promise<ProjectPlugins> | undefined;
  const current = () => (cache ??= resolveProjectPlugins(projectDir));

  return {
    name: "scenity:plugins",
    resolveId(id) {
      if (id === PLUGINS_MODULE || id.startsWith(`${PLUGINS_MODULE}/`)) return RESOLVED_PREFIX + id;
      return undefined;
    },
    async load(id) {
      if (!id.startsWith(RESOLVED_PREFIX + PLUGINS_MODULE)) return undefined;
      const found = await current();
      this.addWatchFile(found.projectFile);
      const name = id.slice(RESOLVED_PREFIX.length);
      if (name === PLUGINS_MODULE) return mainModuleCode(found.plugins);
      const key = name.slice(PLUGINS_MODULE.length + 1);
      const plugin = runtimePlugins(found.plugins).find((item) => item.key === key);
      if (plugin === undefined) this.error(`the project has no runtime plugin "${key}"`);
      return pluginModuleCode(plugin);
    },
    configureServer(server) {
      watchProject(server, join(projectDir, PROJECT_FILE), current, () => {
        cache = undefined;
      });
    },
    async handleHotUpdate({ file }) {
      // The full reload of `watchProject` replaces the module update of Vite for a plugin file.
      const found = await current().catch(() => undefined);
      if (found === undefined) return undefined;
      return localPlugins(found).some((plugin) => isInside(resolve(file), plugin.dir)) ? [] : undefined;
    },
  };
}

/**
 * Watch the project document and the plugin folders in the project folder in dev. A change reloads the page; the
 * render worker starts again with the page, so it also gets the new plugin code. A change of the project document
 * reads the plugin list again.
 */
function watchProject(
  server: ViteDevServer,
  project: string,
  current: () => Promise<ProjectPlugins>,
  forget: () => void,
) {
  const watch = () => {
    server.watcher.add(project);
    current().then(
      (found) => server.watcher.add(localPlugins(found).map((plugin) => plugin.dir)),
      (error: unknown) => {
        server.config.logger.error(`scenity: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
  };
  const reload = () => {
    for (const id of [...server.moduleGraph.idToModuleMap.keys()]) {
      if (!id.startsWith(RESOLVED_PREFIX + PLUGINS_MODULE)) continue;
      const module = server.moduleGraph.getModuleById(id);
      if (module !== undefined) server.moduleGraph.invalidateModule(module);
    }
    server.ws.send({ type: "full-reload" });
  };
  const onFile = (file: string) => {
    const path = resolve(file);
    if (path === project) {
      forget();
      reload();
      watch();
      return;
    }
    current().then(
      (found) => {
        if (localPlugins(found).some((plugin) => isInside(path, plugin.dir))) reload();
      },
      () => undefined,
    );
  };
  watch();
  for (const event of ["change", "add", "unlink"] as const) server.watcher.on(event, onFile);
}
