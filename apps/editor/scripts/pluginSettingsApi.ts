// SPDX-License-Identifier: Apache-2.0
/**
 * The project settings of the plugins (the `settings` point with `scope: "project"`): the values of each plugin in
 * `.scenity/plugin-settings.json` of the project folder (shared through Git with the project). The section of a plugin
 * in Project settings reads and writes them. The values of the person stay in the browser.
 *
 * - `GET  /projects/<name>/plugin.settings.json` gives `{ values: { <plugin>: { … } } }`.
 * - `POST /projects/<name>/plugin.settings.write` with `{ plugin, values }` writes the values of one plugin.
 *
 * A write needs the import header of the page and no remote client. A restricted project refuses it.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { RESTRICTED_PROJECTS } from "./projectsFile.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The file of the values, relative to the project folder. */
export const PLUGIN_SETTINGS_FILE = ".scenity/plugin-settings.json";
const PLUGIN_ID = /^[a-z][a-z0-9-]*$/;

type Values = Readonly<Record<string, Readonly<Record<string, unknown>>>>;

/** The values of each plugin of a project folder (none with no file or a file that does not read). */
export function readPluginSettings(dir: string): Values {
  const file = join(dir, PLUGIN_SETTINGS_FILE);
  if (!existsSync(file)) return {};
  try {
    const value = JSON.parse(readFileSync(file, "utf8")) as unknown;
    return typeof value === "object" && value !== null && !Array.isArray(value) ? (value as Values) : {};
  } catch {
    return {};
  }
}

/** Write the values of one plugin; the reason of a refusal, or null. */
export function writePluginSettings(dir: string, plugin: unknown, values: unknown): string | null {
  if (typeof plugin !== "string" || !PLUGIN_ID.test(plugin)) return "the plugin ID is a lower-case word";
  if (typeof values !== "object" || values === null || Array.isArray(values)) return "the values are an object";
  const file = join(dir, PLUGIN_SETTINGS_FILE);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, canonicalJson({ ...readPluginSettings(dir), [plugin]: values }));
  return null;
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityPluginSettingsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-plugin-settings-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/plugin\.settings\.(json|write)$/.exec(
          (request.url ?? "").split("?")[0] ?? "",
        );
        const name = match?.[1] ?? "";
        const dir = Object.hasOwn(projects, name) ? projects[name] : undefined;
        if (dir === undefined || match === null) {
          next();
          return;
        }
        if (match[2] === "json" && request.method === "GET") {
          sendJson(response, 200, { values: readPluginSettings(dir) });
          return;
        }
        if (match[2] !== "write" || request.method !== "POST") {
          next();
          return;
        }
        if (!sameOriginImport(request) || isRemote(process.env) || RESTRICTED_PROJECTS.has(name)) {
          sendJson(response, 403, { ok: false, reason: "This page cannot change the settings of the plugins." });
          return;
        }
        void readJson(request)
          .catch(() => ({}))
          .then((input) => {
            const body = input as { plugin?: unknown; values?: unknown };
            const reason = writePluginSettings(dir, body.plugin, body.values);
            sendJson(response, reason === null ? 200 : 400, reason === null ? { ok: true } : { ok: false, reason });
          });
      });
    },
  };
}
