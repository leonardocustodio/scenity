// SPDX-License-Identifier: Apache-2.0
/**
 * The scene pool controls on a dev server, a Vite plugin for Preferences → Advanced:
 *
 * - `GET /pool.json`: the state of the pool (`scenity pool status --json`: the origin, the pages, the leases), or
 *   `{ running: false }` when no pool runs.
 * - `POST /pool.run`: `{ action: "start", pages }` starts `scenity pool start` as a child process of the server (the
 *   pool runs until a stop). `{ action: "stop" }` runs `scenity pool stop`.
 *
 * The machine has one pool (`SCENITY_SCENE_POOL_DIR`, else a folder in the temp folder of the user). The post
 * needs the import header and the same origin, as the import does.
 */
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { cliOf, jobOf, lockArgs, runCli, startCliJob } from "./cliJob.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The current state of the pool. */
export async function poolState(): Promise<Record<string, unknown>> {
  const run = await runCli([cliOf("@scenity/cli"), "pool", "status", "--json"], process.cwd(), 15_000);
  const job = jobOf("pool");
  const base = { starting: job.running && run.status !== 0, log: job.log.slice(-6) };
  if (run.status !== 0) return { running: false, ...base, detail: run.stdout.trim() };
  try {
    return { running: true, ...base, ...(JSON.parse(run.stdout) as Record<string, unknown>) };
  } catch {
    return { running: false, ...base, detail: run.stdout.trim() };
  }
}

/** Start or stop the pool. */
export async function poolAction(input: {
  action?: unknown;
  pages?: unknown;
}): Promise<{ ok: boolean; reason?: string }> {
  if (input.action === "stop") {
    const run = await runCli([cliOf("@scenity/cli"), "pool", "stop"], process.cwd());
    return run.status === 0 ? { ok: true } : { ok: false, reason: run.stdout.trim() || run.stderr.trim() };
  }
  if (input.action !== "start") return { ok: false, reason: "the action is start or stop" };
  const pages = typeof input.pages === "number" && input.pages >= 1 && input.pages <= 8 ? Math.round(input.pages) : 2;
  const args = [cliOf("@scenity/cli"), "pool", "start", "--pages", String(pages), ...lockArgs()];
  return startCliJob("pool", args, process.cwd()) ? { ok: true } : { ok: false, reason: "The pool runs already." };
}

/** The plugin. */
export function scenityPoolApi(): Plugin {
  return {
    name: "scenity-pool-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const path = (request.url ?? "").split("?")[0] ?? "";
        if (path === "/pool.json" && request.method === "GET") {
          void poolState().then((state) => sendJson(response, 200, state));
        } else if (path === "/pool.run" && request.method === "POST") {
          if (isRemote(process.env) || !sameOriginImport(request)) {
            sendJson(response, 403, { ok: false, reason: "The pool changes only from a page of this server." });
            return;
          }
          void readJson(request)
            .catch(() => ({}))
            .then((input) => poolAction(input as Record<string, unknown>))
            .then((answer) => sendJson(response, 200, answer));
        } else next();
      });
    },
  };
}
