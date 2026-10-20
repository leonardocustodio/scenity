// SPDX-License-Identifier: Apache-2.0
/**
 * The requests of the asset browser on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/assets.list.json`: the asset list of the project (scripts/assetApi.ts `listAssets`).
 * - `POST /projects/<name>/assets.import`: the bytes of one file, with its name in the name header. The server
 *   imports it (`importFile`) and answers with the new list entry. The options header gives the settings of
 *   the importer, the rights record and the folder.
 * - `GET /projects/<name>/assets.importers.json` (the importers with the JSON Schema of their settings) and
 *   `GET /projects/<name>/assets.rights.json` (the rights records of the project). `POST .../assets.rights.write`
 *   writes a new rights record (`RightsInput` as JSON, with the import header).
 * - `GET /projects/<name>/assets.asset.json?id=<ID>` (the details of one asset, scripts/assetDetails.ts) and
 *   `POST .../assets.reimport` (an import again: `ReimportInput` as JSON, with the import header).
 *
 * The server refuses an import without the import header or from another origin (a page of another site cannot
 * write). It also refuses a body over the limit, and each import in the remote mode of the workbench (as the save
 * does).
 * Only the dev server has the plugin (`apply: "serve"`). Put it before `scenityProjects`, which answers the other
 * project requests.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import {
  ASSET_DETAILS_PATH,
  ASSET_HEALTH_PATH,
  ASSET_IMPORT_PATH,
  ASSET_IMPORTERS_PATH,
  ASSET_LIST_PATH,
  ASSET_REIMPORT_PATH,
  ASSET_RIGHTS_PATH,
  ASSET_RIGHTS_WRITE_PATH,
  IMPORT_HEADER,
  NAME_HEADER,
  OPTIONS_HEADER,
  type ImportOptions,
  type ReimportInput,
  type RightsInput,
} from "../src/assetBrowser/assetTypes.ts";
import { assetHealth, importerForms, importFile, listAssets, rightsRecords, writeRights } from "./assetApi.ts";
import { assetDetails, reimportAsset } from "./assetDetails.ts";
import { projectImporters } from "./projectImporters.ts";
import type { ImporterRegistry } from "@scenity/assets/import";
import { isRemote } from "./labsFs.ts";

/** The largest file of an import (bytes). */
export const IMPORT_LIMIT = 64 * 1024 * 1024;

type Env = Readonly<Record<string, string | undefined>>;

/** True when the request comes from a page of this server: the import header and the same origin. */
export function sameOriginImport(request: Pick<IncomingMessage, "headers">): boolean {
  const { origin, host } = request.headers;
  return request.headers[IMPORT_HEADER] === "1" && typeof host === "string" && origin === `http://${host}`;
}

function readBytes(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    request.on("data", (part: Buffer) => {
      size += part.length;
      if (size > IMPORT_LIMIT) {
        reject(new Error(`the file is larger than ${String(IMPORT_LIMIT / (1024 * 1024))} MB`));
        request.destroy();
      } else parts.push(part);
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(parts))));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

/** The decoded file name of the name header, or null. */
function headerName(request: IncomingMessage): string | null {
  const value = request.headers[NAME_HEADER];
  if (typeof value !== "string") return null;
  try {
    return decodeURIComponent(value);
  } catch {
    return null;
  }
}

