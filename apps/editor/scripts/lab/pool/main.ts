// SPDX-License-Identifier: Apache-2.0
/**
 * The render pool process. It starts with the workbench host when the host runs. Else `bun run labs pool` starts it
 * on demand:
 *
 *   bun apps/editor/scripts/lab/pool/main.ts [--pages N] [--port P] [--state <dir>]
 *
 * It builds the lab, serves the build on 127.0.0.1 behind the page key gate of the lab page, keeps N warm lab
 * pages in one Chromium (`--pages 0`: the built lab only, no browser), and answers the HTTP API of api.ts. It writes
 * `<state>/pool/pool.json` and the token file, so the tools find it. A second pool of the same folder does not start.
 * The first stdout line is `LABS_POOL_READY {"origin":…}` (no secret). SIGTERM and SIGINT stop it.
 *
 * Environment: `SCENITY_LABS_PAGE_SECRET` (the secret of the lab page; the host gives one, else a new one),
 * `SCENITY_LABS_POOL_TOKEN` (the token of the API; the host gives one, else a new one),
 * `SCENITY_LABS_POOL_WORKER_TOKEN` (the token of the WebKit worker paths). The host gives the worker token to the pool
 * and to the indexer window of the app. Without it no WebKit page can join.
 */
import { randomBytes } from "node:crypto";
import { join } from "node:path";
import { parseArgs } from "node:util";
import { LAB_KEY_ENV, newLabKey } from "@scenity/labs-platform/labKey";
import { gpuLock } from "../gpuLock";
import { rememberLabKey } from "../server";
import { poolApi } from "./api";
import { BuiltLab } from "./builtLab";
import { defaultSpec, PagePool } from "./pages";
import { alive, checkoutRoot, clearPool, poolDir, readPool, writePool } from "./paths";
import { projectDefaultTake } from "./projectTake";
import { startBuiltLabServer } from "./staticServer";
import { sharedLock, WebKitPages } from "./webkit";
import { POOL_WORKER_TOKEN_ENV } from "./webkitApi";

/** The variable with the token of the API that the host gives. */
export const POOL_TOKEN_ENV = "SCENITY_LABS_POOL_TOKEN";
/** The time without a call before the pool ends a lease of a tool that stopped (ms). */
const LEASE_IDLE_MS = 120_000;
/** The quiet time after a new build before the warm page loads it (ms). */
const REWARM_QUIET_MS = 5_000;
/** The quiet time after a change of a source before a build (ms). */
const BUILD_QUIET_MS = 1_000;

export interface PoolArgs {
  readonly pages: number;
  readonly port: number;
  /** The pool folder (`<state>/pool`). */
  readonly dir: string;
}

export function poolArgs(argv: readonly string[]): PoolArgs {
  const { values } = parseArgs({
    args: [...argv],
    options: {
      pages: { type: "string", default: "2" },
      port: { type: "string", default: "0" },
      state: { type: "string" },
    },
  });
  const pages = Number(values.pages);
  const port = Number(values.port);
  if (!Number.isInteger(pages) || pages < 0 || pages > 8) throw new Error("--pages must be 0 to 8.");
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("--port must be 0 to 65535.");
  return { pages, port, dir: values.state === undefined ? poolDir() : join(values.state, "pool") };
}

const log = (line: string): void => {
  process.stderr.write(`labs pool: ${line}\n`);
};

/** Start the pool. The promise resolves with the stop function when the server listens. */
export async function startPool(args: PoolArgs): Promise<{ origin: string; stop: () => Promise<void> }> {
  const running = readPool(args.dir);
  if (running !== null && running.info.pid !== process.pid && alive(running.info.pid)) {
    throw new Error(`A pool runs already (process ${String(running.info.pid)}, ${running.info.origin}).`);
  }
  // An empty variable counts as none.
  const given = (name: string): string | null => {
    const value = process.env[name];
    return value === undefined || value === "" ? null : value;
  };
  const key = given(LAB_KEY_ENV) ?? newLabKey();
  const token = given(POOL_TOKEN_ENV) ?? randomBytes(32).toString("hex");
  const built = new BuiltLab({ cacheDir: join(args.dir, "lab"), debounceMs: BUILD_QUIET_MS, log });
  let origin = "";
  // One GPU lock for the leases of the Chromium pages and of the WebKit pages of the app.
  const lock = sharedLock(() => gpuLock({ log }));
  const webkit = new WebKitPages({ build: () => built.ensure(), lock, log });
  const defaultTake = await projectDefaultTake(checkoutRoot(), log);
  const pages = new PagePool({
    get origin() {
      return origin;
    },
    pages: Math.max(1, args.pages),
    build: () => built.ensure(),
    lock,
    log,
  });
  const server = await startBuiltLabServer({
    root: () => built.current?.dir ?? null,
    key,
    port: args.port,
    api: poolApi({ token, pages, built, webkit, workerToken: given(POOL_WORKER_TOKEN_ENV), defaultTake }),
  });
  origin = server.origin;
  rememberLabKey(origin, key);
  const first = await built.ensure();
  log(`the built lab ${String(first.id)} (${String(first.ms)} ms) at ${origin}`);
  built.watch();
  writePool(
    args.dir,
    {
      version: 1,
      pid: process.pid,
      origin,
      checkout: checkoutRoot(),
      pages: args.pages,
      started: new Date().toISOString(),
    },
    token,
  );
  const expiry = setInterval(() => {
    void Promise.all([pages.expire(LEASE_IDLE_MS), webkit.expire(LEASE_IDLE_MS)]).then((ended) => {
      if (ended.flat().length > 0) log(`ended ${String(ended.flat().length)} idle leases`);
    });
  }, 10_000);
  if (args.pages > 0) {
    // The defaults of `labs shot` are warm before the first call. After a new build the page of the last spec loads.
    void pages.warm(defaultSpec(defaultTake)).catch((error: unknown) => log(`warm page failed: ${String(error)}`));
    // A burst of edits gives a burst of builds: the page loads again only after a quiet time.
    let rewarm: ReturnType<typeof setTimeout> | null = null;
    built.onBuild(() => {
      if (rewarm !== null) clearTimeout(rewarm);
      rewarm = setTimeout(() => {
        rewarm = null;
        const spec = pages.lastSpec();
        if (spec !== null) void pages.warm(spec).catch(() => null);
      }, REWARM_QUIET_MS);
    });
  }
  return {
    origin,
    stop: async () => {
      clearInterval(expiry);
      built.stop();
      clearPool(args.dir);
      await webkit.stop();
      await pages.stop();
      await server.stop();
    },
  };
}

if (import.meta.main) {
  try {
    const pool = await startPool(poolArgs(process.argv.slice(2)));
    process.stdout.write(`LABS_POOL_READY ${JSON.stringify({ origin: pool.origin })}\n`);
    let stopping = false;
    const stop = (): void => {
      if (stopping) return;
      stopping = true;
      setTimeout(() => process.exit(1), 10_000).unref();
      void pool.stop().finally(() => process.exit(0));
    };
    process.on("SIGTERM", stop);
    process.on("SIGINT", stop);
  } catch (error) {
    log(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}
