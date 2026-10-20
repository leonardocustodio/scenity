// SPDX-License-Identifier: Apache-2.0
/**
 * The Vite plugin of the Scenity projects of the editor. It serves each project folder under `/projects/<name>/` and
 * gives an asset index at `/projects/<name>/assets.index.json`: the ID, the kind and the source file of each asset
 * record (`<source>.meta.json`). The dev server reads the files from the disk. A build copies them into
 * `projects/<name>/` of the output.
 *
 * This index reads the records only (the full asset database is `@scenity/assets`). A POST to a `*.scene.json` file
 * of a project saves it (scripts/sceneSave.ts). scripts/sceneProject.ts gives the scene list and the create of a new
 * scene. A request for a file that is not in the project gets no page of the app.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, normalize, relative, sep } from "node:path";
import type { ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { handleSceneSave } from "./sceneSave.ts";
import { handleSceneCreate, handleSceneList, SCENE_CREATE_PATH, SCENE_LIST_PATH } from "./sceneProject.ts";

/** One entry of the asset index: the source file relative to the project, and the kind of the record. */
export interface AssetIndexEntry {
  readonly path: string;
  readonly kind: string;
}

/** The asset index of a project: asset ID → entry. */
export type AssetIndex = Readonly<Record<string, AssetIndexEntry>>;

/** Folders that a project never serves. */
const SKIPPED = new Set(["node_modules", ".git", "dist", ".cache"]);

function walk(folder: string, out: string[]): void {
  for (const name of readdirSync(folder)) {
    if (SKIPPED.has(name) || name.startsWith(".")) continue;
    const path = join(folder, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
}

/** Each file of a project folder, relative to the folder with "/". */
export function projectFiles(dir: string): string[] {
  const out: string[] = [];
  walk(dir, out);
  return out.map((path) => relative(dir, path).split(sep).join("/")).sort();
}

/** The asset index of a project folder from its asset records. A record with no `id` or `source` is left out. */
export function assetIndex(dir: string): AssetIndex {
  const index: Record<string, AssetIndexEntry> = {};
  for (const file of projectFiles(dir).filter((path) => path.endsWith(".meta.json"))) {
    const record = JSON.parse(readFileSync(join(dir, file), "utf8")) as {
      id?: unknown;
      kind?: unknown;
      source?: unknown;
    };
    if (typeof record.id !== "string" || typeof record.source !== "string") continue;
    const folder = file.includes("/") ? file.slice(0, file.lastIndexOf("/") + 1) : "";
    index[record.id] = {
      path: `${folder}${record.source}`,
      kind: typeof record.kind === "string" ? record.kind : "model",
    };
  }
  return index;
}

/** The decoded text of a request path, or the path as it is when it does not decode. */
function safeDecode(path: string): string {
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The file of a request path inside a project folder, or null for a path outside it. */
export function projectFile(dir: string, path: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    return null;
  }
  const file = normalize(join(dir, decoded));
  if (file !== dir && !file.startsWith(`${dir}${sep}`)) return null;
  return existsSync(file) && statSync(file).isFile() ? file : null;
}

const TYPES: Readonly<Record<string, string>> = {
  ".json": "application/json",
  ".gltf": "model/gltf+json",
  ".glb": "model/gltf-binary",
  ".bin": "application/octet-stream",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".hdr": "application/octet-stream",
  ".ktx2": "image/ktx2",
  // The files of a built player in the project (`dist/`): the page, its modules, its decoders.
  ".html": "text/html",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".css": "text/css",
  ".wasm": "application/wasm",
  ".map": "application/json",
  ".svg": "image/svg+xml",
  ".wav": "audio/wav",
  ".mp3": "audio/mpeg",
  ".ogg": "audio/ogg",
};

function typeOf(path: string): string {
  const dot = path.lastIndexOf(".");
  return TYPES[path.slice(dot)] ?? "application/octet-stream";
}

/**
 * The header of a read of the scene file port (src/scene/sceneFiles.ts `FILE_READ_HEADER`). For such a read, a missing
 * file is a normal answer (for example `scenity.editor.json` of a new project): 204 with no body, so the browser
 * console shows no failed request. Each other request for a missing file gets 404.
 */
export const FILE_READ_HEADER = "x-scenity-file-read";

/** Answer a request for a project file that does not exist. */
function missingFile(portRead: boolean, response: ServerResponse): void {
  response.statusCode = portRead ? 204 : 404;
  response.end();
}

/** The plugin. `projects` maps a project name to its folder (absolute). */
export function scenityProjects(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-projects",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (match?.[2] === undefined || dir === undefined) {
          next();
          return;
        }
        // The scene list and the create of a new scene (scripts/sceneProject.ts).
        if (match[2] === SCENE_LIST_PATH) {
          handleSceneList(response, dir, match[1] ?? "", projectFiles(dir));
          return;
        }
        if (request.method === "POST" && match[2] === SCENE_CREATE_PATH) {
          void handleSceneCreate(request, response, dir);
          return;
        }
        // A POST to a scene file saves it (scripts/sceneSave.ts).
        if (request.method === "POST") {
          void handleSceneSave(request, response, dir, safeDecode(match[2]));
          return;
        }
        if (match[2] === "assets.index.json") {
          response.setHeader("Content-Type", "application/json");
          response.end(JSON.stringify(assetIndex(dir)));
          return;
        }
        const file = projectFile(dir, match[2]);
        if (file === null) {
          missingFile(request.headers[FILE_READ_HEADER] === "1", response);
          return;
        }
        response.setHeader("Content-Type", typeOf(file));
        response.end(readFileSync(file));
      });
    },
    generateBundle() {
      for (const [name, dir] of Object.entries(projects)) {
        for (const file of projectFiles(dir))
          this.emitFile({ type: "asset", fileName: `projects/${name}/${file}`, source: readFileSync(join(dir, file)) });
        this.emitFile({
          type: "asset",
          fileName: `projects/${name}/assets.index.json`,
          source: JSON.stringify(assetIndex(dir)),
        });
      }
    },
  };
}