/** The options of an import from its header (no header: the defaults). A header that does not read gives null. */
function headerOptions(request: IncomingMessage): ImportOptions | null {
  const value = request.headers[OPTIONS_HEADER];
  if (value === undefined) return {};
  if (typeof value !== "string") return null;
  try {
    const parsed = JSON.parse(decodeURIComponent(value)) as unknown;
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/** The importers of a project: the built-in ones and the ones of its plugins (projectImporters.ts). */
type Importers = () => Promise<ImporterRegistry>;

/** Answer an import request for the project folder `dir`. */
export async function handleAssetImport(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  env: Env = process.env,
  importers?: Importers,
): Promise<void> {
  if (isRemote(env)) {
    send(response, 403, { ok: false, reason: "In the remote mode the workbench host imports the assets." });
    return;
  }
  if (!sameOriginImport(request)) {
    send(response, 403, { ok: false, reason: "An import comes only from a page of this server." });
    return;
  }
  const name = headerName(request);
  if (name === null) {
    send(response, 400, { ok: false, reason: "The import has no file name." });
    return;
  }
  const options = headerOptions(request);
  if (options === null) {
    send(response, 400, { ok: false, reason: "The options of the import are not JSON." });
    return;
  }
  try {
    const registry = await importers?.();
    const result = await importFile(dir, name, await readBytes(request), {
      ...options,
      ...(registry === undefined ? {} : { registry }),
    });
    send(response, result.ok ? 200 : 400, result);
  } catch (error) {
    send(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Answer a write of a rights record for the project folder `dir` (a page of this server only). */
export async function handleRightsWrite(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    send(response, 403, { ok: false, reason: "A rights record comes only from a page of this server." });
    return;
  }
  try {
    const input = JSON.parse(new TextDecoder().decode(await readBytes(request))) as RightsInput;
    const result = await writeRights(dir, input);
    send(response, result.ok ? 200 : 400, result);
  } catch (error) {
    send(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Answer an import again for the project folder `dir` (a page of this server only). */
export async function handleReimport(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  importers?: Importers,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    send(response, 403, { ok: false, reason: "An import comes only from a page of this server." });
    return;
  }
  try {
    const input = JSON.parse(new TextDecoder().decode(await readBytes(request))) as ReimportInput;
    const result = await reimportAsset(dir, input, await importers?.());
    send(response, result.ok ? 200 : 400, result);
  } catch (error) {
    send(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Answer a details request (`?id=<ID>`) for the project folder `dir`. */
export async function handleAssetDetails(url: string, response: ServerResponse, dir: string): Promise<void> {
  const id = new URL(url, "http://localhost").searchParams.get("id") ?? "";
  try {
    const details = await assetDetails(dir, id);
    if (details === null) send(response, 404, { reason: `no asset ${id}` });
    else send(response, 200, details);
  } catch (error) {
    send(response, 500, { reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Answer a list request for the project folder `dir`. */
export async function handleAssetList(response: ServerResponse, dir: string, importers?: Importers): Promise<void> {
  try {
    send(response, 200, await listAssets(dir, await importers?.()));
  } catch (error) {
    send(response, 500, { reason: error instanceof Error ? error.message : String(error) });
  }
}

/** Answer a health request for the project folder `dir`. */
export async function handleAssetHealth(response: ServerResponse, dir: string): Promise<void> {
  try {
    send(response, 200, await assetHealth(dir));
  } catch (error) {
    send(response, 500, { reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityAssetApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-asset-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const importers = (): Promise<ImporterRegistry> => projectImporters(match?.[1] ?? "", dir ?? "");
        if (dir !== undefined && match?.[2] === ASSET_LIST_PATH && request.method === "GET") {
          void handleAssetList(response, dir, importers);
        } else if (dir !== undefined && match?.[2] === ASSET_HEALTH_PATH && request.method === "GET") {
          void handleAssetHealth(response, dir);
        } else if (dir !== undefined && match?.[2] === ASSET_IMPORTERS_PATH && request.method === "GET") {
          void importers()
            .then((registry) => importerForms(registry))
            .then(
              (forms) => send(response, 200, forms),
              (error: unknown) => send(response, 500, { reason: String(error) }),
            );
        } else if (dir !== undefined && match?.[2] === ASSET_RIGHTS_PATH && request.method === "GET") {
          void rightsRecords(dir).then(
            (records) => send(response, 200, records),
            (error: unknown) => send(response, 500, { reason: String(error) }),
          );
        } else if (dir !== undefined && match?.[2] === ASSET_DETAILS_PATH && request.method === "GET") {
          void handleAssetDetails(request.url ?? "", response, dir);
        } else if (dir !== undefined && match?.[2] === ASSET_REIMPORT_PATH && request.method === "POST") {
          void handleReimport(request, response, dir, importers);
        } else if (dir !== undefined && match?.[2] === ASSET_RIGHTS_WRITE_PATH && request.method === "POST") {
          void handleRightsWrite(request, response, dir);
        } else if (dir !== undefined && match?.[2] === ASSET_IMPORT_PATH && request.method === "POST") {
          void handleAssetImport(request, response, dir, process.env, importers);
        } else next();
      });
    },
  };
}
