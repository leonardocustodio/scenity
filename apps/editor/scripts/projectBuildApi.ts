// SPDX-License-Identifier: Apache-2.0
/**
 * The Build window on a dev server, a Vite plugin:
 *
 * - `GET /projects/<name>/project.build.json?out=<dir>`: the build job (running, its log, its exit code), the report
 *   of the last build in the output folder (`<out>/build-report.json`), and the size budgets of the entries
 *   (`build.budgets` of the project).
 * - `POST .../project.build.run`: `scenity build <project> --json --out <dir>` (the output folder in the project,
 *   default `dist`).
 * - `POST .../project.build.budgets`: new size budgets of the entries (`{ budgets }`) into the project file.
 * - `POST .../project.publish.run`: `scenity publish --json` (the release gate first, then the build folder as a ZIP
 *   archive in `test-results/publish/`). The state has its result (the reasons of a stop, or the archive).
 *   `POST .../project.publish.send` with `{ target }` gives that archive to a publish target of a plugin (the
 *   `publishTargets` of a host face). The state lists the targets and the result of the last send.
 * - `GET .../embed.preview.html?out=<dir>&options=<JSON>`: a plain page with the web component snippet of
 *   the Embed panel (`embedPage`), for the preview frame.
 *
 * The posts need the import header and the same origin, as the import does. The page opens the built player at
 * `/projects/<name>/<out>/index.html`.
 */
