// SPDX-License-Identifier: Apache-2.0
/**
 * The rules of the project on a dev server, a Vite plugin: `POST /projects/<name>/
 * rules.write` writes the rules of one file (`{ file, rules }`):
 *
 * - `scenity.project.json`: the rules in the `rules` list of the project (the names of the rules files stay).
 * - `<path>.rules.json`: the rules of a rules document. A new file gets its document, and the project names it.
 *
 * The schema of the rules checks them first. The write needs the import header and the same origin, as the import
 * does. The scene and the sequence of the page change their rules with their own edits (undo, save).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, join, relative } from "node:path";
import type { Plugin } from "vite";
import { canonicalJson, ruleListSchema, rulesPathSchema } from "@scenity/scene";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The request path of a write of rules, under `/projects/<name>/`. */
export const RULES_WRITE_PATH = "rules.write";
const PROJECT_FILE = "scenity.project.json";

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string };
type Json = Record<string, unknown>;

/** Write the rules of one file of the project folder `dir`. */
export function writeRules(dir: string, file: unknown, rules: unknown): Result {
  const checked = ruleListSchema.safeParse(rules);
  if (!checked.success) {
    const issue = checked.error.issues[0];
    return { ok: false, reason: `the rules do not read: /${issue?.path.join("/") ?? ""} ${issue?.message ?? ""}` };
  }
  const projectPath = join(dir, PROJECT_FILE);
  const project = JSON.parse(readFileSync(projectPath, "utf8")) as Json;
  const list = Array.isArray(project.rules) ? (project.rules as unknown[]) : [];
  if (file === PROJECT_FILE) {
    const names = list.filter((item) => typeof item === "string");
    const next = [...names, ...checked.data];
    project.rules = next.length === 0 ? undefined : next;
    writeFileSync(projectPath, canonicalJson(project));
    return { ok: true };
  }
  const path = rulesPathSchema.safeParse(file);
  if (!path.success || relative(dir, join(dir, path.data)).startsWith("..")) {
    return { ok: false, reason: `${String(file)} is not a rules file of the project (<name>.rules.json)` };
  }
  const target = join(dir, path.data);
  const old = existsSync(target) ? (JSON.parse(readFileSync(target, "utf8")) as Json) : null;
  const id = basename(path.data, ".rules.json").replaceAll(/[^A-Za-z0-9_-]/g, "-");
  const doc = { ...(old ?? { format: "scenity.rules/1", id }), rules: checked.data };
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, canonicalJson(doc));
  if (!list.includes(path.data)) {
    project.rules = [...list, path.data];
    writeFileSync(projectPath, canonicalJson(project));
  }
  return { ok: true };
}

async function handleWrite(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A rules write comes only from a page of this server." });
    return;
  }
  try {
    const input = (await readJson(request)) as Json;
    const result = writeRules(dir, input.file, input.rules);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityRulesApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-rules-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (dir !== undefined && match?.[2] === RULES_WRITE_PATH && request.method === "POST") {
          void handleWrite(request, response, dir);
        } else next();
      });
    },
  };
}
