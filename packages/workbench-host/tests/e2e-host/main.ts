// SPDX-License-Identifier: Apache-2.0
/**
 * The host in test mode: the real host of `src/host.ts` with five test parts.
 *
 * - The chat sessions use the scripted SDK (scriptedSdk.ts) and a fake API key: no Claude Code process, no model call.
 * - The terminals run a plain shell in place of the `claude` CLI, without the workbench flags.
 * - `--lab-url` sets the saved URL state of the lab surface before the start (the take, the time, the quality).
 * - The auth provider is `none`: the launch token is the one token, with the role admin.
 * - `--checkout` can name a project folder with no Git (a copy of the showroom sample), or a workspace folder below
 *   the Git top folder (the web workspace of a repository).
 *
 *   bun packages/workbench-host/tests/e2e-host/main.ts --checkout <abs path> --state <dir>
 *       [--shell <program>] [--lab-url <query>] [--port <n>]
 *
 * The first stdout line is the READY line of the real host. SIGTERM and SIGINT stop the host and its children (the dev
 * servers of the checkout).
 */
import { parseArgs } from "node:util";
import { realpathSync } from "node:fs";
import { startHost, type Host } from "../../src/host";
import { formatReadyLine, type HostEndpoint } from "../../src/protocol";
import { HostState } from "../../src/state";
import { makeToken } from "../../src/token";
import { scriptedSdk } from "./scriptedSdk";

/** The fake API key of the chat sessions: the scripted SDK never sends it anywhere. */
const FAKE_KEY = "sk-e2e-scripted-not-a-key";

function readArgs(): { checkout: string; state: string; shell: string; labUrl: string | null; port: number } {
  const { values } = parseArgs({
    options: {
      checkout: { type: "string" },
      state: { type: "string" },
      shell: { type: "string" },
      "lab-url": { type: "string" },
      port: { type: "string" },
    },
  });
  if (values.checkout === undefined || values.state === undefined) {
    throw new Error("Usage: main.ts --checkout <abs path> --state <dir> [--shell <program>] [--lab-url <query>]");
  }
  return {
    checkout: values.checkout,
    state: values.state,
    shell: values.shell ?? "/bin/sh",
    labUrl: values["lab-url"] ?? null,
    port: Number(values.port ?? "0"),
  };
}

function stopOnSignals(host: Host): void {
  let stopping = false;
  const stop = (): void => {
    if (stopping) return;
    stopping = true;
    setTimeout(() => process.exit(1), 10_000).unref();
    host.stop().then(
      () => process.exit(0),
      () => process.exit(1),
    );
  };
  process.on("SIGTERM", stop);
  process.on("SIGINT", stop);
  process.on("exit", () => host.killNow());
}

async function main(): Promise<void> {
  const args = readArgs();
  // A project folder with no Git (a copy of a sample) is its own checkout. The checkout is the folder of the argument
  // (the Git top folder, or a workspace folder below it). The host opens it at the start.
  const repo = realpathSync(args.checkout);
  // The saved URL state of the lab: the surface URL takes the origin of the dev server and keeps this query.
  if (args.labUrl !== null) new HostState(args.state).setSurfaceUrl(repo, "lab", `http://127.0.0.1/${args.labUrl}`);
  const token = makeToken();
  let endpoint: HostEndpoint = { origin: "", token };
  const host = await startHost({
    checkout: repo,
    port: args.port,
    stateDir: args.state,
    token,
    // The import jobs skip their picture (the e2e suite holds the GPU lock), so a job ends.
    importPicture: false,
    chat: { sdk: scriptedSdk(() => endpoint), env: { ...process.env, ANTHROPIC_API_KEY: FAKE_KEY } },
    terminal: {
      // The host gives a Claude terminal the CLI arguments `--session-id <id>`. The shell must not read them, so
      // `sh -c 'exec "$0"'` starts the shell with no arguments.
      program: (kind) => (kind === "claude" ? [args.shell, "-c", 'exec "$0"', args.shell] : [args.shell]),
      claudeLaunch: () => Promise.resolve(null),
    },
  });
  endpoint = host.endpoint;
  process.stdout.write(`${formatReadyLine(host.endpoint)}\n`);
  stopOnSignals(host);
  process.stderr.write(`workbench test host: ${host.endpoint.origin}, checkout ${repo}, state ${args.state}\n`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(2);
});
