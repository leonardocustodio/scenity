// SPDX-License-Identifier: Apache-2.0
/**
 * The import by drop on the host (importProtocol.ts has the route and its fields). `POST /imports` takes a dropped
 * file (the bytes from a browser, or a file path from the desktop
 * shell), writes `<state>/imports/<id>/request.json` and starts the import job as a run of the Runs tab
 * (the script `paths.importJob` of a host plugin, in the root of the open checkout: Blender 5.2, the asset build of a
 * prop, the budgets, a picture). The files of the import never go into the committed assets.
 *
 * `GET /imports/<id>/<file>` gives the record, the preview model, the built models and the picture of an import. The
 * state folder is on the denylist. This route gives only the fixed file names of IMPORT_FILES of an import folder.
 */
import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { basename, isAbsolute, join, relative } from "node:path";
import { isDenied } from "./denylist";
import { bunPath } from "./hostRuntime";
import {
  IMPORT_MAX_BYTES,
  IMPORT_PATH,
  importFileOf,
  isImportName,
  readImportFields,
  type ImportFields,
  type ImportStarted,
} from "./importProtocol";
import { pluginPaths } from "./plugins";
import { WEB_DIR } from "./runArgs";
import { activeRunCatalog } from "./runCatalog";
import type { RunManager } from "./runs";

/** The job script of the host plugins (`paths.importJob`), from the root of the checkout. */
export function importJob(): string {
  const job = pluginPaths().importJob;
  if (job === undefined) throw new Error("No host plugin of the project gives an import job (paths.importJob).");
  return job;
}

/** The request file of an import job (`ImportRequestFile` of the job script). */
export interface ImportRequestFile extends Omit<ImportFields, "drop"> {
  readonly version: 1;
  readonly id: string;
  readonly input: string;
  readonly outDir: string;
  readonly pictureDir: string | null;
  readonly origin: "upload" | "path";
  readonly bytes: number;
  readonly created: string;
}

export interface ImportDeps {
  readonly stateDir: string;
  readonly runs: Pick<RunManager, "startHostRun" | "spawner">;
  /** The open checkout. */
  checkout(): string;
  /** The home folder of the owner (a path import must be in it); default: the home of this user. */
  readonly home?: string;
  /** The program of Bun; default: the Bun of the host. */
  readonly bun?: string;
  readonly now?: () => Date;
  /** The turntable picture of the job (default true; `--no-picture` when false). */
  readonly picture?: boolean | undefined;
}

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" };

