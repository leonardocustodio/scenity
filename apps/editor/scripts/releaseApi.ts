// SPDX-License-Identifier: Apache-2.0
/**
 * The release check panel on a dev server, a Vite plugin: `POST /projects/<name>/
 * assets.release.run` runs `assets release-check <project> --json` (the asset CLI in a child process) and answers
 * with its report. The run needs the import header and the same origin, as the import does.
 */
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type { Plugin } from "vite";
import { ASSET_RELEASE_RUN_PATH, type ReleaseRunResult } from "../src/assetBrowser/assetTypes.ts";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { sendJson } from "./serverParts.ts";
import { trackJob } from "./cliJob.ts";

/** Run the release gate of the project folder `dir` with the asset CLI. */
export function runReleaseCheck(dir: string): Promise<ReleaseRunResult> {
  const cli = join(dirname(createRequire(import.meta.url).resolve("@scenity/assets")), "cli.ts");
  const versions: Readonly<Record<string, string | undefined>> = process.versions;
  const bun = versions.bun === undefined ? "bun" : process.execPath;
  return new Promise((resolve) => {
    const child = spawn(bun, [cli, "release-check", dir, "--json"], { cwd: dir, stdio: ["ignore", "pipe", "pipe"] });
    // The check goes into the journal of the Jobs panel.
    trackJob({
      key: `assets.release-check:${dir}`,
      args: [cli, "release-check", dir, "--json"],
      ...{ cwd: dir, child, rerun: () => (void runReleaseCheck(dir), true) },
    });
    const out: Buffer[] = [];
    const errors: Buffer[] = [];
    child.stdout.on("data", (part: Buffer) => out.push(part));
    child.stderr.on("data", (part: Buffer) => errors.push(part));
    child.on("error", (error) => resolve({ ok: false, reason: error.message }));
    child.on("close", () => {
      try {
        const report = JSON.parse(Buffer.concat(out).toString("utf8")) as Omit<
          Extract<ReleaseRunResult, { ok: true }>,
          "ok"
        >;
        resolve({ ok: true, ...report });
      } catch {
        const text = Buffer.concat([...errors, ...out])
          .toString("utf8")
          .trim();
        resolve({ ok: false, reason: text === "" ? "the release check gave no report" : text });
      }
    });
  });
}

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityReleaseApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-release-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        if (dir === undefined || match?.[2] !== ASSET_RELEASE_RUN_PATH || request.method !== "POST") {
          next();
          return;
        }
        if (isRemote(process.env) || !sameOriginImport(request)) {
          sendJson(response, 403, { ok: false, reason: "A release check comes only from a page of this server." });
          return;
        }
        void runReleaseCheck(dir).then((result) => sendJson(response, result.ok ? 200 : 500, result));
      });
    },
  };
}
