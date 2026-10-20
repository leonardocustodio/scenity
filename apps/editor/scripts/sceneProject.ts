// SPDX-License-Identifier: Apache-2.0
/**
 * The scenes of a project on the dev server of the scene page, for a page with no workbench:
 *
 * - `GET /projects/<name>/scenes.list.json` gives the project name, the scenes of the project file and each
 *   `*.scene.json` file of the folder with its ID, its name and its picture (the poster of the scene, else a still).
 * - `POST /projects/<name>/scenes.create` writes a new empty scene with the writer of the workbench host
 *   (`createSceneFile` of `@scenity/cli/sceneFile`): the canonical form, the path checks, no replace of a file, and a
 *   project file that lists its scenes lists the new path too.
 *
 * The create has the same refusals as a save (scripts/sceneSave.ts): a request without the save header or from another
 * origin, a path with a hidden part, and each create in the remote mode of the workbench.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, posix } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createSceneFile, type SceneCreateResult } from "@scenity/cli/sceneFile";
import { readDocument } from "@scenity/scene";
import { isRemote } from "./labsFs.ts";
import { sameOriginSave } from "./sceneSave.ts";
import type { ProjectSceneFile, ProjectScenes } from "../src/scene/sceneFiles.ts";

/** The request path of the scene list of a project. */
export const SCENE_LIST_PATH = "scenes.list.json";
/** The request path of the create of a scene. */
export const SCENE_CREATE_PATH = "scenes.create";
/** The largest body of a create (bytes). */
const CREATE_LIMIT = 4096;

type Env = Readonly<Record<string, string | undefined>>;

/** The fields of a scene file that the list reads. */
interface SceneFields {
  readonly id?: unknown;
  readonly name?: unknown;
  readonly poster?: unknown;
}

/** The picture of a scene: its poster (a path relative to the scene file), else the still `stills/<id>.webp`. */
function pictureOf(dir: string, path: string, fields: SceneFields): string | null {
  if (typeof fields.poster === "string") {
    const poster = posix.normalize(posix.join(posix.dirname(path), fields.poster));
    if (!poster.startsWith("..") && existsSync(join(dir, poster))) return poster;
  }
  const still = typeof fields.id === "string" ? `stills/${fields.id}.webp` : null;
  return still !== null && existsSync(join(dir, still)) ? still : null;
}

/**
 * The scene list of the project folder `dir`. `paths` are the files of the folder (relative, with "/"). `fallback` is
 * the server name of the project when the project file does not read.
 */
export function projectScenes(dir: string, fallback: string, paths: readonly string[]): ProjectScenes {
  const file = join(dir, "scenity.project.json");
  const read = existsSync(file) ? readDocument(readFileSync(file, "utf8"), "project") : null;
  const project = read?.ok === true ? read.doc : null;
  const scenes = project?.scenes ?? [];
  const files = paths
    .filter((path) => path.endsWith(".scene.json"))
    .map((path): ProjectSceneFile => {
      let fields: SceneFields = {};
      try {
        fields = JSON.parse(readFileSync(join(dir, path), "utf8")) as SceneFields;
      } catch {
        // A file that does not read stays in the list with no ID and no name.
      }
      return {
        path,
        id: typeof fields.id === "string" ? fields.id : null,
        name: typeof fields.name === "string" ? fields.name : null,
        picture: pictureOf(dir, path, fields),
        listed: scenes.includes(path),
      };
    });
  return { id: project?.id ?? fallback, name: project?.name ?? fallback, scenes, files };
}

function sendJson(response: ServerResponse, status: number, value: unknown): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    request.on("data", (part: Buffer) => {
      size += part.length;
      if (size > CREATE_LIMIT) {
        reject(new Error("the request is too large"));
        request.destroy();
      } else parts.push(part);
    });
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    request.on("error", reject);
  });
}

/** Answer a POST of the create of a scene in the project folder `dir`. */
export async function handleSceneCreate(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  env: Env = process.env,
): Promise<void> {
  const refuse = (status: number, reason: string): void => {
    const result: SceneCreateResult = { ok: false, path: "", reason };
    sendJson(response, status, result);
  };
  const refusal = isRemote(env)
    ? "In the remote mode the workbench host creates the scene files."
    : sameOriginSave(request)
      ? null
      : "A create comes only from a page of this server.";
  if (refusal !== null) {
    refuse(403, refusal);
    return;
  }
  let params: unknown;
  try {
    params = JSON.parse(await readBody(request)) as unknown;
  } catch (error) {
    refuse(400, error instanceof Error ? error.message : String(error));
    return;
  }
  const hidden = (file: string): boolean => file.split("/").some((part) => part.startsWith("."));
  const result = createSceneFile(dir, params as Parameters<typeof createSceneFile>[1], { denied: hidden });
  sendJson(response, result.ok ? 200 : 400, result);
}

/** Answer a GET of the scene list of the project folder `dir` with the files `paths` of the folder. */
export function handleSceneList(response: ServerResponse, dir: string, name: string, paths: readonly string[]): void {
  sendJson(response, 200, projectScenes(dir, name, paths));
}
