// SPDX-License-Identifier: Apache-2.0
/**
 * The asset database tools on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/assets.problems.json`: the problems of the asset database, each with the choices of its fix:
 *   for a missing source, the project files that can be the source (the same file name first: a moved file); for a
 *   broken reference, the assets that can take its place.
 * - `POST .../assets.fix`: a fix (`DatabaseFix`): a new source of a record (relink by name), a new asset of a reference
 *   in a document (relink by ID), or a new ID for a record (two records with one ID).
 *
 * The writes need the import header and the same origin, as the import does. Put the plugin before `scenityProjects`.
 */
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, dirname, extname, join, posix, relative } from "node:path";
import type { Plugin } from "vite";
import type * as AssetsIndex from "@scenity/assets";
import { canonicalJson } from "@scenity/scene";
import {
  ASSET_FIX_PATH,
  ASSET_PROBLEMS_PATH,
  type DatabaseFix,
  type DatabaseProblem,
} from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string };
/** The most choices of a fix. */
const CHOICES = 8;

/** The files under a folder of the project, relative to the project folder (no records, no dot folders). */
function filesUnder(dir: string, folder: string, out: string[] = []): string[] {
  const path = join(dir, folder);
  if (!existsSync(path)) return out;
  for (const item of readdirSync(path, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const child = folder === "" ? item.name : `${folder}/${item.name}`;
    if (item.isDirectory()) filesUnder(dir, child, out);
    else if (!item.name.endsWith(".meta.json")) out.push(child);
  }
  return out;
}

/** The files that can be the missing source: the same file name first, then the same extension. */
export function sourceChoices(files: readonly string[], missing: string): string[] {
  const name = basename(missing).toLowerCase();
  const extension = extname(missing).toLowerCase();
  const same = files.filter((file) => basename(file).toLowerCase() === name);
  const kin = files.filter((file) => !same.includes(file) && extname(file).toLowerCase() === extension);
  return [...same, ...kin].slice(0, CHOICES);
}

/** The asset kinds that a reference at a JSON Pointer takes, from the component of the pointer. */
function kindsAt(pointer: string): readonly string[] {
  if (pointer.includes("/components/model/")) return ["model", "skinned-model"];
  if (pointer.includes("/environment")) return ["environment"];
  if (pointer.includes("/material")) return ["material"];
  if (pointer.includes("/sound") || pointer.includes("/audio")) return ["audio"];
  return [];
}

/** The problems of the asset database of the project folder `dir`, with the choices of their fixes. */
export async function databaseProblems(dir: string): Promise<DatabaseProblem[]> {
  const { AssetDatabase } = await assetsModule<typeof AssetsIndex>("");
  const db = await AssetDatabase.open(dir);
  const files = db.roots.flatMap((root) => filesUnder(dir, root));
  const assets = db.entries().map((entry) => ({
    id: entry.id,
    name: basename(entry.sourcePath).replace(/\.[^.]+$/, ""),
    kind: entry.kind,
  }));
  return db.problems().map((problem) => {
    const entry = problem.id === undefined ? undefined : db.get(problem.id);
    const missing = problem.code === "missing-source" && entry !== undefined ? entry.sourcePath : null;
    const kinds = kindsAt(problem.pointer ?? "");
    const fits = (kind: string): number => (kinds.includes(kind) ? 0 : 1);
    return {
      code: problem.code,
      file: problem.file,
      pointer: problem.pointer ?? null,
      id: problem.id ?? null,
      message: problem.message,
      sources: missing === null ? [] : sourceChoices(files, missing),
      assets:
        problem.code === "broken-reference"
          ? [...assets].sort((a, b) => fits(a.kind) - fits(b.kind) || a.name.localeCompare(b.name)).slice(0, CHOICES)
          : [],
    };
  });
}

/** A JSON Pointer as its tokens. */
function tokensOf(pointer: string): string[] {
  return pointer
    .split("/")
    .slice(1)
    .map((token) => token.replaceAll("~1", "/").replaceAll("~0", "~"));
}

/** Set the value at a JSON Pointer of a JSON value; false when the parent does not exist. */
function setAt(root: unknown, pointer: string, value: unknown): boolean {
  const tokens = tokensOf(pointer);
  const last = tokens.pop();
  let at: unknown = root;
  for (const token of tokens) {
    if (typeof at !== "object" || at === null) return false;
    at = (at as Record<string, unknown>)[token];
  }
  if (last === undefined || typeof at !== "object" || at === null) return false;
  (at as Record<string, unknown>)[last] = value;
  return true;
}

/** Apply a fix to the project folder `dir`. */
export async function applyFix(dir: string, fix: DatabaseFix): Promise<Result> {
  const assets = await assetsModule<typeof AssetsIndex>("");
  const db = await assets.AssetDatabase.open(dir);
  if (fix.action === "reference") {
    if (db.get(fix.id) === undefined) return { ok: false, reason: `no asset ${fix.id}` };
    const path = join(dir, fix.file);
    if (!existsSync(path) || relative(dir, path).startsWith(".."))
      return { ok: false, reason: `no document ${fix.file}` };
    const doc = JSON.parse(readFileSync(path, "utf8")) as unknown;
    const old: unknown = tokensOf(fix.pointer).reduce<unknown>(
      (at, token) => (typeof at === "object" && at !== null ? (at as Record<string, unknown>)[token] : undefined),
      doc,
    );
    const anchor = typeof old === "string" && old.includes("#") ? old.slice(old.indexOf("#")) : "";
    if (!setAt(doc, fix.pointer, `asset:${fix.id}${anchor}`))
      return { ok: false, reason: `no value at ${fix.pointer}` };
    writeFileSync(path, canonicalJson(doc));
    return { ok: true };
  }
  const recordFile = fix.action === "source" ? db.get(fix.id)?.recordPath : fix.file;
  if (recordFile === undefined) return { ok: false, reason: "no record for the fix" };
  const path = join(dir, recordFile);
  const read = assets.readAssetRecord(readFileSync(path, "utf8"));
  if (!read.ok) return { ok: false, reason: read.errors.map((error) => error.message).join("; ") };
  if (fix.action === "source") {
    if (!existsSync(join(dir, fix.source))) return { ok: false, reason: `no file ${fix.source}` };
    const source = relative(dirname(path), join(dir, fix.source)).split("\\").join(posix.sep);
    writeFileSync(path, assets.writeAssetRecord({ ...read.record, source }));
  } else {
    const id = assets.newAssetId(assets.systemIdSource);
    writeFileSync(path, assets.writeAssetRecord({ ...read.record, id }));
  }
  return { ok: true };
}

async function handleFix(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A fix comes only from a page of this server." });
    return;
  }
  try {
    const result = await applyFix(dir, (await readJson(request)) as DatabaseFix);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityAssetTools(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-asset-tools",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === ASSET_PROBLEMS_PATH && request.method === "GET") {
          void databaseProblems(dir).then(
            (problems) => sendJson(response, 200, problems),
            (error: unknown) => sendJson(response, 500, { reason: String(error) }),
          );
        } else if (dir !== undefined && what === ASSET_FIX_PATH && request.method === "POST") {
          void handleFix(request, response, dir);
        } else next();
      });
    },
  };
}
