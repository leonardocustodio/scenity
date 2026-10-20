// SPDX-License-Identifier: Apache-2.0
/**
 * The save of a scene file on the dev server of the scene page, for a page with no workbench: a POST of the save parameters to the URL of a `*.scene.json` file of a project. The writer is the writer
 * of the workbench host (`@scenity/cli/sceneFile`): the canonical form, an atomic write, the conflict check of the
 * base hash and the path checks. The server also refuses:
 *
 * - a request without the save header or from another origin (a page of another site cannot write).
 * - a path with a hidden part (the server does not serve those files).
 * - each save in the remote mode of the workbench. In that mode the host does the saves, with the role check of the page.
 */
import type { IncomingMessage, ServerResponse } from "node:http";
import { isSceneSaveParams, saveSceneFile, type SceneSaveParams, type SceneSaveResult } from "@scenity/cli/sceneFile";
import { isRemote } from "./labsFs.ts";

/** The header of a save request (`SAVE_HEADER` of src/scene/sceneFiles.ts). */
export const SAVE_HEADER = "x-scenity-scene-save";
/** The largest body of a save (bytes). */
export const SAVE_LIMIT = 16 * 1024 * 1024;

type Env = Readonly<Record<string, string | undefined>>;

/** True when the request comes from a page of this server: the save header and the same origin. */
export function sameOriginSave(request: Pick<IncomingMessage, "headers">): boolean {
  const { origin, host } = request.headers;
  return request.headers[SAVE_HEADER] === "1" && typeof host === "string" && origin === `http://${host}`;
}

function readBody(request: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const parts: Buffer[] = [];
    let size = 0;
    request.on("data", (part: Buffer) => {
      size += part.length;
      if (size > SAVE_LIMIT) {
        reject(new Error("the scene is too large"));
        request.destroy();
      } else parts.push(part);
    });
    request.on("end", () => resolve(Buffer.concat(parts).toString("utf8")));
    request.on("error", reject);
  });
}

function send(response: ServerResponse, status: number, result: SceneSaveResult): void {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.end(JSON.stringify(result));
}

/** The parameters of a save request, or the status and the reason of its refusal. */
async function saveParams(
  request: IncomingMessage,
  path: string,
  env: Env,
): Promise<{ params: SceneSaveParams } | { status: number; reason: string }> {
  if (isRemote(env)) return { status: 403, reason: "In the remote mode the workbench host saves the scene files." };
  if (!sameOriginSave(request)) return { status: 403, reason: "A save comes only from a page of this server." };
  let params: unknown;
  try {
    params = JSON.parse(await readBody(request)) as unknown;
  } catch (error) {
    return { status: 400, reason: error instanceof Error ? error.message : String(error) };
  }
  if (!isSceneSaveParams(params) || params.path !== path)
    return { status: 400, reason: "The save parameters are not valid." };
  return { params };
}

/** Answer a POST to the file `path` (decoded, relative) of the project folder `dir`. */
export async function handleSceneSave(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  path: string,
  env: Env = process.env,
): Promise<void> {
  const checked = await saveParams(request, path, env);
  if (!("params" in checked)) {
    send(response, checked.status, { ok: false, path, conflict: false, reason: checked.reason });
    return;
  }
  const hidden = (file: string): boolean => file.split("/").some((part) => part.startsWith("."));
  const result = saveSceneFile(dir, checked.params, { denied: hidden });
  send(response, result.ok ? 200 : result.conflict ? 409 : 400, result);
}
