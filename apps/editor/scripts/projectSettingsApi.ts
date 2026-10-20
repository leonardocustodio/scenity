// SPDX-License-Identifier: Apache-2.0
/**
 * The Project settings window on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/project.settings.json`: the project file, the JSON Schema of the project file and the checks
 *   of the files (each scene, sequence and asset root of the lists is in the project folder).
 * - `POST /projects/<name>/project.settings.write`: `{ project }`. The reader of `@scenity/scene` checks the value. A
 *   value that passes goes into the project file as canonical JSON. A value that does not pass gives the issues.
 *
 * The post needs the import header and the same origin, as the import does.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { canonicalJson, documentJsonSchemas, projectSchema } from "@scenity/scene";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";
import {
  PROJECT_SETTINGS_PATH,
  PROJECT_SETTINGS_WRITE_PATH,
  type ServerCheck,
} from "../src/scene/projectSettings/projectRoutes.ts";

const PROJECT_FILE = "scenity.project.json";
type Json = Readonly<Record<string, unknown>>;

const stringsOf = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];

/** The checks of the files of the lists: each path is in the project folder and exists. */
export function fileChecks(dir: string, project: unknown): ServerCheck[] {
  const value = (typeof project === "object" && project !== null ? project : {}) as Json;
  const checks: ServerCheck[] = [];
  for (const list of ["scenes", "sequences", "assets"]) {
    stringsOf(value[list]).forEach((path, index) => {
      const full = resolve(dir, path);
      const inside = !relative(dir, full).startsWith("..");
      if (!inside || !existsSync(full))
        checks.push({ path: `${list}[${String(index)}]`, kind: "missing", detail: path });
    });
  }
  return checks;
}

/** The issues of the reader for a project value (none: the value passes). */
export function schemaChecks(project: unknown): ServerCheck[] {
  const parsed = projectSchema.safeParse(project);
  if (parsed.success) return [];
  return parsed.error.issues.map((issue) => ({
    path: issue.path
      .map((step) => (typeof step === "number" ? `[${String(step)}]` : `.${String(step)}`))
      .join("")
      .replace(/^\./, ""),
    kind: "schema",
    detail: issue.message,
  }));
}

/** The answer of a read. */
export function readSettings(dir: string): Record<string, unknown> {
  const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE), "utf8")) as unknown;
  return {
    file: PROJECT_FILE,
    project,
    schema: documentJsonSchemas().project,
    checks: [...schemaChecks(project), ...fileChecks(dir, project)],
  };
}

/** Write a project value that the reader accepts. Else give its issues. */
export function writeSettings(dir: string, project: unknown): { ok: boolean; checks: ServerCheck[] } {
  const issues = schemaChecks(project);
  if (issues.length > 0) return { ok: false, checks: issues };
  writeFileSync(join(dir, PROJECT_FILE), canonicalJson(project));
  return { ok: true, checks: fileChecks(dir, project) };
}

async function handleWrite(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, {
      ok: false,
      checks: [],
      reason: "The project file changes only from a page of this server.",
    });
    return;
  }
  try {
    const input = (await readJson(request)) as { project?: unknown };
    const result = writeSettings(dir, input.project);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 400, { ok: false, checks: [], reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityProjectSettingsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-project-settings-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (dir !== undefined && match?.[2] === PROJECT_SETTINGS_PATH && request.method === "GET") {
          try {
            sendJson(response, 200, readSettings(dir));
          } catch (error) {
            sendJson(response, 500, { reason: error instanceof Error ? error.message : String(error) });
          }
        } else if (dir !== undefined && match?.[2] === PROJECT_SETTINGS_WRITE_PATH && request.method === "POST") {
          void handleWrite(request, response, dir);
        } else next();
      });
    },
  };
}
