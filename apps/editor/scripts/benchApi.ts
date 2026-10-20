// SPDX-License-Identifier: Apache-2.0
/**
 * The bench runner on a dev server, a Vite plugin:
 *
 * - `POST /projects/<name>/bench.run`: start `scenity bench <project> --json` (the CLI of `@scenity/cli` in a child
 *   process, one run at a time; `{ quick, tier }`). The run makes the build of the project when it has none. At the
 *   end the report goes into the history of the project (`.scenity/bench/history.jsonl`, one report a line).
 * - `GET .../bench.json`: the job (running, its log, its exit code) and the history, the newest last.
 *
 * `SCENITY_BENCH_LOCK` names another GPU lock file for the runs (a test that holds the lock of the labs tools). The
 * run needs the import header and the same origin, as the import does.
 */
import { spawn } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { lockArgs, trackJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

export const BENCH_RUN_PATH = "bench.run";
export const BENCH_STATE_PATH = "bench.json";
/** The history file of a project, relative to the project folder. */
export const BENCH_HISTORY = ".scenity/bench/history.jsonl";
/** The most log lines that the job keeps. */
const LOG_LINES = 300;

interface Job {
  running: boolean;
  log: string[];
  code: number | null;
}
const jobs = new Map<string, Job>();

/** The reports of the history of a project, the oldest first (a line that does not read is left out). */
export function benchHistory(dir: string): unknown[] {
  const path = join(dir, BENCH_HISTORY);
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .flatMap((line) => {
      if (line.trim() === "") return [];
      try {
        return [JSON.parse(line) as unknown];
      } catch {
        return [];
      }
    });
}

/** Start a bench run of the project folder `dir`. False when a run of the folder is active. */
export function startBench(dir: string, options: { readonly quick?: boolean; readonly tier?: string }): boolean {
  if (jobs.get(dir)?.running === true) return false;
  const job: Job = { running: true, log: [], code: null };
  jobs.set(dir, job);
  const cli = join(dirname(createRequire(import.meta.url).resolve("@scenity/cli")), "cli.ts");
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  const lock = lockArgs();
  const tier = typeof options.tier === "string" && /^[a-z]+$/.test(options.tier) ? ["--tier", options.tier] : [];
  const args = [cli, "bench", dir, "--json", ...(options.quick === true ? ["--quick"] : []), ...tier];
  const child = spawn(bun, [...args, ...lock], {
    cwd: dir,
    stdio: ["ignore", "pipe", "pipe"],
  });
  // The run goes into the journal of the Jobs panel.
  trackJob({ key: `bench:${dir}`, args: [...args, ...lock], cwd: dir, child, rerun: () => startBench(dir, options) });
  const out: Buffer[] = [];
  const add = (part: Buffer): void => {
    job.log.push(
      ...part
        .toString("utf8")
        .split("\n")
        .filter((line) => line.trim() !== ""),
    );
    if (job.log.length > LOG_LINES) job.log.splice(0, job.log.length - LOG_LINES);
  };
  child.stdout.on("data", (part: Buffer) => out.push(part));
  child.stderr.on("data", add);
  child.on("error", (error) => {
    job.log.push(error.message);
    job.running = false;
    job.code = 1;
  });
  child.on("close", (code) => {
    const text = Buffer.concat(out).toString("utf8");
    try {
      // The report is the last output: a JSON object of `scenity bench --json` (`{` then `"format"`).
      const report = JSON.parse(text.slice(text.search(/\{\s*"format"/))) as unknown;
      mkdirSync(dirname(join(dir, BENCH_HISTORY)), { recursive: true });
      appendFileSync(join(dir, BENCH_HISTORY), `${JSON.stringify(report)}\n`);
    } catch {
      job.log.push(
        ...text
          .split("\n")
          .filter((line) => line.trim() !== "")
          .slice(-20),
      );
    }
    job.running = false;
    job.code = code ?? 1;
  });
  return true;
}

async function handleRun(request: IncomingMessage, response: ServerResponse, dir: string): Promise<void> {
  if (isRemote(process.env) || !sameOriginImport(request)) {
    sendJson(response, 403, { ok: false, reason: "A bench run comes only from a page of this server." });
    return;
  }
  const input = (await readJson(request).catch(() => ({}))) as { quick?: boolean; tier?: string };
  sendJson(response, 200, startBench(dir, input) ? { ok: true } : { ok: false, reason: "A bench run goes on." });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityBenchApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-bench-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && what === BENCH_STATE_PATH && request.method === "GET") {
          const job = jobs.get(dir) ?? { running: false, log: [], code: null };
          sendJson(response, 200, { job: { ...job, log: [...job.log] }, history: benchHistory(dir) });
        } else if (dir !== undefined && what === BENCH_RUN_PATH && request.method === "POST") {
          void handleRun(request, response, dir);
        } else next();
      });
    },
  };
}
