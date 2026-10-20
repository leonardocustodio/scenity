// SPDX-License-Identifier: Apache-2.0
/**
 * The Project window API of the dev server, under `/projects/<name>/`:
 *
 * - `GET project.files.json`: the folders and the files of the project (projectFiles.ts).
 * - `POST project.move` with `{ from, to }`: a move or a rename (an asset source moves with its record).
 * - `POST project.folder` with `{ path }`: a new folder.
 * - `POST project.reveal` with `{ path }`: show the file in the file manager of the system.
 *
 * A write comes only from a page of this server (the header `x-scenity-project: 1` and the same origin). The remote
 * mode refuses the writes and the reveal (the workbench host owns the files there). `SCENITY_SCENE_NO_REVEAL=1` (a
 * test) answers a reveal with no file manager.
 */
import { spawn } from "node:child_process";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { isRemote } from "./labsFs.ts";
import { listProjectFiles, makeProjectFolder, moveProjectFile, projectPath } from "./projectFiles.ts";

/** The header of a write of the Project window. */
export const PROJECT_HEADER = "x-scenity-project";

type Env = Readonly<Record<string, string | undefined>>;

function send(response: ServerResponse, status: number, body: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(body));
}

function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let text = "";
    request.on("data", (part: Buffer) => {
      text += part.toString("utf8");
      if (text.length > 100_000) request.destroy();
    });
    request.on("end", () => {
      try {
        const value = JSON.parse(text) as unknown;
        resolve(typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {});
      } catch {
        resolve({});
      }
    });
  });
}

/** True for a write from a page of this server. */
function sameOrigin(request: Pick<IncomingMessage, "headers">): boolean {
  const { origin, host } = request.headers;
  return request.headers[PROJECT_HEADER] === "1" && typeof host === "string" && origin === `http://${host}`;
}

/** The program and the arguments that show a file in the file manager of the system. */
export function revealCommand(file: string, platform: NodeJS.Platform = process.platform): [string, string[]] {
  if (platform === "darwin") return ["open", ["-R", file]];
  if (platform === "win32") return ["explorer", [`/select,${file}`]];
  return ["xdg-open", [join(file, "..")]];
}

/** Answer a write or a reveal of the Project window for the project folder `dir`. */
export async function handleProjectWrite(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  action: "move" | "folder" | "reveal",
  env: Env = process.env,
): Promise<void> {
  if (isRemote(env)) {
    send(response, 403, { ok: false, reason: "In the remote mode the workbench host owns the files." });
    return;
  }
  if (!sameOrigin(request)) {
    send(response, 403, { ok: false, reason: "A change of the files comes only from a page of this server." });
    return;
  }
  const body = await readJson(request);
  const text = (key: string): string => (typeof body[key] === "string" ? body[key] : "");
  let reason: string | null;
  if (action === "move") reason = moveProjectFile(dir, text("from"), text("to"));
  else if (action === "folder") reason = makeProjectFolder(dir, text("path"));
  else {
    const path = projectPath(dir, text("path"));
    reason = path === null ? "A path leaves the project." : null;
    if (path !== null && env.SCENITY_SCENE_NO_REVEAL !== "1") {
      const [program, args] = revealCommand(join(dir, path));
      spawn(program, args, { detached: true, stdio: "ignore" }).unref();
    }
  }
  send(response, reason === null ? 200 : 400, reason === null ? { ok: true } : { ok: false, reason });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityProjectFiles(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-project-files",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(project\.[a-z.]+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const path = match?.[2];
        if (dir === undefined || path === undefined) {
          next();
          return;
        }
        if (path === "project.files.json" && request.method === "GET") {
          send(response, 200, { files: listProjectFiles(dir) });
          return;
        }
        const action = { "project.move": "move", "project.folder": "folder", "project.reveal": "reveal" }[path];
        if (action !== undefined && request.method === "POST") {
          void handleProjectWrite(request, response, dir, action as "move" | "folder" | "reveal");
          return;
        }
        next();
      });
    },
  };
}
