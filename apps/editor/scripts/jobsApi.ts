// SPDX-License-Identifier: Apache-2.0
/**
 * The Jobs panel on a dev server, a Vite plugin:
 *
 * - `GET /jobs.json`: the journal of the jobs of the dev server (cliJob.ts), the newest first. Each output file of a
 *   project folder has its URL on the server.
 * - `POST /jobs.again` and `POST /jobs.cancel`: `{ id }`, run a job of the journal again, or stop a running job.
 * - `GET /projects/<name>/runs.json`: the runs of the project (`workbench.runs` of the project file) with their
 *   presets, and whether the project is restricted.
 * - `POST /projects/<name>/runs.start`: `{ id, preset }`, start a run in the project folder. The command line runs with
 *   no shell. `scenity` is the CLI of this checkout. A restricted project has no runs.
 * - `GET /projects/<name>/cli.commands.json`: the commands of the CLI faces of the plugins of the project (the
 *   list of `scenity --help` for the project). `POST /projects/<name>/cli.run`: `{ name, args }`, a run of one of them
 *   as a job (the arguments as a command line).
 *
 * The posts need the import header and the same origin, as the import does.
 */
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, sep } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { cancelJob, cliOf, journal, rerunJob, runCli, startCliJob, trackJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { RESTRICTED_PROJECTS } from "./projectsFile.ts";
import { readJson, sendJson } from "./serverParts.ts";

type Projects = Readonly<Record<string, string>>;
type Json = Readonly<Record<string, unknown>>;
const isRecord = (value: unknown): value is Json =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A run of the project as the panel shows it. */
export interface ProjectRunInfo {
  readonly id: string;
  readonly label: string;
  readonly command: string;
  readonly presets: readonly { readonly label: string; readonly args: readonly string[] }[];
}

/** The runs of a project file value (`workbench.runs`: a command line, or a run object with presets). */
export function projectRuns(project: unknown): ProjectRunInfo[] {
  const workbench = isRecord(project) && isRecord(project.workbench) ? project.workbench : {};
  const runs = isRecord(workbench.runs) ? workbench.runs : {};
  return Object.entries(runs).flatMap(([id, value]): ProjectRunInfo[] => {
    if (typeof value === "string") return [{ id, label: id, command: value, presets: [] }];
    if (!isRecord(value) || typeof value.command !== "string") return [];
    const presets = (Array.isArray(value.presets) ? value.presets : []).filter(isRecord).map((preset) => ({
      label: typeof preset.label === "string" ? preset.label : "",
      args: Array.isArray(preset.args) ? preset.args.filter((arg): arg is string => typeof arg === "string") : [],
    }));
    return [{ id, label: typeof value.label === "string" ? value.label : id, command: value.command, presets }];
  });
}

/** The words of a command line. Spaces divide the words, and a quoted part keeps its spaces. */
export function commandWords(line: string): string[] {
  return [...line.matchAll(/"([^"]*)"|'([^']*)'|(\S+)/g)].map((match) => match[1] ?? match[2] ?? match[3] ?? "");
}

const running = new Set<string>();

/** Start a run of the project folder `dir`; the reason of a refusal, or null. */
export function startRun(name: string, dir: string, id: unknown, preset: unknown): string | null {
  if (RESTRICTED_PROJECTS.has(name)) return "A restricted project has no runs: trust the project first.";
  const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as unknown;
  const run = projectRuns(project).find((item) => item.id === id);
  if (run === undefined) return "The project has no such run.";
  const extra = typeof preset === "number" ? (run.presets[preset]?.args ?? []) : [];
  const [program = "", ...rest] = commandWords(run.command);
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  const argv = program === "scenity" ? [bun, cliOf("@scenity/cli"), ...rest, ...extra] : [program, ...rest, ...extra];
  const key = `run:${name}:${String(id)}`;
  if (running.has(key)) return "The run goes on already.";
  running.add(key);
  const child = spawn(argv[0] ?? "", argv.slice(1), { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
  child.on("error", () => running.delete(key));
  child.on("close", () => running.delete(key));
  trackJob({
    key,
    args: argv.slice(program === "scenity" ? 1 : 0),
    cwd: dir,
    child,
    rerun: () => startRun(name, dir, id, preset) === null,
  });
  return null;
}

/** The commands of the plugins of a `scenity --help` text: the lines after "commands of the project plugins:". */
export function helpPluginCommands(text: string): { name: string; summary: string }[] {
  const lines = text.split("\n");
  const start = lines.findIndex((line) => line.trim() === "commands of the project plugins:");
  if (start < 0) return [];
  return lines.slice(start + 1).flatMap((line) => {
    const match = /^ {2}(\S+)\s+(.*)$/.exec(line);
    return match === null ? [] : [{ name: match[1] ?? "", summary: (match[2] ?? "").trim() }];
  });
}

/** The commands of the plugins of each project folder, for 5 s (a list runs the CLI). */
const known = new Map<string, { at: number; commands: { name: string; summary: string }[] }>();

/** The commands of the plugins of a project folder (none for a restricted project). */
export async function cliCommands(name: string, dir: string): Promise<{ name: string; summary: string }[]> {
  if (RESTRICTED_PROJECTS.has(name)) return [];
  const cached = known.get(dir);
  if (cached !== undefined && Date.now() - cached.at < 5000) return cached.commands;
  const run = await runCli([cliOf("@scenity/cli"), "--help", "--project", dir], dir);
  const commands = helpPluginCommands(run.stdout);
  known.set(dir, { at: Date.now(), commands });
  return commands;
}

/** Start a command of a plugin as a job; the reason of a refusal, or null. */
export async function startCliCommand(
  name: string,
  dir: string,
  command: unknown,
  args: unknown,
): Promise<string | null> {
  if (RESTRICTED_PROJECTS.has(name))
    return "A restricted project has no commands of its plugins: trust the project first.";
  if (typeof command !== "string" || !(await cliCommands(name, dir)).some((item) => item.name === command))
    return "The project has no such command.";
  const argv = [
    cliOf("@scenity/cli"),
    command,
    ...commandWords(typeof args === "string" ? args : ""),
    "--project",
    dir,
  ];
  return startCliJob(`cli:${command}:${dir}`, argv, dir) ? null : "The command runs already.";
}

/** The URL of an output file on the dev server, or null for a file outside each project folder. */
function outputUrl(projects: Projects, path: string): string | null {
  for (const [name, dir] of Object.entries(projects)) {
    const rel = relative(dir, path);
    if (rel !== "" && !rel.startsWith(".."))
      return `/projects/${name}/${rel.split(sep).map(encodeURIComponent).join("/")}`;
  }
  return null;
}

/** The answer of the journal request. */
export function jobsAnswer(projects: Projects): Record<string, unknown> {
  const projectOf = (cwd: string): string | null =>
    Object.entries(projects).find(([, dir]) => dir === cwd)?.[0] ?? null;
  return {
    jobs: journal().map((record) => ({
      ...record,
      project: projectOf(record.cwd),
      log: record.log.slice(-60),
      outputs: record.outputs.map((path) => ({ path, url: outputUrl(projects, path) })),
    })),
  };
}

async function handlePost(
  request: IncomingMessage,
  response: ServerResponse,
  what: string,
  run?: { name: string; dir: string },
): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A job comes only from a page of this server." });
    return;
  }
  const input = (await readJson(request).catch(() => ({}))) as {
    id?: unknown;
    preset?: unknown;
    name?: unknown;
    args?: unknown;
  };
  if (run !== undefined) {
    const reason = what.endsWith("/cli.run")
      ? await startCliCommand(run.name, run.dir, input.name, input.args)
      : startRun(run.name, run.dir, input.id, input.preset);
    sendJson(response, reason === null ? 200 : 400, reason === null ? { ok: true } : { ok: false, reason });
    return;
  }
  const id = typeof input.id === "string" ? input.id : "";
  const ok = what === "/jobs.again" ? rerunJob(id) : cancelJob(id);
  sendJson(response, ok ? 200 : 400, ok ? { ok } : { ok, reason: "The job does not run, or it runs already." });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityJobsApi(projects: Projects): Plugin {
  return {
    name: "scenity-jobs-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        const match = /^\/projects\/([a-z0-9-]+)\/(runs\.json|runs\.start|cli\.commands\.json|cli\.run)$/.exec(path);
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (path === "/jobs.json" && request.method === "GET") sendJson(response, 200, jobsAnswer(projects));
        else if ((path === "/jobs.again" || path === "/jobs.cancel") && request.method === "POST")
          void handlePost(request, response, path);
        else if (dir !== undefined && match?.[2] === "runs.json" && request.method === "GET") {
          try {
            const project = JSON.parse(readFileSync(join(dir, "scenity.project.json"), "utf8")) as unknown;
            sendJson(response, 200, {
              runs: projectRuns(project),
              restricted: RESTRICTED_PROJECTS.has(match[1] ?? ""),
            });
          } catch (error) {
            sendJson(response, 500, { reason: error instanceof Error ? error.message : String(error) });
          }
        } else if (dir !== undefined && match?.[2] === "cli.commands.json" && request.method === "GET")
          void cliCommands(match[1] ?? "", dir).then((commands) => sendJson(response, 200, { commands }));
        else if (dir !== undefined && match?.[2] === "cli.run" && request.method === "POST")
          void handlePost(request, response, path, { name: match[1] ?? "", dir });
        else if (dir !== undefined && match?.[2] === "runs.start" && request.method === "POST")
          void handlePost(request, response, path, { name: match[1] ?? "", dir });
        else next();
      });
    },
  };
}
