// SPDX-License-Identifier: Apache-2.0
/**
 * The projects of the studio host. The host writes the open projects to a file and names it in
 * `SCENITY_SCENE_PROJECTS_FILE`. The scene server reads the file at start and watches it. A change adds the new
 * projects to the project record of the server and removes the projects that the file no longer holds, with no
 * restart. The plugins of the server read the record at each request. The page loads the plugins of a project that
 * the file added later from a module of its own (sceneProjectPlugins.ts).
 */
import { existsSync, readFileSync, watch, type FSWatcher } from "node:fs";
import { dirname, isAbsolute } from "node:path";
import type { Plugin } from "vite";

/** The variable that names the projects file. */
export const PROJECTS_FILE_ENV = "SCENITY_SCENE_PROJECTS_FILE";
/** The format of the projects file. */
export const PROJECTS_FILE_FORMAT = "scenity.studio-projects/1";

/**
 * The projects that the owner did not trust. The scene server gives them no plugin code
 * (sceneProjectPlugins.ts). Their scenes load, and a component of a plugin stays in the file with a warning.
 */
export const RESTRICTED_PROJECTS = new Set<string>();

/** The projects of a projects file. */
export interface ProjectsFileData {
  readonly projects: Record<string, string>;
  readonly restricted: ReadonlySet<string>;
}

/**
 * The projects of the file: a name maps to its folder, or to `{ dir, restricted }`. A pair with a bad name or a
 * relative folder is left out. A bad file gives none.
 */
export function readProjectsFile(file: string): ProjectsFileData {
  const none = { projects: {}, restricted: new Set<string>() };
  if (!existsSync(file)) return none;
  try {
    const data = JSON.parse(readFileSync(file, "utf8")) as { format?: unknown; projects?: unknown };
    if (data.format !== PROJECTS_FILE_FORMAT || typeof data.projects !== "object" || data.projects === null)
      return none;
    const projects: Record<string, string> = {};
    const restricted = new Set<string>();
    for (const [name, value] of Object.entries(data.projects)) {
      const entry =
        typeof value === "string"
          ? { dir: value, restricted: false }
          : (value as { dir?: unknown; restricted?: unknown });
      if (!/^[a-z0-9-]+$/.test(name) || typeof entry.dir !== "string" || !isAbsolute(entry.dir)) continue;
      projects[name] = entry.dir;
      if (entry.restricted === true) restricted.add(name);
    }
    return { projects, restricted };
  } catch {
    return none;
  }
}

/**
 * Put the projects of `next` into `record`: add or change each one, and remove the names of `owned` that `next` no
 * longer holds. The other names of the record (the samples, the projects of the variable) stay. Returns the new
 * set of owned names.
 */
export function mergeProjects(
  record: Record<string, string>,
  owned: ReadonlySet<string>,
  next: Readonly<Record<string, string>>,
): Set<string> {
  for (const name of owned) if (!(name in next)) Reflect.deleteProperty(record, name);
  for (const [name, dir] of Object.entries(next)) record[name] = dir;
  return new Set(Object.keys(next));
}

/** The modules of the plugins of all the projects (sceneProjectPlugins.ts `PROJECT_PLUGINS_MODULE`, the studio faces). */
const ALL_PROJECTS_MODULES = ["\0virtual:scenity/project-plugins", "\0virtual:scenity/project-studio"];

/** The module ID of the plugins of one project (sceneProjectPlugins.ts `PROJECT_PLUGINS_OF`). */
const lateModule = (name: string): string => `\0virtual:scenity/project-plugins-of/${name}`;

/**
 * The plugin: it reads `file` into `record` at the start of the dev server and after each change of the file. A
 * project whose folder or restriction changed gets its plugin module again; the other pages do not reload. A
 * project of the file with the name of a project of the start (a copy of a sample of the checkout) also makes the
 * modules of all the projects again, because they name the folder of the start for that name.
 */
export function scenityProjectsFile(record: Record<string, string>, file: string | undefined): Plugin {
  let owned = new Set<string>();
  let watcher: FSWatcher | null = null;
  return {
    name: "scenity:projects-file",
    apply: "serve",
    configureServer(server) {
      if (file === undefined) return;
      const reload = (): void => {
        const next = readProjectsFile(file);
        const changed = Object.keys(next.projects).filter(
          (name) => record[name] !== next.projects[name] || RESTRICTED_PROJECTS.has(name) !== next.restricted.has(name),
        );
        const overrides = changed.some((name) => !owned.has(name) && Object.hasOwn(record, name));
        owned = mergeProjects(record, owned, next.projects);
        RESTRICTED_PROJECTS.clear();
        for (const name of next.restricted) RESTRICTED_PROJECTS.add(name);
        const ids = [...changed.map(lateModule), ...(overrides ? ALL_PROJECTS_MODULES : [])];
        for (const id of ids) {
          const module = server.moduleGraph.getModuleById(id);
          if (module !== undefined) server.moduleGraph.invalidateModule(module);
        }
      };
      reload();
      // The host writes the file through a temp file and a rename, so the watch is on its folder.
      watcher = watch(dirname(file), (_event, name) => {
        if (name !== null && file.endsWith(`/${name}`)) reload();
      });
      server.httpServer?.on("close", () => watcher?.close());
    },
  };
}