import { projectHostFaces, type PublishTarget } from "./hostFaces.ts";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, resolve } from "node:path";
import type { Plugin } from "vite";
import { canonicalJson, entryBudgetSchema } from "@scenity/scene";
import { sameOriginImport } from "./assetApiServer.ts";
import { embedPage, type EmbedOptions } from "../src/scene/build/embedSnippet.ts";
import { cliOf, jobOf, startCliJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

export const PROJECT_BUILD_PATH = "project.build.json";
export const PROJECT_BUILD_RUN_PATH = "project.build.run";
export const PROJECT_BUDGETS_PATH = "project.build.budgets";
export const EMBED_PREVIEW_PATH = "embed.preview.html";
export const PROJECT_PUBLISH_PATH = "project.publish.run";
/** Send the archive of the last publish to a publish target of a plugin. */
export const PROJECT_SEND_PATH = "project.publish.send";
const PROJECT_FILE = "scenity.project.json";

type Json = Record<string, unknown>;

/** The output folder of a request in the project folder, or null for a folder outside it. */
export function outputFolder(dir: string, out: unknown): string | null {
  const name = typeof out === "string" && out.trim() !== "" ? out.trim() : "dist";
  const path = resolve(dir, name);
  const inside = relative(dir, path);
  return inside === "" || inside.startsWith("..") || /(^|\/)\./.test(inside) ? null : inside.split("\\").join("/");
}

/** The JSON report of a `scenity publish --json` run, or null. */
function publishResult(stdout: string): unknown {
  if (stdout === "") return null;
  try {
    return JSON.parse(stdout.slice(stdout.indexOf("{"))) as unknown;
  } catch {
    return null;
  }
}

/** The state of the Build window for the project folder `dir`. */
export function buildState(dir: string, out: string): Json {
  const reportPath = join(dir, out, "build-report.json");
  const project = JSON.parse(readFileSync(join(dir, PROJECT_FILE), "utf8")) as { build?: { budgets?: unknown } };
  const job = jobOf(`build:${dir}`);
  const publish = jobOf(`publish:${dir}`);
  const result = publishResult(publish.stdout);
  return {
    out,
    job: { running: job.running, log: job.log, code: job.code },
    publish: { running: publish.running, log: publish.log.slice(-10), code: publish.code, result },
    report: existsSync(reportPath) ? (JSON.parse(readFileSync(reportPath, "utf8")) as unknown) : null,
    budgets: project.build?.budgets ?? {},
  };
}

/** The result of the last send of each project folder. */
const sent = new Map<string, { readonly target: string; readonly ok: boolean; readonly text: string }>();

/** The publish targets of the host faces of the plugins of a project. */
async function targetsOf(name: string, dir: string): Promise<PublishTarget[]> {
  return (await projectHostFaces(name, dir)).flatMap((face) => face.publishTargets ?? []);
}

/** The Build state with the publish targets and the last send. */
async function buildAnswer(name: string, dir: string, out: string): Promise<Json> {
  const targets = (await targetsOf(name, dir)).map((target) => ({ id: target.id, title: target.title }));
  return { ...buildState(dir, out), targets, sent: sent.get(dir) ?? null };
}

/** Send the archive of the last publish that passed to a publish target of a plugin. */
async function sendArchive(name: string, dir: string, out: string, id: unknown): Promise<Json> {
  const target = (await targetsOf(name, dir)).find((each) => each.id === id);
  const result = publishResult(jobOf(`publish:${dir}`).stdout) as { passed?: boolean; archive?: string } | null;
  if (target === undefined) return { ok: false, reason: "The project has no such publish target." };
  if (result?.passed !== true || result.archive === undefined)
    return { ok: false, reason: "Publish the project first: the target gets the archive of the last publish." };
  try {
    const text = await target.publish({ zip: result.archive, dist: join(dir, out), dir, project: name });
    sent.set(dir, { target: target.id, ok: true, text });
    return { ok: true, text };
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    sent.set(dir, { target: target.id, ok: false, text });
    return { ok: false, reason: text };
  }
}

/** Write the size budgets of the entries into the project file. */
export function writeBudgets(dir: string, budgets: unknown): { ok: true } | { ok: false; reason: string } {
  if (typeof budgets !== "object" || budgets === null || Array.isArray(budgets)) {
    return { ok: false, reason: "the budgets are an object by entry ID" };
  }
  const checked: Json = {};
  for (const [id, value] of Object.entries(budgets)) {
    const parsed = entryBudgetSchema.safeParse(value);
    if (!parsed.success || !/^[a-z][a-z0-9-]*$/.test(id))
      return { ok: false, reason: `the budget of ${id} does not read` };
    checked[id] = parsed.data;
  }
  const path = join(dir, PROJECT_FILE);
  const project = JSON.parse(readFileSync(path, "utf8")) as Json;
  const build = typeof project.build === "object" && project.build !== null ? (project.build as Json) : {};
  project.build = { ...build, budgets: checked };
  writeFileSync(path, canonicalJson(project));
  return { ok: true };
}

async function handlePost(
  request: IncomingMessage,
  response: ServerResponse,
  project: { readonly name: string; readonly dir: string },
  what: string,
): Promise<void> {
  const { dir } = project;
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A build comes only from a page of this server." });
    return;
  }
  const input = (await readJson(request).catch(() => ({}))) as Json;
  if (what === PROJECT_BUDGETS_PATH) {
    const result = writeBudgets(dir, input.budgets);
    sendJson(response, result.ok ? 200 : 400, result);
    return;
  }
  const out = outputFolder(dir, input.out);
  if (what === PROJECT_SEND_PATH && out !== null) {
    const answer = await sendArchive(project.name, dir, out, input.target);
    sendJson(response, answer.ok === true ? 200 : 400, answer);
    return;
  }
  if (what === PROJECT_PUBLISH_PATH && out !== null) {
    const args = [cliOf("@scenity/cli"), "publish", dir, "--dist", join(dir, out), "--json"];
    const started = startCliJob(`publish:${dir}`, args, dir);
    sendJson(response, 200, started ? { ok: true } : { ok: false, reason: "A publish of the project runs already." });
    return;
  }
  if (out === null) {
    sendJson(response, 400, { ok: false, reason: "the output folder is a folder of the project" });
    return;
  }
  const started = startCliJob(
    `build:${dir}`,
    [cliOf("@scenity/cli"), "build", dir, "--json", "--out", join(dir, out)],
    dir,
  );
  sendJson(response, 200, started ? { ok: true } : { ok: false, reason: "A build of the project runs already." });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityProjectBuildApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-project-build-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const url = request.url ?? "";
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec(url.split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === EMBED_PREVIEW_PATH && request.method === "GET") {
          const params = new URL(url, "http://localhost").searchParams;
          const out = outputFolder(dir, params.get("out"));
          let options: Partial<EmbedOptions> = {};
          try {
            options = JSON.parse(params.get("options") ?? "{}") as Partial<EmbedOptions>;
          } catch {
            // Options that do not read give the defaults.
          }
          response.setHeader("Content-Type", "text/html");
          response.setHeader("Cache-Control", "no-store");
          response.end(embedPage({ ...options, base: `/projects/${match?.[1] ?? ""}/${out ?? "dist"}/` }));
        } else if (dir !== undefined && what === PROJECT_BUILD_PATH && request.method === "GET") {
          const out = outputFolder(dir, new URL(url, "http://localhost").searchParams.get("out"));
          if (out === null) sendJson(response, 400, { reason: "the output folder is a folder of the project" });
          else void buildAnswer(match?.[1] ?? "", dir, out).then((answer) => sendJson(response, 200, answer));
        } else if (
          dir !== undefined &&
          [PROJECT_BUILD_RUN_PATH, PROJECT_BUDGETS_PATH, PROJECT_PUBLISH_PATH, PROJECT_SEND_PATH].includes(what) &&
          request.method === "POST"
        ) {
          void handlePost(request, response, { name: match?.[1] ?? "", dir }, what);
        } else next();
      });
    },
  };
}