function refuse(status: number, error: string): Response {
  return new Response(JSON.stringify({ ok: false, error }), { status, headers: JSON_HEADERS });
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function inFolder(folder: string, path: string): boolean {
  const near = relative(folder, path);
  return near !== "" && !near.startsWith("..") && !isAbsolute(near);
}

/**
 * Check the file path of a desktop drop: an absolute path in the home folder, not a link, not on the denylist, a file
 * of an import format of at most IMPORT_MAX_BYTES. Returns the real path and the size, or throws with the reason.
 */
export function checkDropPath(path: unknown, home: string): { readonly path: string; readonly bytes: number } {
  if (typeof path !== "string" || !isAbsolute(path)) throw new Error("The path of a drop must be absolute.");
  if (isDenied(path)) throw new Error("The workbench does not read this file (the denylist).");
  let link: boolean;
  try {
    link = lstatSync(path).isSymbolicLink();
  } catch {
    throw new Error(`No file at ${path}.`);
  }
  if (link) throw new Error("The path is a link: drop the file itself.");
  const real = realpathSync(path);
  if (!inFolder(realpathSync(home), real)) throw new Error("The file must be in the home folder of the owner.");
  if (isDenied(real)) throw new Error("The workbench does not read this file (the denylist).");
  if (!isImportName(basename(real))) throw new Error(`${basename(real)}: not a format of the import.`);
  const stat = statSync(real);
  if (!stat.isFile()) throw new Error("The path is not a file.");
  if (stat.size > IMPORT_MAX_BYTES) throw new Error("The file is larger than 200 MB.");
  return { path: real, bytes: stat.size };
}

/** Write the body of an upload to a file, with the byte limit. Returns the byte count, or null above the limit. */
async function writeBody(request: Request, file: string): Promise<number | null> {
  const declared = Number(request.headers.get("content-length") ?? "0");
  if (declared > IMPORT_MAX_BYTES) return null;
  const writer = Bun.file(file).writer();
  let total = 0;
  try {
    if (request.body !== null) {
      for await (const chunk of request.body) {
        total += chunk.byteLength;
        if (total > IMPORT_MAX_BYTES) return null;
        // Wait for the disk when the sink is full (a large upload).
        const wrote = writer.write(chunk);
        if (wrote instanceof Promise) await wrote;
      }
    }
  } finally {
    await writer.end();
  }
  return total;
}

/** The imports of a host: the route, the request files and the runs of the jobs. */
export class ImportJobs {
  readonly #deps: ImportDeps;

  constructor(deps: ImportDeps) {
    this.#deps = deps;
  }

  /** The folder of the imports in the state folder. */
  get folder(): string {
    return join(this.#deps.stateDir, "imports");
  }

  #newId(): string {
    return `${(this.#deps.now?.() ?? new Date()).getTime().toString(36)}-${randomBytes(4).toString("hex")}`;
  }

  /** The HTTP routes: `POST /imports` and `GET /imports/<id>/<file>`; null for another path. */
  async http(request: Request, url: URL): Promise<Response | null> {
    if (url.pathname === IMPORT_PATH && request.method === "POST") return this.#post(request, url);
    const file = importFileOf(url.pathname);
    if (file === null || request.method !== "GET") return null;
    const path = join(this.folder, file.id, file.file);
    if (!existsSync(path)) return refuse(404, "No such file of the import (yet).");
    const type = file.file.endsWith(".json")
      ? "application/json; charset=utf-8"
      : file.file.endsWith(".png")
        ? "image/png"
        : "model/gltf-binary";
    return new Response(Bun.file(path), { headers: { "content-type": type, "cache-control": "no-store" } });
  }

  async #post(request: Request, url: URL): Promise<Response> {
    const json = (request.headers.get("content-type") ?? "").startsWith("application/json");
    try {
      const started = json ? await this.#fromPath(request) : await this.#upload(request, url);
      return started instanceof Response ? started : Response.json(started, { headers: JSON_HEADERS });
    } catch (error) {
      return refuse(400, errorText(error));
    }
  }

  /** The browser path: the body is the file. */
  async #upload(request: Request, url: URL): Promise<ImportStarted | Response> {
    const fields = readImportFields(Object.fromEntries(url.searchParams), url.searchParams.get("name") ?? "");
    const id = this.#newId();
    const source = join(this.folder, id, "source");
    mkdirSync(source, { recursive: true });
    const input = join(source, fields.name);
    const bytes = await writeBody(request, input);
    if (bytes === null) {
      rmSync(join(this.folder, id), { recursive: true, force: true });
      return refuse(413, "The file is larger than 200 MB.");
    }
    if (bytes === 0) {
      rmSync(join(this.folder, id), { recursive: true, force: true });
      return refuse(400, "The file is empty.");
    }
    return this.start(id, input, fields, "upload", bytes);
  }

  /** The desktop path: a JSON body with the file path of the drop. */
  async #fromPath(request: Request): Promise<ImportStarted> {
    const body = (await request.json()) as Record<string, unknown>;
    const file = checkDropPath(body.path, this.#deps.home ?? homedir());
    const fields = readImportFields(body, basename(file.path));
    return this.start(this.#newId(), file.path, fields, "path", file.bytes);
  }

  /** Write the request file and start the job as a run of the Runs tab. */
  start(id: string, input: string, fields: ImportFields, origin: "upload" | "path", bytes: number): ImportStarted {
    const job = importJob();
    const checkout = this.#deps.checkout();
    const outDir = join(this.folder, id);
    mkdirSync(outDir, { recursive: true });
    const web = join(checkout, WEB_DIR);
    const request: ImportRequestFile = {
      version: 1,
      id,
      name: fields.name,
      input,
      outDir,
      // The pictures go to the output folders of the runs of the project.
      pictureDir: join(web, activeRunCatalog().outRoot, `import-${id}`),
      point: fields.point,
      source: fields.source,
      licence: fields.licence,
      origin,
      bytes,
      created: (this.#deps.now?.() ?? new Date()).toISOString(),
    };
    const requestPath = join(outDir, "request.json");
    writeFileSync(requestPath, `${JSON.stringify(request, null, 2)}\n`);
    const bun = this.#deps.bun ?? bunPath();
    const { runs } = this.#deps;
    const args = ["--request", requestPath, ...(this.#deps.picture === false ? ["--no-picture"] : [])];
    const { run } = runs.startHostRun(checkout, "import", (onOutput, env) => {
      onOutput("stdout", `$ bun ${job} ${args.join(" ")}\n`);
      return runs.spawner([bun, job, ...args], { cwd: web, env, onOutput });
    });
    return { id, run, name: fields.name, point: fields.point, drop: fields.drop };
  }
}
