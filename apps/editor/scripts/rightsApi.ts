// SPDX-License-Identifier: Apache-2.0
/**
 * The rights and the licence policy of a project on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/assets.licences.json`: the licence policy of the project (`release.licences`: the SPDX IDs
 *   that the release gate accepts, and the register file).
 * - `POST .../assets.licences.write`: a new list of SPDX IDs (`{ allow }`) into the project file.
 * - `POST .../assets.rights.assign`: one rights record for many assets (`{ ids, rights }`, where `rights` is relative
 *   to the project folder). Each record gets the path relative to its own folder.
 *
 * The writes need the import header and the same origin, as the import does. Put the plugin before `scenityProjects`.
 */
import { readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join, posix, relative } from "node:path";
import type { Plugin } from "vite";
import type * as AssetsIndex from "@scenity/assets";
import { canonicalJson, spdxIdSchema } from "@scenity/scene";
import {
  ASSET_LICENCES_PATH,
  ASSET_LICENCES_WRITE_PATH,
  ASSET_RIGHTS_ASSIGN_PATH,
  type LicencePolicy,
} from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

type Result = { readonly ok: true } | { readonly ok: false; readonly reason: string };
type Json = Record<string, unknown>;

const PROJECT_FILE = "scenity.project.json";
const isObject = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The licence policy of the project folder `dir`. */
export function licencePolicy(dir: string): LicencePolicy {
  const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE), "utf8")) as Json;
  const licences = isObject(project.release) && isObject(project.release.licences) ? project.release.licences : {};
  const allow = Array.isArray(licences.allow) ? licences.allow.filter((id) => typeof id === "string") : [];
  return { allow, register: typeof licences.register === "string" ? licences.register : null };
}

/** Write the SPDX IDs that the release gate of the project accepts. */
export function writeLicencePolicy(dir: string, allow: readonly unknown[]): Result {
  const ids: string[] = [];
  for (const id of allow) {
    const parsed = spdxIdSchema.safeParse(id);
    if (!parsed.success) return { ok: false, reason: `"${String(id)}" is not an SPDX licence ID` };
    if (!ids.includes(parsed.data)) ids.push(parsed.data);
  }
  const path = join(dir, PROJECT_FILE);
  const project = JSON.parse(readFileSync(path, "utf8")) as Json;
  const release = isObject(project.release) ? project.release : {};
  const licences = isObject(release.licences) ? release.licences : {};
  project.release = { ...release, licences: { ...licences, allow: ids } };
  writeFileSync(path, canonicalJson(project));
  return { ok: true };
}

/** Give one rights record (a path relative to the project folder) to each asset of `ids`. */
export async function assignRights(dir: string, ids: readonly unknown[], rights: unknown): Promise<Result> {
  if (typeof rights !== "string" || !/^rights\/[a-z0-9][a-z0-9-]*\.yaml$/.test(rights)) {
    return { ok: false, reason: "the rights record is rights/<name>.yaml" };
  }
  const { AssetDatabase, readAssetRecord, writeAssetRecord } = await assetsModule<typeof AssetsIndex>("");
  const db = await AssetDatabase.open(dir);
  const writes: [string, string][] = [];
  for (const id of ids) {
    const entry = typeof id === "string" ? db.get(id) : undefined;
    if (entry === undefined) return { ok: false, reason: `no asset ${String(id)}` };
    const path = join(dir, entry.recordPath);
    const read = readAssetRecord(readFileSync(path, "utf8"));
    if (!read.ok) return { ok: false, reason: `${entry.recordPath}: ${read.errors.map((e) => e.message).join("; ")}` };
    const link = relative(dirname(path), join(dir, rights)).split("\\").join(posix.sep);
    writes.push([path, writeAssetRecord({ ...read.record, rights: link })]);
  }
  // The code reads each record before the first write, so a bad record changes no file.
  for (const [path, text] of writes) writeFileSync(path, text);
  return { ok: true };
}

/** Answer a write: the licence policy or a rights assignment (a page of this server only). */
async function handleWrite(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  what: string,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A rights change comes only from a page of this server." });
    return;
  }
  try {
    const input = (await readJson(request)) as Json;
    const result =
      what === ASSET_LICENCES_WRITE_PATH
        ? writeLicencePolicy(dir, Array.isArray(input.allow) ? input.allow : [])
        : await assignRights(dir, Array.isArray(input.ids) ? input.ids : [], input.rights);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityRightsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-rights-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === ASSET_LICENCES_PATH && request.method === "GET") {
          try {
            sendJson(response, 200, licencePolicy(dir));
          } catch (error) {
            sendJson(response, 500, { reason: error instanceof Error ? error.message : String(error) });
          }
        } else if (
          dir !== undefined &&
          (what === ASSET_LICENCES_WRITE_PATH || what === ASSET_RIGHTS_ASSIGN_PATH) &&
          request.method === "POST"
        ) {
          void handleWrite(request, response, dir, what);
        } else next();
      });
    },
  };
}
