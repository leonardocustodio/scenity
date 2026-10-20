// SPDX-License-Identifier: Apache-2.0
/**
 * The hot reload of the assets of the scene page, a Vite plugin of the dev server.
 *
 * - The first request for a file of a project (`/projects/<name>/…`) opens the asset database of that project
 *   (`@scenity/assets`) and its watcher. The watcher sees the sources under the asset roots, the files that a
 *   source names (the images and buffers of a glTF file) and the asset records (`*.meta.json`).
 * - A change runs the import of each changed asset into `.scenity/imports/<id>/`, one self-contained file. The page
 *   then loads the import, not the build, so a dev reload needs no asset build. When the import fails, the page
 *   loads the source if it can (glTF, GLB, HDR, an image).
 * - Then the plugin sends the custom HMR event `scenity:asset-reload` with the asset ID, the file to load and its
 *   version (the import key, else the source hash). The page puts the version in the file URL, so no cache gives the
 *   old bytes (src/scene/hotReload.ts).
 *
 * Only the dev server has the plugin (`apply: "serve"`). Put it before `scenityProjects`, because that plugin answers
 * the project requests itself.
 */
import { extname, isAbsolute } from "node:path";
import type { Plugin, ViteDevServer } from "vite";
import type { AssetDatabase, AssetEntry, AssetWatcher } from "@scenity/assets";
import type * as ImportRun from "@scenity/assets/import";
import { projectImporters } from "./projectImporters.ts";
import { assetsModule } from "./assetsModule.ts";

type DatabaseModule = { readonly AssetDatabase: typeof AssetDatabase };
type ImportModule = typeof ImportRun;

/**
 * The variable of more projects for the dev server: `name=/abs/folder[,name=/abs/folder]`. The e2e test of the hot reload
 * serves a copy of the showroom in a temp folder, so the files of the repository never change.
 */
export const SCENE_PROJECTS_ENV = "SCENITY_SCENE_PROJECTS";

/** The projects of the variable: a pair with a bad name or a relative folder is left out. */
export function projectsFromEnv(value: string | undefined): Record<string, string> {
  const projects: Record<string, string> = {};
  for (const pair of (value ?? "").split(",")) {
    const at = pair.indexOf("=");
    const name = pair.slice(0, at).trim();
    const dir = pair.slice(at + 1).trim();
    if (at > 0 && /^[a-z0-9-]+$/.test(name) && isAbsolute(dir)) projects[name] = dir;
  }
  return projects;
}

/** The custom HMR event of a reload. Its data is an `AssetReloadEvent`. */
export const ASSET_RELOAD_EVENT = "scenity:asset-reload";

/** The data of the event. Each path is relative to the project folder. */
export interface AssetReloadEvent {
  readonly project: string;
  readonly id: string;
  readonly kind: string;
  /** The version of the file: the first 16 hex digits of the import key, else of the source hash. */
  readonly version: string;
  /** The file to load: the main file of the import, else the source. */
  readonly file: string;
  /** The time of the import and the hash on the server, in milliseconds. */
  readonly ms: number;
  readonly warnings: readonly string[];
}

/** The result of an import that the event needs: the key, the output folder (project path) and the files in it. */
export interface ImportedFiles {
  readonly key: string;
  readonly folder: string;
  readonly files: readonly string[];
  readonly warnings: readonly string[];
}

/** The source types that the page loads with no import. */
const LOADABLE = new Set([".gltf", ".glb", ".hdr", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".ktx2"]);

/** The event of a changed asset, or null when the page has no file to load (no import and no loadable source). */
export function reloadEvent(
  project: string,
  entry: Pick<AssetEntry, "id" | "kind" | "sourcePath" | "hash">,
  imported: ImportedFiles | null,
  warnings: readonly string[],
  ms: number,
): AssetReloadEvent | null {
  const base = { project, id: entry.id, kind: entry.kind, ms };
  const main = imported?.files[0];
  if (imported !== null && main !== undefined) {
    const all = [...imported.warnings, ...warnings];
    return { ...base, version: imported.key.slice(0, 16), file: `${imported.folder}/${main}`, warnings: all };
  }
  if (entry.hash === null || !LOADABLE.has(extname(entry.sourcePath).toLowerCase())) return null;
  return { ...base, version: entry.hash.slice(0, 16), file: entry.sourcePath, warnings };
}

/**
 * Run the import of an asset with the importers of the project (also the importers of its plugins). A failed
 * import gives null and the reason in `warnings`.
 */
async function runImport(
  project: string,
  dir: string,
  entry: AssetEntry,
  warnings: string[],
): Promise<ImportedFiles | null> {
  try {
    // The importers load glTF Transform and Blender helpers. They load at the first project request, not at the server
    // start.
    const { importAsset, DEFAULT_IMPORT_ROOT } = await assetsModule<ImportModule>("import");
    const { stamp } = await importAsset(dir, entry.recordPath, { registry: await projectImporters(project, dir) });
    return {
      key: stamp.key,
      folder: `${DEFAULT_IMPORT_ROOT}/${entry.id}`,
      files: stamp.files,
      warnings: stamp.warnings,
    };
  } catch (error) {
    warnings.push(`the import failed: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Open the asset database of a project and send an event for each asset that changes. */
async function watchAssets(server: ViteDevServer, project: string, dir: string): Promise<AssetWatcher | null> {
  const logger = server.config.logger;
  let db: AssetDatabase;
  try {
    const { AssetDatabase: Database } = await assetsModule<DatabaseModule>("");
    db = await Database.open(dir);
  } catch (error) {
    logger.warn(`[scenity] no hot reload of the assets of ${project}: ${String(error)}`);
    return null;
  }
  // Load the importers now, so that the first change does not wait for them.
  void assetsModule<ImportModule>("import");
  const sent = new Map<string, string>();
  const reload = async (id: string): Promise<void> => {
    const entry = db.get(id);
    if (entry === undefined) return;
    const start = performance.now();
    const warnings: string[] = [];
    const imported = await runImport(project, dir, entry, warnings);
    const event = reloadEvent(project, entry, imported, warnings, Math.round(performance.now() - start));
    if (event === null) {
      logger.warn(`[scenity] ${project}: no file to load for the asset ${id}: ${warnings.join("; ")}`);
      return;
    }
    if (sent.get(id) === event.version) return;
    sent.set(id, event.version);
    server.ws.send({ type: "custom", event: ASSET_RELOAD_EVENT, data: event });
    logger.info(`[scenity] ${project}: asset ${id} reloaded from ${event.file} (${String(event.ms)} ms)`);
  };
  let queue = Promise.resolve();
  return db.watch((ids) => {
    queue = queue.then(async () => {
      for (const id of ids) await reload(id);
    });
  });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityAssetReload(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-asset-reload",
    apply: "serve",
    configureServer(server) {
      const watchers = new Map<string, Promise<AssetWatcher | null>>();
      server.middlewares.use((request, _response, next) => {
        const name = /^\/projects\/([a-z0-9-]+)\//.exec(request.url ?? "")?.[1];
        const dir = name === undefined ? undefined : projects[name];
        if (name !== undefined && dir !== undefined && !watchers.has(name)) {
          watchers.set(name, watchAssets(server, name, dir));
        }
        next();
      });
      server.httpServer?.on("close", () => {
        for (const watcher of watchers.values()) void watcher.then((open) => open?.close());
      });
    },
  };
}
