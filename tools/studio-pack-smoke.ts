// SPDX-License-Identifier: Apache-2.0
/**
 * The proof of a studio that installs from npm. The release packs of the public packages go into a temp folder
 * outside the checkout (a Bun install with no links), and `scenity studio` starts Scenity Studio from them.
 * The browser signs in, the Hub draws, a plain folder becomes a project through the API, and the editor page of that
 * project draws its scene. Nothing goes to npm. The third-party packages come from the registry.
 *
 *     bun tools/studio-pack-smoke.ts [--packs <dir>] [--keep]
 *
 * `--packs` takes the tarballs of an earlier `bun tools/release.ts pack --all --out <dir>`. With no `--packs`, the
 * tool packs first. `--keep` keeps the temp folder. The exit code is 1 when a step fails.
 */
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";

const ROOT = resolve(import.meta.dir, "..");
const READY_PREFIX = "SCENITY_STUDIO_READY ";

const { values } = parseArgs({ options: { packs: { type: "string" }, keep: { type: "boolean", default: false } } });

function step(text: string): void {
  console.log(`studio-pack-smoke: ${text}`);
}

function run(cmd: string, args: string[], cwd: string): void {
  const result = spawnSync(cmd, args, { cwd, stdio: "inherit", env: cleanEnv() });
  if (result.status !== 0) throw new Error(`${cmd} ${args.join(" ")} ended with ${String(result.status)}`);
}

/** The environment with no variable that points a command at this checkout. */
function cleanEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined && !["SCENITY_CHECKOUT", "SCENITY_PROJECT"].includes(key)) env[key] = value;
  }
  return env;
}

/** The tarball of each package of the packs folder (`scenity-<name>-<version>.tgz`). */
function tarballs(packs: string): Record<string, string> {
  const folder = join(packs, "packages");
  const out: Record<string, string> = {};
  for (const file of readdirSync(folder).filter((name) => name.endsWith(".tgz"))) {
    const name = /^scenity-(.+)-\d+\.\d+\.\d+.*\.tgz$/.exec(file)?.[1];
    if (name !== undefined) out[`@scenity/${name}`] = `file:${join(folder, file)}`;
  }
  return out;
}

/** A temp app folder with the studio host and the CLI from the packs; every Scenity package resolves to its pack. */
function installApp(packs: string, app: string): void {
  const files = tarballs(packs);
  for (const name of ["@scenity/studio-host", "@scenity/cli", "@scenity/editor"]) {
    if (files[name] === undefined) throw new Error(`no pack of ${name} in ${packs}`);
  }
  const manifest = {
    name: "studio-pack-smoke",
    private: true,
    dependencies: { "@scenity/cli": files["@scenity/cli"], "@scenity/studio-host": files["@scenity/studio-host"] },
    overrides: files,
  };
  writeFileSync(join(app, "package.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  run(process.execPath, ["install"], app);
}

interface Studio {
  readonly url: string;
  readonly origin: string;
  stop(): Promise<void>;
}

/** A free TCP port of 127.0.0.1. */
function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      probe.close(() => done(typeof address === "object" && address !== null ? address.port : 0));
    });
  });
}

/** Start `scenity studio` of the app folder and wait for its ready line. */
function startStudio(app: string, port: number): Promise<Studio> {
  const child = spawn(
    process.execPath,
    ["x", "scenity", "studio", "--no-open", "--port", String(port), "--state", join(app, "state"), "--root", app],
    { cwd: app, env: cleanEnv(), stdio: ["ignore", "pipe", "inherit"], detached: true },
  );
  const stop = async (): Promise<void> => {
    if (child.exitCode !== null) return;
    const ended = new Promise<void>((done) => child.once("exit", () => done()));
    process.kill(-(child.pid ?? 0), "SIGTERM");
    await ended;
  };
  return new Promise((done, fail) => {
    let text = "";
    const timer = setTimeout(() => fail(new Error(`no ready line in 180 s: ${text}`)), 180_000);
    child.stdout.on("data", (chunk: Buffer) => {
      text += chunk.toString("utf8");
      const line = text.split("\n").find((l) => l.startsWith(READY_PREFIX));
      if (line === undefined) return;
      clearTimeout(timer);
      const ready = JSON.parse(line.slice(READY_PREFIX.length)) as { url: string; origin: string };
      done({ ...ready, stop });
    });
    child.once("exit", (code) => fail(new Error(`the studio ended with ${String(code)}: ${text}`)));
  });
}

/** The parts of Playwright that the tool uses. Playwright comes from apps/editor: the tools folder does not have it. */
interface Waitable {
  waitFor(options: { timeout: number }): Promise<void>;
}
interface SmokePage {
  goto(url: string): Promise<unknown>;
  getByTestId(id: string): Waitable;
  locator(selector: string): Waitable;
  evaluate<T, A = undefined>(work: (arg: A) => T | Promise<T>, arg?: A): Promise<T>;
}
interface Chromium {
  launch(): Promise<{ newPage(): Promise<SmokePage>; close(): Promise<void> }>;
}

/** Sign in, see the Hub, make a project of a plain folder and see its editor page draw. */
async function checkPages(studio: Studio, app: string): Promise<void> {
  const require = createRequire(join(ROOT, "apps", "editor", "package.json"));
  const { chromium } = require("@playwright/test") as { chromium: Chromium };
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(studio.url);
    await page.getByTestId("hub").waitFor({ timeout: 120_000 });
    step("the Hub draws");
    const state = await page.evaluate(async () => (await (await fetch("/api/state")).json()) as { checkout: boolean });
    if (state.checkout) throw new Error("the installed studio says that it runs from a checkout");
    const folder = join(app, "plain");
    mkdirSync(folder);
    const opened = await page.evaluate(async (dir: string) => {
      const csrf = /scenity_studio_csrf=([^;]+)/.exec(document.cookie)?.[1] ?? "";
      const answer = await fetch("/api/projects/make", {
        method: "POST",
        headers: { "content-type": "application/json", "x-studio-csrf": decodeURIComponent(csrf) },
        body: JSON.stringify({ dir }),
      });
      return (await answer.json()) as { url?: string; error?: string };
    }, folder);
    if (opened.url === undefined) throw new Error(`make project: ${opened.error ?? "no url"}`);
    await page.goto(`${studio.origin}${opened.url}`);
    await page.locator('canvas[data-ready="1"]').waitFor({ timeout: 180_000 });
    step("the editor page draws the new project");
  } finally {
    await browser.close();
  }
}

async function main(): Promise<void> {
  const temp = mkdtempSync(join(tmpdir(), "scenity-studio-smoke-"));
  let studio: Studio | null = null;
  try {
    const packs = values.packs === undefined ? join(temp, "packs") : resolve(values.packs);
    if (values.packs === undefined)
      run(process.execPath, [join(ROOT, "tools", "release.ts"), "pack", "--all", "--out", packs], ROOT);
    const app = join(temp, "app");
    mkdirSync(app);
    installApp(packs, app);
    step(`installed the packs in ${app}`);
    studio = await startStudio(app, await freePort());
    step(`the studio runs on ${studio.origin}`);
    await checkPages(studio, app);
    step("passed");
  } finally {
    await studio?.stop();
    if (values.keep) step(`kept ${temp}`);
    else rmSync(temp, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(`studio-pack-smoke: FAILED: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
