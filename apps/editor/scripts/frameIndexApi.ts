// SPDX-License-Identifier: Apache-2.0
/**
 * The frame index of a project on the dev server, a Vite plugin for the Frame index panel:
 *
 * - `GET /projects/<name>/frames.json`: the frames of the list of the project (`.scenity/frames/index.json`, written
 *   by `scenity frames`), each with a stale mark (its key is not a key of the current project files), the count of the
 *   current frames of the project, and the state of the index job.
 * - `GET /projects/<name>/frames/<key>.png`: the picture of a frame.
 * - `POST /projects/<name>/frames.index`: start `scenity frames` for the project as a job of the dev server (a build
 *   first when the project has no player build). It needs the import header and no remote client.
 */
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join } from "node:path";
import {
  FRAMES_FOLDER,
  projectContentHash,
  projectDocuments,
  readFrameIndex,
  wantedFrames,
  withStaleMarks,
} from "@scenity/cli/frameIndex";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { cliOf, jobOf, lockArgs, startCliJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { sendJson } from "./serverParts.ts";

const KEY = /^[0-9a-f]{32}$/;

/** The state of the frame index of a project folder for the panel. */
export function frameIndexState(dir: string): Record<string, unknown> {
  const job = jobOf(`frames:${dir}`);
  const state = { running: job.running, log: job.log.slice(-5), code: job.code };
  try {
    const docs = projectDocuments(dir);
    const wanted = wantedFrames(docs.project, docs.files, projectContentHash(dir, docs.project));
    return { ...state, wanted: wanted.length, frames: withStaleMarks(readFrameIndex(dir).frames, wanted) };
  } catch (error) {
    return { ...state, wanted: 0, frames: [], error: error instanceof Error ? error.message : String(error) };
  }
}

/** Start the index job of a project folder; the reason when it cannot start. */
export function startFrameIndex(dir: string): string | null {
  const build = existsSync(join(dir, "dist", "player", "element.js")) ? [] : ["--build"];
  const args = [cliOf("@scenity/cli"), "frames", dir, ...build, ...lockArgs(), "--json"];
  return startCliJob(`frames:${dir}`, args, dir) ? null : "The index of the project runs already.";
}

function picture(response: ServerResponse, dir: string, key: string): void {
  const file = join(dir, FRAMES_FOLDER, `${key}.png`);
  if (!KEY.test(key) || !existsSync(file)) {
    response.statusCode = 404;
    response.end();
    return;
  }
  response.setHeader("content-type", "image/png");
  response.setHeader("cache-control", "no-cache");
  response.end(readFileSync(file));
}

function post(request: IncomingMessage, response: ServerResponse, dir: string): void {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "An index comes only from a page of this server." });
    return;
  }
  const reason = startFrameIndex(dir);
  sendJson(response, reason === null ? 200 : 409, reason === null ? { ok: true } : { ok: false, reason });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityFrameIndexApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-frame-index-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(frames\.json|frames\.index|frames\/([0-9a-f]+)\.png)$/.exec(
          (request.url ?? "").split("?")[0] ?? "",
        );
        const name = match?.[1] ?? "";
        const dir = Object.hasOwn(projects, name) ? projects[name] : undefined;
        if (dir === undefined || match === null) next();
        else if (match[2] === "frames.json" && request.method === "GET") sendJson(response, 200, frameIndexState(dir));
        else if (match[3] !== undefined && request.method === "GET") picture(response, dir, match[3]);
        else if (match[2] === "frames.index" && request.method === "POST") post(request, response, dir);
        else next();
      });
    },
  };
}
