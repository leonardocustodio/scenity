// SPDX-License-Identifier: Apache-2.0
/**
 * The files of a running render pool: in the pool folder, `pool.json` names the process, the origin and the checkout
 * of the pool (no secret), and `token` holds the token of its HTTP API (mode 600). The scene pool of `scenity pool`
 * and the lab pool use them (apps/editor/scripts/lab/pool/paths.ts imports `@scenity/cli/poolFiles`). A tool reads the
 * files to find a pool, and a stop removes them.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** What `pool.json` says about a running pool. */
export interface PoolInfo {
  readonly version: 1;
  readonly pid: number;
  /** The origin of the HTTP API of the pool (`/__pool/`; the lab pool also serves the built lab there). */
  readonly origin: string;
  readonly checkout: string;
  readonly pages: number;
  readonly started: string;
}

export function isPoolInfo(value: unknown): value is PoolInfo {
  if (typeof value !== "object" || value === null) return false;
  const info = value as Record<string, unknown>;
  return (
    info.version === 1 &&
    typeof info.pid === "number" &&
    typeof info.origin === "string" &&
    /^http:\/\/127\.0\.0\.1:\d+$/.test(info.origin) &&
    typeof info.checkout === "string"
  );
}

/** Read `pool.json` and the token, or null. */
export function readPool(dir: string): { readonly info: PoolInfo; readonly token: string } | null {
  try {
    const info: unknown = JSON.parse(readFileSync(join(dir, "pool.json"), "utf8"));
    const token = readFileSync(join(dir, "token"), "utf8").trim();
    return isPoolInfo(info) && /^[0-9a-f]{64}$/.test(token) ? { info, token } : null;
  } catch {
    return null;
  }
}

/** Write `pool.json` and the token (mode 600). */
export function writePool(dir: string, info: PoolInfo, token: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  writeFileSync(join(dir, "token"), `${token}\n`, { mode: 0o600 });
  writeFileSync(join(dir, "pool.json"), `${JSON.stringify(info, null, 2)}\n`, { mode: 0o600 });
}

/** Remove `pool.json` when it names this process (the stop of the pool). */
export function clearPool(dir: string, pid = process.pid): void {
  const pool = readPool(dir);
  if (pool?.info.pid !== pid) return;
  rmSync(join(dir, "pool.json"), { force: true });
  rmSync(join(dir, "token"), { force: true });
}

/** True while a process runs. */
export function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** True when the pool folder has a pool of a live process. */
export function poolRuns(dir: string): boolean {
  const pool = readPool(dir);
  return pool !== null && alive(pool.info.pid) && existsSync(join(dir, "pool.json"));
}
