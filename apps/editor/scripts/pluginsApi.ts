// SPDX-License-Identifier: Apache-2.0
/**
 * The Plugins window on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/plugins.json`: each entry of the `plugins` field of the project with its package (the name,
 *   the version, the description), its faces and the error of an entry that does not resolve. Also the plugins of the
 *   checkout that the project does not list (`plugins/<name>/<face>` folders with a `scenity` field), each with the
 *   entry that adds it (a folder path relative to the project).
 * - `POST /projects/<name>/plugins.add` and `plugins.remove`: `{ entry }`. The entry must resolve. The project file gets
 *   the new list as canonical JSON. The page loads the plugins again after a reload.
 * - `POST /projects/<name>/plugins.new`: a `PluginRequest` of the wizard (pluginScaffold.ts). The files go
 *   into `plugins/<id>/` of the project, and the project lists `./plugins/<id>`. The answer names the files.
 *
 * The posts need the import header and the same origin, as the import does. The plugins of a restricted project do not
 * change.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { resolvePluginEntries } from "@scenity/cli/plugins";
import { canonicalJson } from "@scenity/scene";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { forgetHostFaces } from "./hostFaces.ts";
import { isRemote } from "./labsFs.ts";
import { forgetSources } from "./sourcesApi.ts";
import { pluginFiles, requestProblem, type PluginRequest } from "./pluginScaffold.ts";
import { RESTRICTED_PROJECTS } from "./projectsFile.ts";
import { readJson, sendJson } from "./serverParts.ts";

const PROJECT_FILE = "scenity.project.json";
/** The plugins folder of the checkout. */
const CHECKOUT_PLUGINS = resolve(dirname(fileURLToPath(import.meta.url)), "../../../plugins");
const FACES = ["runtime", "host", "dev", "studio", "editor", "cli"] as const;

type Json = Readonly<Record<string, unknown>>;

/** The package.json of a folder, or null. */
function packageOf(dir: string): Json | null {
  try {
    return JSON.parse(readFileSync(join(dir, "package.json"), "utf8")) as Json;
  } catch {
    return null;
  }
}

/** One entry of the project with its package, its faces and its error. */
export interface PluginRow {
  readonly entry: string;
  readonly name: string | null;
  readonly version: string | null;
  readonly description: string | null;
  readonly faces: readonly string[];
  readonly error: string | null;
}

/** The rows of the entries of a project folder. */
export function pluginRows(dir: string, entries: readonly string[]): PluginRow[] {
  return entries.map((entry) => {
    try {
      const [found] = resolvePluginEntries([entry], dir);
      const pack = found === undefined ? null : packageOf(found.dir);
      const faces = FACES.filter((face) => found?.[face as keyof typeof found] !== undefined);
      const text = (key: string): string | null => (typeof pack?.[key] === "string" ? pack[key] : null);
      return {
        entry,
        name: text("name"),
        version: text("version"),
        description: text("description"),
        faces,
        error: null,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      return { entry, name: null, version: null, description: null, faces: [], error: reason };
    }
  });
}

/** The plugins of the checkout (each folder `plugins/<name>/<face>` with a `scenity` field) with their entries. */
export function checkoutPlugins(
  dir: string,
  root = CHECKOUT_PLUGINS,
): { entry: string; name: string; description: string | null }[] {
  if (!existsSync(root)) return [];
  return readdirSync(root).flatMap((plugin) => {
    const folder = join(root, plugin);
    if (!statSync(folder).isDirectory()) return [];
    return readdirSync(folder).flatMap((face) => {
      const pack = packageOf(join(folder, face));
      if (pack === null || typeof pack.scenity !== "object") return [];
      const path = relative(dir, join(folder, face)).split(sep).join("/");
      return [
        {
          entry: path.startsWith(".") ? path : `./${path}`,
          name: typeof pack.name === "string" ? pack.name : `${plugin}/${face}`,
          description: typeof pack.description === "string" ? pack.description : null,
        },
      ];
    });
  });
}

/** The entries of the project file of a folder. */
function entriesOf(dir: string): string[] {
  const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE), "utf8")) as { plugins?: unknown };
  return Array.isArray(project.plugins)
    ? project.plugins.filter((item): item is string => typeof item === "string")
    : [];
}

