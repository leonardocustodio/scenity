// SPDX-License-Identifier: Apache-2.0
/**
 * The check job on a dev server, a Vite plugin: `POST /projects/<name>/check.run` runs
 * `scenity check <project> --json` (the CLI of `@scenity/cli` in a child process) and answers with its report: a row
 * for each rule of each scene at each time of its scope. The Problems panel shows the rows that do not pass. The run
 * needs the import header and the same origin, as the import does.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { sendJson } from "./serverParts.ts";
import { trackJob } from "./cliJob.ts";

/** The request path of a check run, under `/projects/<name>/`. */
export const CHECK_RUN_PATH = "check.run";

/** The answer of a run: the report of `scenity check --json`, or the reason of a run with no report. */
export type CheckRunResult =
  | { readonly ok: true; readonly code: number; readonly report: unknown }
  | { readonly ok: false; readonly reason: string };

/** Run `scenity check --json` for the project folder `dir`. */
export function runCheck(dir: string): Promise<CheckRunResult> {
  const cli = join(dirname(createRequire(import.meta.url).resolve("@scenity/cli")), "cli.ts");
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  return new Promise((resolve) => {
    const child = spawn(bun, [cli, "check", dir, "--json"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    // The run goes into the journal of the Jobs panel.
    trackJob({
      key: `check:${dir}`,
      args: [cli, "check", dir, "--json"],
      cwd: dir,
      child,
      rerun: () => (void runCheck(dir), true),
    });
    const out: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (part: Buffer) => out.push(part));
    child.stderr.on("data", (part: Buffer) => errors.push(part));
    child.on("error", (error) => resolve({ ok: false, reason: error.message }));
    child.on("close", (code) => {
      const text = Buffer.concat(out).toString("utf8");
      try {
        resolve({ ok: true, code: code ?? 1, report: JSON.parse(text.slice(text.indexOf("{"))) as unknown });
      } catch {
        const reason = Buffer.concat([...errors, ...out])
          .toString("utf8")
          .trim();
        resolve({ ok: false, reason: reason === "" ? "scenity check gave no report" : reason });
      }
    });
  });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityCheckApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-check-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (dir === undefined || match?.[2] !== CHECK_RUN_PATH || request.method !== "POST") {
          next();
          return;
        }
        if (isRemote(process.env) || !sameOriginImport(request)) {
          sendJson(response, 403, { ok: false, reason: "A check comes only from a page of this server." });
          return;
        }
        void runCheck(dir).then((result) => sendJson(response, result.ok ? 200 : 500, result));
      });
    },
  };
}
