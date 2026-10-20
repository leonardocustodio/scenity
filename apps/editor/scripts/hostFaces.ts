// SPDX-License-Identifier: Apache-2.0
/**
 * The host faces of the plugins of a project in the dev server of the studio: the module of `scenity.host` of each
 * plugin (else `host.ts` or `src/host.ts`). The dev server reads the points that need Bun, the disk or the network:
 * `assetSources` (the providers of the asset sources, `@scenity/assets` `AssetProvider`), `publishTargets` (the
 * places of a publish) and `importers` (the importers of the file types of the plugin, projectImporters.ts). The other
 * parts of a host face are for the agent host. A restricted project (not trusted) gives no host face. A face that does
 * not load gives a warning and no parts.
 */
import { pathToFileURL } from "node:url";
import { resolveProjectPlugins } from "@scenity/cli/plugins";
import { RESTRICTED_PROJECTS } from "./projectsFile.ts";

/** A place of a publish: it gets the ZIP archive of the build and gives a text for the person (a URL, a folder). */
export interface PublishTarget {
  readonly id: string;
  readonly title: string;
  /** `zip`: the archive; `dist`: the build folder; `dir`: the project folder; `project`: the project name. */
  publish(input: {
    readonly zip: string;
    readonly dist: string;
    readonly dir: string;
    readonly project: string;
  }): Promise<string>;
}

/** The parts of a host face that the dev server reads. */
export interface HostFaceView {
  readonly id: string;
  readonly assetSources?: readonly unknown[];
  readonly publishTargets?: readonly PublishTarget[];
  /** The importers of the plugin (the `Importer` of `@scenity/assets/import`; projectImporters.ts checks them). */
  readonly importers?: readonly unknown[];
}

const faces = new Map<string, Promise<HostFaceView[]>>();

function isFace(value: unknown): value is HostFaceView {
  return typeof value === "object" && value !== null && typeof (value as { id?: unknown }).id === "string";
}

async function load(dir: string): Promise<HostFaceView[]> {
  const found = await resolveProjectPlugins(dir).catch(() => null);
  if (found === null) return [];
  const all = await Promise.all(
    found.plugins.map(async (plugin) => {
      if (plugin.host === undefined) return [];
      try {
        const module = (await import(pathToFileURL(plugin.host).href)) as { default?: unknown };
        return isFace(module.default) ? [module.default] : [];
      } catch (error) {
        console.warn(`the host face ${plugin.host} does not load:`, error instanceof Error ? error.message : error);
        return [];
      }
    }),
  );
  return all.flat();
}

/** The host faces of the plugins of a project (none for a restricted project). */
export function projectHostFaces(name: string, dir: string): Promise<HostFaceView[]> {
  if (RESTRICTED_PROJECTS.has(name)) return Promise.resolve([]);
  let known = faces.get(dir);
  if (known === undefined) {
    known = load(dir);
    faces.set(dir, known);
  }
  return known;
}

/** Forget the host faces of a project folder (a plugin was added or removed, or the project became trusted). */
export function forgetHostFaces(dir: string): void {
  faces.delete(dir);
}
