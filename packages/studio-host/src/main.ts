#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The command line of the studio host:
 *
 *   scenity-studio [--project <dir>] [--port <n>] [--state <dir>] [--root <dir>]... [--no-open] [--safe] [--no-agent]
 *                  [--public-origin <url>]
 *
 * In a checkout: `bun packages/studio-host/src/main.ts …`. From npm: the bin `scenity-studio` of
 * `@scenity/studio-host`, or `scenity studio` of `@scenity/cli`.
 *
 * `scenity studio` runs it. When a studio is on the port, it asks that host for a launch link (with the host secret of
 * `host.json`) and opens the browser. Else it starts the host. The first stdout line is
 * `SCENITY_STUDIO_READY {"origin":…,"url":…}`. The url is a launch link (a one-use code) of the Hub or of the project.
 * SIGINT and SIGTERM stop the host, its scene server and its jobs.
 *
 * A project with no window and no request for 30 minutes closes. `SCENITY_STUDIO_IDLE_MS` gives another time (for a
 * test).
 *
 * The agent sessions use the Claude driver (the Agent SDK). With `SCENITY_AGENT_SCRIPT=<file>`, they run the steps of
 * that script (a test with no model). `--no-agent` runs the studio with no agent.
 *
 * `--public-origin <url>` (or `SCENITY_STUDIO_PUBLIC_ORIGIN`) runs the studio in remote mode behind the gateway
 * of the studio (gateway.ts): the launch links have that origin, the host opens no shell, and a file write of an agent
 * asks in each mode.
 */
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { TOKEN_HEADER } from "./access";
import { claudeDriver } from "./agents/claude";
import { scriptDriverOf, type AgentDriver } from "./agents/driver";
import { openProject } from "./api";
import { runDoctor } from "./doctor";
import { checkoutRoot } from "./runtime";
import { publicOriginOf } from "./gateway";
import { editorAppDir, sceneCacheDir, studioSceneServer } from "./sceneServer";
import { startStudio } from "./server";
import { studioStateDir } from "./store";

/** The default port of the studio. */
export const STUDIO_PORT = 5170;

export interface StudioArgs {
  readonly project: string | null;
  readonly port: number;
  readonly state: string;
  readonly open: boolean;
  readonly safe: boolean;
  /** True with `--no-agent`: the studio runs with no agent sessions (every feature works with no agent). */
  readonly noAgent: boolean;
  /** The `--root` folders (absolute): the folders that the dialogs show and that the jobs run in. */
  readonly roots: readonly string[];
  /** The public origin of the remote mode, or null. */
  readonly publicOrigin: string | null;
}

export function parseStudioArgs(
  argv: readonly string[],
  env: Readonly<Record<string, string | undefined>> = process.env,
): StudioArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      project: { type: "string" },
      port: { type: "string" },
      state: { type: "string" },
      "no-open": { type: "boolean", default: false },
      safe: { type: "boolean", default: false },
      "no-agent": { type: "boolean", default: false },
      root: { type: "string", multiple: true },
      "public-origin": { type: "string" },
    },
  });
  const given = values["public-origin"] ?? env.SCENITY_STUDIO_PUBLIC_ORIGIN ?? "";
  const publicOrigin = given === "" ? null : publicOriginOf(given);
  if (given !== "" && publicOrigin === null) throw new Error(`--public-origin ${given} is not an http or https origin`);
  const port = values.port === undefined ? STUDIO_PORT : Number(values.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error(`--port ${String(values.port)} is not a port`);
  return {
    project: values.project === undefined ? null : resolve(values.project),
    port,
    state: values.state ?? studioStateDir(),
    open: !values["no-open"],
    safe: values.safe,
    noAgent: values["no-agent"],
    roots: (values.root ?? []).map((root) => resolve(root)),
    publicOrigin,
  };
}

/** Open a URL in the browser of the system. */
export function openBrowser(url: string): void {
  const command: [string, ...string[]] =
    process.platform === "darwin"
      ? ["open", url]
      : process.platform === "win32"
        ? ["cmd", "/c", "start", "", url]
        : ["xdg-open", url];
  spawn(command[0], command.slice(1), { detached: true, stdio: "ignore" }).unref();
}

