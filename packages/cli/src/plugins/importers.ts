// SPDX-License-Identifier: Apache-2.0
/**
 * The importers of the project plugins: the `importers` of the host face of each plugin (the module of `scenity.host`,
 * else `host.ts` or `src/host.ts`), beside the built-in importers. `scenity assets import` and `scenity assets build`
 * use them, so an asset of a plugin file type imports in the CLI as it does in the editor. A host face that does not
 * load gives a warning and no importer.
 */
import { pathToFileURL } from "node:url";
import { resolveProjectPlugins } from "../vite/resolve";

/** The importers of the host faces of the plugins of a project folder (any value: the registry checks each one). */
export async function projectHostImporters(
  dir: string,
  warn: (text: string) => void = () => undefined,
): Promise<unknown[]> {
  const found = await resolveProjectPlugins(dir).catch(() => null);
  if (found === null) return [];
  const all = await Promise.all(
    found.plugins.map(async (plugin) => {
      if (plugin.host === undefined) return [];
      try {
        const module = (await import(pathToFileURL(plugin.host).href)) as { default?: { importers?: unknown } };
        return Array.isArray(module.default?.importers) ? (module.default.importers as unknown[]) : [];
      } catch (error) {
        warn(`the host face ${plugin.host} does not load: ${error instanceof Error ? error.message : String(error)}`);
        return [];
      }
    }),
  );
  return all.flat();
}
