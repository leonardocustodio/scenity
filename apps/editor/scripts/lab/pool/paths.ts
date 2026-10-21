// SPDX-License-Identifier: Apache-2.0
/**
 * The files of the render pool and of its built lab. The pool keeps
 * its files under the state folder of the workbench host of the checkout, outside the repository tree:
 *
 *   <state>/pool/pool.json   the running pool: its process, its origin, its checkout (no secret)
 *   <state>/pool/token       the token of the HTTP API of the pool (mode 600)
 *   <state>/pool/lab/b<n>    the builds of the lab
 *
 * The state folder is the one of `packages/workbench-host/src/state.ts` (`defaultStateDir`): the host does not import
 * apps/editor, and apps/editor does not import the host, so this file has its own copy of the rule. The host gives its
 * state folder with `--state`. The variable `SCENITY_LABS_POOL_DIR` names another pool folder.
 */
import { createHash } from "node:crypto";
import { realpathSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { APP } from "../server";

/** The variable with the pool folder of the tools (the host sets it for a state folder that is not the default). */
export const POOL_DIR_ENV = "SCENITY_LABS_POOL_DIR";
/** `0` turns the pool off for the tools: they start their own server and browser. */
export const POOL_USE_ENV = "SCENITY_LABS_POOL";
/** The header of the token of the HTTP API. */
export const POOL_TOKEN_HEADER = "authorization";
/** The path prefix of the HTTP API on the origin of the built lab. */
export const POOL_PREFIX = "/__pool/";

/** The root folder of the checkout of this file (the Git worktree). */
export function checkoutRoot(): string {
  const root = join(APP, "..", "..");
  try {
    return realpathSync(root);
  } catch {
    return root;
  }
}

/** The state folder of the workbench host of a checkout (packages/workbench-host/src/state.ts `defaultStateDir`). */
export function hostStateDir(
  checkout: string,
  platform: NodeJS.Platform = process.platform,
  home: string = homedir(),
  env: Readonly<Record<string, string | undefined>> = process.env,
): string {
  const base =
    platform === "darwin"
      ? join(home, "Library", "Application Support")
      : (env.XDG_STATE_HOME ?? join(home, ".local", "state"));
  const hash = createHash("sha256").update(checkout, "utf8").digest("hex").slice(0, 16);
  return join(base, "org.scenity.editor", "host", hash);
}

/** The pool folder: the variable, else `<state>/pool` of the checkout. */
export function poolDir(env: Readonly<Record<string, string | undefined>> = process.env): string {
  const given = env[POOL_DIR_ENV];
  return given !== undefined && given !== "" ? given : join(hostStateDir(checkoutRoot()), "pool");
}

// The files of a running pool are generic (the scene pool of `scenity pool` writes the same files).
export { alive, clearPool, isPoolInfo, poolRuns, readPool, writePool, type PoolInfo } from "@scenity/cli/poolFiles";
