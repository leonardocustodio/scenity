// SPDX-License-Identifier: Apache-2.0
/**
 * The asset build panel on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/assets.build.json`: the build job of the project (running, its log, its exit code) and the
 *   build of each asset (its state of `assetBuildStates`, its levels of detail in the build manifest, its settings).
 * - `POST .../assets.build.run`: start `scenity assets build` for the project (the asset CLI in a child process, one
 *   run at a time). The panel reads the job until it ends.
 * - `POST .../assets.build.settings`: write the build settings of one asset (`{ id, build }`; null removes them) into
 *   its record.
 *
 * The writes need the import header and the same origin, as the import does. Put the plugin before `scenityProjects`.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import type * as AssetsIndex from "@scenity/assets";
import type * as BuildIndex from "@scenity/assets/build";
import {
  ASSET_BUILD_PATH,
  ASSET_BUILD_RUN_PATH,
  ASSET_BUILD_SETTINGS_PATH,
  type AssetBuildInfo,
  type AssetBuildReport,
  type AssetBuildSettings,
  type BuildJobInfo,
  type BuiltLod,
} from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { builtLods } from "./assetDetails.ts";
import { assetsModule } from "./assetsModule.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";
import { trackJob } from "./cliJob.ts";

/** The most log lines that the job keeps. */
const LOG_LINES = 400;

interface Job {
  running: boolean;
  log: string[];
  code: number | null;
}
const jobs = new Map<string, Job>();

/** The CLI of `@scenity/assets` (`src/cli.ts` of the package). */
function assetCli(): string {
  return join(dirname(createRequire(import.meta.url).resolve("@scenity/assets")), "cli.ts");
}

/** Start the build of the project folder `dir`. False when a build of the folder runs already. */
export function startBuild(dir: string): boolean {
  const old = jobs.get(dir);
  if (old?.running === true) return false;
  const job: Job = { running: true, log: [], code: null };
  jobs.set(dir, job);
  // The dev server runs in Bun (`bunx --bun vite`): its executable runs the TypeScript CLI.
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  const child = spawn(bun, [assetCli(), "build", dir], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  // The build goes into the journal of the Jobs panel.
  trackJob({
    key: `assets.build:${dir}`,
    args: [assetCli(), "build", dir],
    cwd: dir,
    child,
    rerun: () => startBuild(dir),
  });
  const add = (part: Buffer): void => {
    job.log.push(
      ...part
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim() !== ""),
    );
    if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
  };
  child.stdout.on("data", add);
  child.stderr.on("data", add);
  child.on("error", (error) => {
    job.log.push(error.message);
    job.running = false;
    job.code = 1;
  });
  child.on("close", (code) => {
    job.running = false;
    job.code = code ?? 1;
  });
  return true;
}

/** The build job of a project folder. */
function jobOf(dir: string): BuildJobInfo {
  const job = jobs.get(dir);
  return job === undefined ? { running: false, log: [], code: null } : { ...job, log: [...job.log] };
}

/** The build report of the project folder `dir`. */
export async function buildReport(dir: string): Promise<AssetBuildReport> {
  const { AssetDatabase } = await assetsModule<typeof AssetsIndex>("");
  const { assetBuildStates } = await assetsModule<typeof BuildIndex>("build");
  const db = await AssetDatabase.open(dir);
  const lods = new Map<string, BuiltLod[]>(
    db.entries().map((entry) => [entry.id, builtLods(dir, db.outputDir, entry.id)]),
  );
  const built = new Set([...lods].filter(([, levels]) => levels.length > 0).map(([id]) => id));
  // A built asset with no levels (a texture, a sound) is in the manifest too.
  for (const id of manifestIds(join(dir, db.outputDir, "manifest.json"))) built.add(id);
  const states = new Map(assetBuildStates(db, built).map((status) => [status.id, status]));
  const assets = db.entries().map((entry): AssetBuildInfo => {
    const record = JSON.parse(readFileSync(join(dir, entry.recordPath), "utf8")) as { build?: AssetBuildSettings };
    const status = states.get(entry.id);
    const file = entry.sourcePath.slice(entry.sourcePath.lastIndexOf("/") + 1);
    return {
      id: entry.id,
      name: file.includes(".") ? file.slice(0, file.lastIndexOf(".")) : file,
      kind: entry.kind,
      state: status?.state ?? "unbuilt",
      reason: status?.reason ?? null,
      lods: lods.get(entry.id) ?? [],
      build: record.build ?? null,
    };
  });
  return { job: jobOf(dir), assets };
}

/** The asset IDs of a build manifest (none: no manifest). */
function manifestIds(path: string): string[] {
  if (!existsSync(path)) return [];
  try {
    const manifest = JSON.parse(readFileSync(path, "utf8")) as { records?: readonly { id?: unknown }[] };
    return (manifest.records ?? []).flatMap((record) => (typeof record.id === "string" ? [record.id] : []));
  } catch {
    return [];
  }
}

/** Write the build settings of one asset into its record (null removes them). */
export async function writeBuildSettings(
  dir: string,
  id: string,
  build: AssetBuildSettings | null,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const { AssetDatabase, readAssetRecord, writeAssetRecord } = await assetsModule<typeof AssetsIndex>("");
  const entry = (await AssetDatabase.open(dir)).get(id);
  if (entry === undefined) return { ok: false, reason: `no asset ${id}` };
  const path = join(dir, entry.recordPath);
  const read = readAssetRecord(readFileSync(path, "utf8"));
  if (!read.ok) return { ok: false, reason: read.errors.map((error) => error.message).join("; ") };
  const rest = Object.fromEntries(Object.entries(read.record).filter(([key]) => key !== "build"));
  const next = build === null || Object.keys(build).length === 0 ? rest : { ...rest, build };
  try {
    writeFileSync(path, writeAssetRecord(next as AssetsIndex.AssetRecord));
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : String(error) };
  }
  return { ok: true };
}

/** Answer a write of the panel: a run or the settings of an asset (a page of this server only). */
async function handleWrite(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  what: string,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A build comes only from a page of this server." });
    return;
  }
  if (what === ASSET_BUILD_RUN_PATH) {
    sendJson(
      response,
      200,
      startBuild(dir) ? { ok: true } : { ok: false, reason: "A build of the project runs already." },
    );
    return;
  }
  try {
    const input = (await readJson(request)) as { id?: unknown; build?: AssetBuildSettings | null };
    if (typeof input.id !== "string") throw new Error("the request names no asset");
    const result = await writeBuildSettings(dir, input.id, input.build ?? null);
    sendJson(response, result.ok ? 200 : 400, result);
  } catch (error) {
    sendJson(response, 400, { ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityBuildApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-build-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === ASSET_BUILD_PATH && request.method === "GET") {
          void buildReport(dir).then(
            (report) => sendJson(response, 200, report),
            (error: unknown) => sendJson(response, 500, { reason: String(error) }),
          );
        } else if (
          dir !== undefined &&
          (what === ASSET_BUILD_RUN_PATH || what === ASSET_BUILD_SETTINGS_PATH) &&
          request.method === "POST"
        ) {
          void handleWrite(request, response, dir, what);
        } else next();
      });
    },
  };
}
