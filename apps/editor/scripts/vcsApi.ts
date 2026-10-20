// SPDX-License-Identifier: Apache-2.0
/**
 * The version control panel on a dev server, a Vite plugin. The paths are relative to the project
 * folder. Git runs with no shell, in the project folder, on the files of the project folder only.
 *
 * - `GET /projects/<name>/vcs.status.json`: the branch and the changed files (`{ git: false }` with no Git).
 * - `GET /projects/<name>/vcs.diff.json?path=<path>`: the patch of a file against HEAD, the text at HEAD and the current
 *   text (the page makes the semantic diff of a document from the two texts).
 * - `POST /projects/<name>/vcs.commit`: `{ message, paths }`, a commit of these files by the owner (one line only).
 * - `GET /projects/<name>/vcs.branches.json`: the branches (the current one, the upstream) and the worktrees.
 * - `POST /projects/<name>/vcs.switch`: `{ branch }`, a switch to a branch. The server refuses it while the checkout has changes.
 *
 * The posts need the import header and the same origin, as the import does.
 */
import { execFile } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { join, relative, resolve, sep } from "node:path";
import type { Plugin } from "vite";
import { sameOriginImport } from "./assetApiServer.ts";
import { isRemote } from "./labsFs.ts";
import { readJson, sendJson } from "./serverParts.ts";

/** The largest patch or text of a file in an answer (bytes). */
const MAX_TEXT = 2_000_000;

interface GitRun {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

/** Run Git in a folder (no shell). */
export function git(cwd: string, args: readonly string[]): Promise<GitRun> {
  return new Promise((done) => {
    execFile("git", [...args], { cwd, maxBuffer: 16 * MAX_TEXT, encoding: "utf8" }, (error, stdout, stderr) => {
      const code = error === null ? 0 : typeof error.code === "number" ? error.code : 1;
      done({ code, stdout, stderr });
    });
  });
}

/** The root of the checkout of a folder and the place of the folder in it ("" or "<path>/"), or null with no Git. */
async function checkoutOf(dir: string): Promise<{ root: string; prefix: string } | null> {
  // Git gives the place of the folder itself: the root can have another spelling (a link such as /private/var).
  const run = await git(dir, ["rev-parse", "--show-toplevel", "--show-prefix"]);
  if (run.code !== 0) return null;
  const [root = "", prefix = ""] = run.stdout.split("\n");
  return { root, prefix };
}

/** A path of the project folder, or null for a path outside it. */
function insidePath(dir: string, path: unknown): string | null {
  if (typeof path !== "string" || path === "" || path.includes("\0")) return null;
  const full = resolve(dir, path);
  const rel = relative(dir, full);
  return rel === "" || rel.startsWith("..") || resolve(dir, rel) !== full ? null : rel.split(sep).join("/");
}

/** One changed file: its path in the project folder and its status letter (M, A, D, R, ? for a new file). */
export interface VcsFile {
  readonly path: string;
  readonly status: string;
}

/** The current branch: its name, or `HEAD` and the short commit when no branch is checked out. */
async function branchOf(dir: string): Promise<string> {
  const name = (await git(dir, ["branch", "--show-current"])).stdout.trim();
  if (name !== "") return name;
  const head = (await git(dir, ["rev-parse", "--short", "HEAD"])).stdout.trim();
  return head === "" ? "HEAD" : `HEAD ${head}`;
}

/** The changed files of the project folder, from `git status --porcelain -z`. */
export function parsePorcelain(text: string, prefix: string): VcsFile[] {
  const parts = text.split("\0");
  const files: VcsFile[] = [];
  for (let index = 0; index < parts.length; index += 1) {
    const entry = parts[index] ?? "";
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2);
    const path = entry.slice(3);
    // A rename has the old path in the next part.
    if (xy.includes("R") || xy.includes("C")) index += 1;
    const status = xy === "??" ? "?" : (xy.replace(/ /g, "")[0] ?? "M");
    if (path.startsWith(prefix)) files.push({ path: path.slice(prefix.length), status });
  }
  return files.sort((a, b) => a.path.localeCompare(b.path));
}

/** The answer of a status request. */
export async function vcsStatus(dir: string): Promise<Record<string, unknown>> {
  const checkout = await checkoutOf(dir);
  if (checkout === null) return { git: false, branch: null, files: [] };
  const run = await git(dir, ["status", "--porcelain=v1", "-z", "--untracked-files=all", "--", "."]);
  if (run.code !== 0) throw new Error(run.stderr.trim());
  return { git: true, branch: await branchOf(dir), files: parsePorcelain(run.stdout, checkout.prefix) };
}

/** The patch of a new file: each line added. */
function newFilePatch(path: string, text: string): string {
  const lines = text.split("\n");
  if (lines.at(-1) === "") lines.pop();
  return [
    `diff --git a/${path} b/${path}`,
    "new file",
    `@@ -0,0 +1,${String(lines.length)} @@`,
    ...lines.map((line) => `+${line}`),
  ].join("\n");
}

/** The answer of a diff request: the patch, the text at HEAD and the current text (null: no file). */
export async function vcsDiff(dir: string, path: string): Promise<Record<string, unknown>> {
  const checkout = await checkoutOf(dir);
  if (checkout === null) throw new Error("the project folder has no Git");
  const full = join(dir, path);
  const after = existsSync(full) ? readFileSync(full, "utf8") : null;
  const head = await git(dir, ["show", `HEAD:${checkout.prefix}${path}`]);
  const before = head.code === 0 ? head.stdout : null;
  const patch =
    before === null && after !== null
      ? newFilePatch(path, after)
      : (await git(dir, ["diff", "--no-color", "HEAD", "--", path])).stdout;
  const cut = (text: string | null): string | null => (text !== null && text.length > MAX_TEXT ? null : text);
  return { path, patch: patch.slice(0, MAX_TEXT), before: cut(before), after: cut(after) };
}

