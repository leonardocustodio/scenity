// SPDX-License-Identifier: Apache-2.0
/**
 * The shots and the baselines on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/shots.json`: the baselines of the platform (`baselines/<platform>/<scene>--<camera>.png`),
 *   the shots of the panel (`test-results/shots/`), the shot job, and the verify job with the result of each step.
 * - `POST .../shots.take`: `scenity shot --json` for a scene, a camera, a time, a size and a backend (the build of the
 *   project, made first when it has none). The pictures go into `test-results/shots/`.
 * - `POST .../shots.baseline`: a shot becomes the baseline of its scene and camera (the panel asks the owner first).
 * - `POST .../shots.poster`: a shot becomes the poster of its scene (`posters/<scene>.png`). The page sets the
 *   `poster` field of the scene.
 * - `POST .../shots.verify`: `scenity verify` (the check, the build check and a compare for each baseline). The actual
 *   picture of each baseline is in `test-results/verify/`.
 *
 * `SCENITY_BENCH_LOCK` names another GPU lock file for the runs (a test that holds the lock of the labs tools). The
 * posts need the import header and the same origin, as the import does.
 */
import { copyFileSync, existsSync, mkdirSync, readdirSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { basename, join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { cliOf, jobOf, lockArgs, startCliJob, type CliJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

export const SHOTS_PATH = "shots.json";
const POSTS = new Set(["shots.take", "shots.baseline", "shots.poster", "shots.verify"]);
/** The folder of the shots of the panel, relative to the project folder. */
export const SHOTS_FOLDER = "test-results/shots";

type Json = Record<string, unknown>;
type Result = { readonly ok: true; readonly path?: string } | { readonly ok: false; readonly reason: string };

/** The name of a scene file with no folder and no `.scene.json`. */
const sceneName = (scene: string): string => basename(scene).replace(/\.scene\.json$/, "");
const lock = (): string[] => lockArgs();

/** The baselines of the platform: the scene name, the camera ("scene": the camera of the scene) and the file. */
export function baselinesOf(dir: string): { scene: string; camera: string; file: string }[] {
  const folder = join(dir, "baselines", process.platform);
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .sort()
    .flatMap((name) => {
      const match = /^(.+)--([^/]+)\.png$/.exec(name);
      return match?.[1] === undefined || match[2] === undefined
        ? []
        : [{ scene: match[1], camera: match[2], file: `baselines/${process.platform}/${name}` }];
    });
}

/** The result of each shot step of a verify log: the baseline file name and passed or failed. */
export function verifySteps(log: readonly string[]): { name: string; passed: boolean }[] {
  const steps: { name: string; passed: boolean }[] = [];
  let current: string | null = null;
  for (const line of log) {
    const start = /^== scenity shot (\S+) (.+)$/.exec(line);
    if (start?.[1] !== undefined && start[2] !== undefined) {
      const camera = start[2] === "(scene camera)" ? "scene" : start[2];
      current = `${sceneName(start[1])}--${camera}.png`;
      continue;
    }
    const end = /^-- scenity shot .+: (passed|FAILED)$/.exec(line);
    if (end !== null && current !== null) {
      steps.push({ name: current, passed: end[1] === "passed" });
      current = null;
    }
  }
  return steps;
}

/** The pictures of a folder of the project, the newest first. */
function picturesOf(dir: string, folder: string): string[] {
  const path = join(dir, folder);
  if (!existsSync(path)) return [];
  return readdirSync(path)
    .filter((name) => name.endsWith(".png"))
    .sort((a, b) => statSync(join(path, b)).mtimeMs - statSync(join(path, a)).mtimeMs)
    .map((name) => `${folder}/${name}`);
}

function jobView(job: CliJob): Json {
  return { running: job.running, log: job.log.slice(-20), code: job.code };
}

/** The state of the panel. */
export function shotsState(dir: string): Json {
  const verify = jobOf(`verify:${dir}`);
  const out = verify.stdout.split("\n");
  return {
    platform: process.platform,
    baselines: baselinesOf(dir),
    shots: picturesOf(dir, SHOTS_FOLDER),
    shot: jobView(jobOf(`shot:${dir}`)),
    verify: {
      ...jobView(verify),
      steps: verifySteps(out),
      summary: out.findLast((line) => line.startsWith("scenity verify:")) ?? null,
    },
  };
}

/** A shot of the panel: a PNG file of `test-results/shots/` (a path relative to the project folder), or null. */
function shotFile(dir: string, file: unknown): string | null {
  if (typeof file !== "string") return null;
  const path = resolve(dir, file);
  const inside = relative(join(dir, SHOTS_FOLDER), path);
  return inside.startsWith("..") || !file.endsWith(".png") || !existsSync(path) ? null : path;
}

/** Copy a shot to a file of the project (the function makes its folder). */
function copyShot(dir: string, input: Json, target: string): Result {
  const from = shotFile(dir, input.file);
  if (from === null) return { ok: false, reason: "the shot is not a picture of the panel" };
  mkdirSync(join(dir, target, ".."), { recursive: true });
  copyFileSync(from, join(dir, target));
  return { ok: true, path: target };
}

/** Run a post of the panel. */
export function shotsPost(dir: string, what: string, input: Json): Result {
  const scene = typeof input.scene === "string" ? input.scene : "";
  if (what === "shots.verify") {
    return startCliJob(`verify:${dir}`, [cliOf("@scenity/cli"), "verify", dir, ...lock()], dir)
      ? { ok: true }
      : { ok: false, reason: "A verify of the project runs already." };
  }
  if (!/^[\w./-]+\.scene\.json$/.test(scene)) return { ok: false, reason: "the request names no scene of the project" };
  const camera = typeof input.camera === "string" && input.camera !== "" ? input.camera : null;
  if (what === "shots.baseline") {
    return copyShot(dir, input, `baselines/${process.platform}/${sceneName(scene)}--${camera ?? "scene"}.png`);
  }
  if (what === "shots.poster") return copyShot(dir, input, `posters/${sceneName(scene)}.png`);
  const at = typeof input.at === "number" && input.at >= 0 ? ["--at", String(Math.round(input.at))] : [];
  const size = typeof input.size === "string" && /^\d+x\d+$/.test(input.size) ? ["--size", input.size] : [];
  const backend = input.backend === "webgpu" || input.backend === "webgl" ? ["--backend", input.backend] : [];
  const build = existsSync(join(dir, "dist", "index.html")) ? [] : ["--build"];
  const name = `${sceneName(scene)}--{camera}${at.length === 0 ? "" : `@${String(at[1])}`}.png`;
  const args = [
    cliOf("@scenity/cli"),
    "shot",
    "--project",
    dir,
    "--scene",
    scene,
    ...(camera === null ? [] : ["--camera", camera]),
  ];
  const all = [
    ...args,
    ...at,
    ...size,
    ...backend,
    ...build,
    ...lock(),
    "--out",
    join(dir, SHOTS_FOLDER, name),
    "--json",
  ];
  return startCliJob(`shot:${dir}`, all, dir)
    ? { ok: true }
    : { ok: false, reason: "A shot of the project runs already." };
}

async function handlePost(
  request: IncomingMessage,
  response: ServerResponse,
  dir: string,
  what: string,
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A shot comes only from a page of this server." });
    return;
  }
  const result = shotsPost(dir, what, (await readJson(request).catch(() => ({}))) as Json);
  sendJson(response, result.ok ? 200 : 400, result);
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityShotsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-shots-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === SHOTS_PATH && request.method === "GET")
          sendJson(response, 200, shotsState(dir));
        else if (dir !== undefined && POSTS.has(what) && request.method === "POST")
          void handlePost(request, response, dir, what);
        else next();
      });
    },
  };
}
