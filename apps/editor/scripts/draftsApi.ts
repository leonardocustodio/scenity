// SPDX-License-Identifier: Apache-2.0
/**
 * The drafts of the scene files on the host, a Vite plugin. The page keeps a draft of each
 * dirty scene file in the browser storage and here, in `.scenity/drafts.json` of the project folder (Git ignores
 * `.scenity/`), so a closed tab or another browser gets the unsaved edits back.
 *
 * - `GET /projects/<name>/drafts.json`: `{ drafts }`, each draft text by its storage key.
 * - `POST /projects/<name>/drafts.write`: `{ key, value }`, a new draft text, or null to remove the draft.
 *
 * A key is the key of a scene draft (`scenity.sceneDraft.<project>:<path>`). The post needs the import header and the
 * same origin, as the import does. `SCENITY_SCENE_HOST_DRAFTS=0` disables the drafts of the host (the test servers).
 * Then the read gives no drafts and a write keeps nothing.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

const DRAFTS_FILE = ".scenity/drafts.json";
/** The largest draft text (characters): the JSON body of a request is 1 MB at most. */
const DRAFT_MAX = 1_000_000;
const KEY = /^scenity\.sceneDraft\.[a-z0-9-]+:[^\0]{1,400}$/;

/** The drafts of the project folder `dir`. */
export function readDrafts(dir: string): Record<string, string> {
  const path = join(dir, DRAFTS_FILE);
  if (!existsSync(path)) return {};
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as unknown;
    if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
    return Object.fromEntries(
      Object.entries(value).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

/** Write or remove one draft; the reason of a refusal, or null. */
export function writeDraft(dir: string, key: unknown, value: unknown): string | null {
  if (typeof key !== "string" || !KEY.test(key)) return "not the key of a scene draft";
  if (value !== null && (typeof value !== "string" || value.length > DRAFT_MAX))
    return "a draft is a text of 1 MB at most";
  const others = Object.entries(readDrafts(dir)).filter(([name]) => name !== key);
  const drafts = Object.fromEntries(value === null ? others : [...others, [key, value]]);
  const path = join(dir, DRAFTS_FILE);
  mkdirSync(dirname(path), { recursive: true });
  // A write through a temp file and a rename: a reader never sees half a file.
  writeFileSync(`${path}.tmp`, JSON.stringify(drafts));
  renameSync(`${path}.tmp`, path);
  return null;
}

async function handleWrite(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A draft comes only from a page of this server." });
    return;
  }
  try {
    const input = (await readJson(request)) as { key?: unknown; value?: unknown };
    const reason = writeDraft(dir, input.key, input.value ?? null);
    sendJson(response, reason === null ? 200 : 400, reason === null ? { ok: true } : { ok: false, reason });
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityDraftsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-drafts-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(drafts\.json|drafts\.write)$/.exec(
          (request.url ?? "").split("?")[0] ?? "",
        );
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const off = process.env.SCENITY_SCENE_HOST_DRAFTS === "0";
        if (dir !== undefined && match?.[2] === "drafts.json" && request.method === "GET")
          sendJson(response, 200, { drafts: off ? {} : readDrafts(dir) });
        else if (dir !== undefined && match?.[2] === "drafts.write" && request.method === "POST") {
          if (off) sendJson(response, 200, { ok: true });
          else void handleWrite(request, response, dir);
        } else next();
      });
    },
  };
}