/** The answer of a list request. */
export function pluginsAnswer(dir: string): Record<string, unknown> {
  const entries = entriesOf(dir);
  const rows = pluginRows(dir, entries);
  const listed = new Set(rows.map((row) => row.name).filter((name) => name !== null));
  const sameDir = new Set(entries.map((entry) => resolve(dir, entry)));
  const available = checkoutPlugins(dir).filter(
    (item) => !listed.has(item.name) && !sameDir.has(resolve(dir, item.entry)),
  );
  return { plugins: rows, available };
}

/** Make a new folder plugin in the project and list it. Gives the files (relative to the project), or a reason. */
export function newPlugin(dir: string, input: unknown): { files: string[] } | { reason: string } {
  const value = (typeof input === "object" && input !== null ? input : {}) as Partial<PluginRequest>;
  const request: PluginRequest = {
    id: typeof value.id === "string" ? value.id : "",
    component: typeof value.component === "string" ? value.component : "",
    fields: Array.isArray(value.fields) ? value.fields : [],
    parts: Array.isArray(value.parts) ? value.parts : [],
  };
  const problem = requestProblem(request);
  if (problem !== null) return { reason: problem };
  const folder = join(dir, "plugins", request.id);
  if (existsSync(folder)) return { reason: `the folder plugins/${request.id} is there already` };
  const files = pluginFiles(request);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(folder, path)), { recursive: true });
    writeFileSync(join(folder, path), text);
  }
  const reason = changePlugins(dir, "add", `./plugins/${request.id}`);
  return reason === null ? { files: Object.keys(files).map((path) => `plugins/${request.id}/${path}`) } : { reason };
}

/** Add or remove an entry; the reason of a refusal, or null. */
export function changePlugins(dir: string, action: "add" | "remove", entry: unknown): string | null {
  if (typeof entry !== "string" || entry.trim() === "") return "the entry is a package name or a folder path";
  const path = join(dir, PROJECT_FILE);
  const project = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  const entries = entriesOf(dir);
  if (action === "add") {
    if (entries.includes(entry)) return "the project has this plugin already";
    const [row] = pluginRows(dir, [entry]);
    if (row?.error !== null) return row?.error ?? "the entry does not resolve";
    project.plugins = [...entries, entry];
  } else {
    if (!entries.includes(entry)) return "the project has no such plugin";
    project.plugins = entries.filter((item) => item !== entry);
  }
  writeFileSync(path, canonicalJson(project));
  return null;
}

async function handlePost(
  request: IncomingMessage,
  response: ServerResponse,
  name: string,
  dir: string,
  what: string,
  changed: () => void,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "The plugins change only from a page of this server." });
    return;
  }
  if (RESTRICTED_PROJECTS.has(name)) {
    sendJson(response, 403, {
      ok: false,
      reason: "A restricted project has no change of its plugins: trust it first.",
    });
    return;
  }
  const input = (await readJson(request).catch(() => ({}))) as { entry?: unknown };
  if (what === "plugins.new") {
    const made = newPlugin(dir, input);
    if ("files" in made) changed();
    sendJson(
      response,
      "files" in made ? 200 : 400,
      "files" in made ? { ok: true, files: made.files } : { ok: false, reason: made.reason },
    );
    return;
  }
  const reason = changePlugins(dir, what === "plugins.add" ? "add" : "remove", input.entry);
  if (reason === null) changed();
  sendJson(response, reason === null ? 200 : 400, reason === null ? { ok: true } : { ok: false, reason });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityPluginsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-plugins-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(plugins\.json|plugins\.add|plugins\.remove|plugins\.new)$/.exec(
          (request.url ?? "").split("?")[0] ?? "",
        );
        const name = match?.[1] ?? "";
        const dir = Object.hasOwn(projects, name) ? projects[name] : undefined;
        if (dir === undefined || match === null) next();
        else if (match[2] === "plugins.json" && request.method === "GET") {
          try {
            sendJson(response, 200, pluginsAnswer(dir));
          } catch (error) {
            sendJson(response, 500, { reason: error instanceof Error ? error.message : String(error) });
          }
        } else if (request.method === "POST" && match[2] !== "plugins.json")
          void handlePost(request, response, name, dir, match[2] ?? "", () => {
            // The host faces and the asset sources of the project are parts of its plugins.
            forgetHostFaces(dir);
            forgetSources(dir);
            // The next load makes the module of the project plugins again (also with no watch of the files).
            for (const module of server.moduleGraph.idToModuleMap.values())
              if (/virtual:scenity\/project-(plugins|studio)/.test(module.id ?? ""))
                server.moduleGraph.invalidateModule(module);
          });
        else next();
      });
    },
  };
}