/** A commit of the files by the owner. The answer has the new commit. */
export async function vcsCommit(dir: string, message: unknown, paths: unknown): Promise<{ commit: string }> {
  if (typeof message !== "string" || message.trim() === "" || /[\r\n]/.test(message))
    throw new Error("the commit message is one line");
  const list = Array.isArray(paths) ? paths.map((path) => insidePath(dir, path)) : [];
  if (list.length === 0 || list.some((path) => path === null)) throw new Error("the paths are files of the project");
  const files = list as string[];
  const add = await git(dir, ["add", "-A", "--", ...files]);
  if (add.code !== 0) throw new Error(add.stderr.trim());
  const commit = await git(dir, ["commit", "-m", message.trim(), "--", ...files]);
  if (commit.code !== 0) throw new Error((commit.stdout + commit.stderr).trim());
  return { commit: (await git(dir, ["rev-parse", "HEAD"])).stdout.trim() };
}

/** The worktrees of `git worktree list --porcelain`. */
export function parseWorktrees(text: string): { path: string; branch: string | null; head: string }[] {
  return text
    .split("\n\n")
    .map((block) => block.split("\n"))
    .filter((lines) => lines[0]?.startsWith("worktree ") === true)
    .map((lines) => {
      const value = (key: string): string | undefined =>
        lines.find((line) => line.startsWith(`${key} `))?.slice(key.length + 1);
      const branch = value("branch")?.replace(/^refs\/heads\//, "") ?? null;
      return { path: value("worktree") ?? "", branch, head: value("HEAD") ?? "" };
    });
}

/** The answer of a branches request. */
export async function vcsBranches(dir: string): Promise<Record<string, unknown>> {
  if ((await checkoutOf(dir)) === null) return { git: false, branches: [], worktrees: [] };
  const format = "%(refname:short)%09%(HEAD)%09%(upstream:short)%09%(committerdate:iso-strict)";
  const refs = await git(dir, ["for-each-ref", `--format=${format}`, "refs/heads"]);
  const branches = refs.stdout
    .split("\n")
    .filter((line) => line !== "")
    .map((line) => {
      const [name = "", head = "", upstream = "", date = ""] = line.split("\t");
      return { name, current: head === "*", upstream: upstream === "" ? null : upstream, date };
    });
  const worktrees = parseWorktrees((await git(dir, ["worktree", "list", "--porcelain"])).stdout);
  return { git: true, branches, worktrees };
}

/** A switch to a branch. The server refuses it while the checkout has changes. */
export async function vcsSwitch(dir: string, branch: unknown): Promise<{ branch: string }> {
  const known = ((await vcsBranches(dir)).branches as { name: string }[]).map((item) => item.name);
  if (typeof branch !== "string" || !known.includes(branch)) throw new Error("no such branch");
  const checkout = await checkoutOf(dir);
  const dirty = await git(checkout?.root ?? dir, ["status", "--porcelain"]);
  if (dirty.stdout.trim() !== "") throw new Error("the checkout has changes: commit them first");
  const run = await git(dir, ["switch", branch]);
  if (run.code !== 0) throw new Error(run.stderr.trim());
  return { branch };
}

const reasonOf = (error: unknown): string => (error instanceof Error ? error.message : String(error));

/** The answer of one request: the status code and the JSON body. */
async function answerOf(request: IncomingMessage, dir: string, what: string): Promise<[number, unknown]> {
  if (what === "vcs.status.json") return [200, await vcsStatus(dir)];
  if (what === "vcs.branches.json") return [200, await vcsBranches(dir)];
  if (what === "vcs.diff.json") {
    const path = insidePath(dir, new URL(request.url ?? "", "http://localhost").searchParams.get("path"));
    return path === null ? [400, { reason: "the path is a file of the project" }] : [200, await vcsDiff(dir, path)];
  }
  if (isRemote(process.env) || !sameOriginImport(request))
    return [403, { reason: "Git changes come only from a page of this server." }];
  const input = (await readJson(request)) as { message?: unknown; paths?: unknown; branch?: unknown };
  if (what === "vcs.commit") return [200, await vcsCommit(dir, input.message, input.paths)];
  return [200, await vcsSwitch(dir, input.branch)];
}

async function handle(request: IncomingMessage, response: ServerResponse, dir: string, what: string): Promise<void> {
  try {
    const [status, body] = await answerOf(request, dir, what);
    sendJson(response, status, body);
  } catch (error) {
    sendJson(response, 400, { reason: reasonOf(error) });
  }
}

const ROUTES: Readonly<Record<string, "GET" | "POST">> = {
  "vcs.status.json": "GET",
  "vcs.diff.json": "GET",
  "vcs.branches.json": "GET",
  "vcs.commit": "POST",
  "vcs.switch": "POST",
};

/** The plugin. `projects` maps a project name to its folder (absolute), as for `scenityProjects`. */
export function scenityVcsApi(projects: Readonly<Record<string, string>>): Plugin {
  return {
    name: "scenity-vcs-api",
    apply: "serve",
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        const match = /^\/projects\/([a-z0-9-]+)\/(.+)$/.exec((request.url ?? "").split("?")[0] ?? "");
        const dir = match?.[1] === undefined ? undefined : projects[match[1]];
        const what = match?.[2] ?? "";
        if (dir !== undefined && ROUTES[what] === request.method) void handle(request, response, dir, what);
        else next();
      });
    },
  };
}