/** The launch link of a studio that runs on the port, or null when no studio answers there. */
async function runningStudio(args: StudioArgs): Promise<string | null> {
  const origin = `http://127.0.0.1:${String(args.port)}`;
  const health = (await fetch(`${origin}/health`).then(
    (r) => r.json(),
    () => null,
  )) as { studio?: boolean } | null;
  if (health?.studio !== true) return null;
  const file = join(args.state, "host.json");
  if (!existsSync(file)) throw new Error(`a studio runs on ${origin}, but ${file} is missing`);
  const { secret } = JSON.parse(readFileSync(file, "utf8")) as { secret: string };
  const headers = { [TOKEN_HEADER]: secret, "content-type": "application/json" };
  let next = "/";
  if (args.project !== null) {
    const opened = await fetch(`${origin}/api/projects/open`, {
      method: "POST",
      headers,
      body: JSON.stringify({ dir: args.project }),
    });
    if (!opened.ok) throw new Error(`the studio did not open ${args.project}: ${await opened.text()}`);
    next = ((await opened.json()) as { url: string }).url;
  }
  const code = (await (await fetch(`${origin}/api/launch-code`, { method: "POST", headers })).json()) as {
    url: string;
  };
  return `${code.url}&next=${encodeURIComponent(next)}`;
}

/** The variable of the script of the agent sessions. */
export const AGENT_SCRIPT_ENV = "SCENITY_AGENT_SCRIPT";

/** The idle time of the projects from `SCENITY_STUDIO_IDLE_MS` (a positive number), else none. */
export function idleOf(env: Readonly<Record<string, string | undefined>>): { idleMs?: number } {
  const value = Number(env.SCENITY_STUDIO_IDLE_MS);
  return Number.isFinite(value) && value > 0 ? { idleMs: value } : {};
}

/** The driver of the agent sessions: the script of the variable, else Claude. */
export function agentDriver(env: Readonly<Record<string, string | undefined>> = process.env): AgentDriver {
  const script = env[AGENT_SCRIPT_ENV];
  return script === undefined || script === "" ? claudeDriver() : scriptDriverOf(script);
}

async function main(): Promise<void> {
  const args = parseStudioArgs(process.argv.slice(2));
  const running = await runningStudio(args);
  if (running !== null) {
    console.log(
      `SCENITY_STUDIO_READY ${JSON.stringify({ origin: `http://127.0.0.1:${String(args.port)}`, url: running, reused: true })}`,
    );
    if (args.open) openBrowser(running);
    return;
  }
  const checkout = checkoutRoot();
  const app = editorAppDir(checkout);
  const studio = await startStudio({
    port: args.port,
    stateDir: args.state,
    sceneServer: (file) => studioSceneServer(file, app, { cacheDir: sceneCacheDir(args.state) }),
    editorApp: app,
    // The folders of the dialogs and the jobs: the `--root` folders (default: the home folder), then the checkout.
    roots: [...(args.roots.length > 0 ? args.roots : [homedir()]), ...(checkout === null ? [] : [checkout])],
    safe: args.safe,
    ...idleOf(process.env),
    agents: args.noAgent ? null : agentDriver(),
    publicOrigin: args.publicOrigin,
    log: (line) => console.error(`[studio] ${line}`),
  });
  const next = args.project === null ? "/" : openProject(studio.context, args.project).url;
  const url = studio.launchUrl(next);
  console.log(`SCENITY_STUDIO_READY ${JSON.stringify({ origin: studio.origin, url })}`);
  for (const check of runDoctor(app).filter((c) => c.state !== "ok"))
    console.error(`[studio] doctor: ${check.id}: ${check.detail}`);
  if (args.open) openBrowser(url);
  const stop = (): void => {
    void studio.stop().finally(() => process.exit(0));
  };
  process.on("SIGINT", stop);
  process.on("SIGTERM", stop);
}

if (import.meta.main) {
  main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
}
