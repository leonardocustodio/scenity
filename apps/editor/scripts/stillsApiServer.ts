// SPDX-License-Identifier: Apache-2.0
/**
 * The stills of the asset browser on a dev server, a Vite plugin. The editor page draws each
 * still in a hidden still page (still.html) and sends the picture. The server keeps the stamps.
 *
 * - `GET /projects/<name>/assets.stills.json`: the stills plan of the project (`planStills` of `@scenity/assets/stills`),
 *   one entry for each asset with a still. As in the check of `scenity assets stills`, a still is stale after a change
 *   of its inputs, not after a change of the still page (else each edit of the page marks each still).
 * - `POST /projects/<name>/assets.still.write?id=<ID>`: the WebP bytes of a still, with the import header. The server
 *   writes `stills/<ID>.webp` and its stamp with `makeStills`, so the stamp is the stamp of the stills script.
 * - `GET /decoders/<name>.wasm`: the WASM decoders of the still page.
 *
 * Only the dev server has the plugin (`apply: "serve"`). Put it before `scenityProjects`.
 */
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import type { Plugin } from "vite";
import type * as StillsIndex from "@scenity/assets/stills";
import {
  ASSET_STILL_WRITE_PATH,
  ASSET_STILLS_PATH,
  type StillJobInfo,
  type StillWriteResult,
} from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { rendererVersion, STILL_DECODERS } from "./stills/stillVersion.ts";

/** The largest still (bytes). */
const STILL_LIMIT = 4 * 1024 * 1024;
const resolveFrom = createRequire(import.meta.url);

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

/** The stills plan of the project folder `dir`. */
export async function stillJobs(dir: string): Promise<StillJobInfo[]> {
  const { planStills, STILL_SIZE } = await assetsModule<typeof StillsIndex>("stills");
  const plan = await planStills(dir);
  return plan.jobs.map((job) => ({
    id: job.id,
    kind: job.kind,
    mode: job.mode,
    input: job.input,
    problem: job.problem,
    status: job.status,
    reason: job.reason,
    ...STILL_SIZE,
  }));
}

/** The last write of each project folder. The writes of one folder run in sequence (one stamp file). */
const writes = new Map<string, Promise<unknown>>();

/** Write the still of the asset `id` of the project folder `dir`, after the writes before it. */
export function writeStill(dir: string, id: string, bytes: Uint8Array): Promise<StillWriteResult> {
  const next = (writes.get(dir) ?? Promise.resolve()).then(() => writeStillNow(dir, id, bytes));
  writes.set(
    dir,
    next.catch(() => undefined),
  );
  return next;
}

/** Write the still of the asset `id` of the project folder `dir`: the bytes go through `makeStills`. */
async function writeStillNow(dir: string, id: string, bytes: Uint8Array): Promise<StillWriteResult> {
  if (bytes.byteLength === 0 || bytes.byteLength > STILL_LIMIT) return { ok: false, reason: "the still has no bytes" };
  const isWebp = new TextDecoder().decode(bytes.subarray(8, 12)) === "WEBP";
  if (!isWebp) return { ok: false, reason: "a still is a WebP image" };
  const { makeStills } = await assetsModule<typeof StillsIndex>("stills");
  const report = await makeStills(
    dir,
    { version: rendererVersion(), render: () => Promise.resolve(bytes) },
    {
      ids: [id],
      force: true,
    },
  );
  const failed = report.failed.find((each) => each.id === id);
  if (failed !== undefined) return { ok: false, reason: failed.reason };
  const job = report.plan.jobs.find((each) => each.id === id);
  if (job === undefined || !report.made.includes(id)) return { ok: false, reason: `no still for asset ${id}` };
  return { ok: true, still: job.still };
}

function readBody(request: IncomingMessage): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    request.on("data", (part: Buffer) => {
      size += part.length;
      if (size > STILL_LIMIT) {
        reject(new Error("the still is too large"));
        request.destroy();
      } else parts.push(part);
    });
    request.on("end", () => resolve(new Uint8Array(Buffer.concat(parts))));
    request.on("error", reject);
  });
}

async function handleWrite(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    send(response, 403, { ok: false, reason: "A still comes only from a page of this server." });
    return;
  }
  const id = new URL(request.url ?? "", "http://localhost").searchParams.get("id") ?? "";
  try {
    const result = await writeStill(dir, id, await readBody(request));
    send(response, result.ok ? 200 : 400, result);
  } catch (error) {
    send(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityStillsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-stills-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        const decoder = STILL_DECODERS[path];
        if (decoder !== undefined && request.method === "GET") {
          response.setHeader("Content-Type", "application/wasm");
          response.end(readFileSync(resolveFrom.resolve(decoder)));
          return;
        }
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec(path);
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (dir !== undefined && match?.[2] === ASSET_STILLS_PATH && request.method === "GET") {
          void stillJobs(dir).then(
            (jobs) => send(response, 200, jobs),
            (error: unknown) => send(response, 500, { reason: String(error) }),
          );
        } else if (dir !== undefined && match?.[2] === ASSET_STILL_WRITE_PATH && request.method === "POST") {
          void handleWrite(request, response, dir);
        } else next();
      });
    },
  };
}
