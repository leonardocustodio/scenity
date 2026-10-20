// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity pool`: the scene pool, warm player pages in one headless Chromium for `scenity shot`, `sheet`
 * and `clip` (server.ts). The tools use the pool when it runs (page/tabs.ts), so a command starts no browser and loads
 * no page that is warm.
 *
 *   scenity pool [start] [--pages <n>] [--lock <file>]   run the pool in this process until SIGINT, SIGTERM or a stop
 *   scenity pool status [--json]                         the pages and the leases of the running pool
 *   scenity pool stop                                    stop the running pool
 *
 * The pool folder is `SCENITY_SCENE_POOL_DIR`, else `scenity-scene-pool` in the temp folder of the user. The first
 * stdout line of a start is `SCENITY_POOL_READY {"origin":…,"pages":…,"dir":…}`. `scenity bench` keeps its own
 * browser: its numbers (the first frame, the asset bytes, the memory) need a new page. The lab of the checkout keeps
 * its own pool (`bun run labs pool`).
 */
import { numberOf, readArgs, type CommandResult } from "../args";
import { findScenePool, scenePoolDir } from "./client";

export const POOL_USAGE = "scenity pool [start|status|stop] [--pages <n>] [--lock <file>] [--json]";
/** The marker of the ready line on stdout. */
export const POOL_READY = "SCENITY_POOL_READY";

export const POOL_HELP = [
  `usage: ${POOL_USAGE}`,
  "The scene pool: warm player pages in one headless Chromium for scenity shot, sheet and clip, which use it when",
  "it runs (--local or SCENITY_SCENE_POOL=0: their own browser). start (default) runs the pool in this process until",
  "Ctrl+C or `scenity pool stop`; status shows the pages and the leases. --pages: the warm pages (default 2). The",
  "pool takes the GPU lock of the labs tools while a lease runs. scenity bench keeps its own browser.",
];

export interface PoolArgs {
  readonly action: "start" | "status" | "stop";
  readonly pages: number;
  readonly lock?: string;
  readonly json: boolean;
}

/** The options of the arguments after the word `pool`, or null for a usage error. */
export function parsePoolArgs(argv: readonly string[]): PoolArgs | null {
  const args = readArgs(argv, ["--pages", "--lock"], ["--json"]);
  if (args === null || args.plain.length > 1) return null;
  const action = args.plain[0] ?? "start";
  const pages = numberOf(args.values.pages, 2, 1);
  if (pages === null || !Number.isInteger(pages) || pages > 8) return null;
  if (action !== "start" && action !== "status" && action !== "stop") return null;
  return {
    action,
    pages,
    ...(args.values.lock === undefined ? {} : { lock: args.values.lock }),
    json: args.flags.has("--json"),
  };
}

/** Run the pool until it stops. */
async function startPool(args: PoolArgs): Promise<CommandResult> {
  const { startScenePool } = await import("./server");
  let pool;
  try {
    pool = await startScenePool({
      pages: args.pages,
      ...(args.lock === undefined ? {} : { lock: args.lock }),
      log: (text) => console.error(`scenity pool: ${text}`),
    });
  } catch (error) {
    return { out: [`scenity pool: ${error instanceof Error ? error.message : String(error)}`], code: 1 };
  }
  console.log(`${POOL_READY} ${JSON.stringify({ origin: pool.origin, pages: args.pages, dir: pool.dir })}`);
  console.log(`scenity pool: ${String(args.pages)} warm pages at ${pool.origin} (Ctrl+C or scenity pool stop)`);
  const signal = () => void pool.stop();
  process.once("SIGINT", signal);
  process.once("SIGTERM", signal);
  await pool.stopped;
  process.off("SIGINT", signal);
  process.off("SIGTERM", signal);
  return { out: ["scenity pool: stopped"], code: 0 };
}

/** Run `scenity pool` with the arguments after the word `pool`. */
export async function runPoolCommand(argv: readonly string[]): Promise<CommandResult> {
  const args = parsePoolArgs(argv);
  if (args === null) return { out: [`usage: ${POOL_USAGE}`], code: 2 };
  if (args.action === "start") return startPool(args);
  const pool = await findScenePool();
  if (pool === null) return { out: [`scenity pool: no scene pool runs (${scenePoolDir()})`], code: 1 };
  if (args.action === "stop") {
    await pool.json("POST", "stop", {});
    return { out: [`scenity pool: the pool at ${pool.origin} stops`], code: 0 };
  }
  const status = await pool.json<{ pages: { busy: boolean; warm: boolean }[]; leases: number; waiting: number }>(
    "GET",
    "status",
  );
  if (args.json) return { out: [JSON.stringify({ origin: pool.origin, ...status }, null, 2)], code: 0 };
  const warm = status.pages.filter((page) => page.warm).length;
  const line = `${String(status.pages.length)} pages (${String(warm)} warm), ${String(status.leases)} leases, ${String(status.waiting)} waiting`;
  return { out: [`scenity pool: ${pool.origin}: ${line}`], code: 0 };
}
