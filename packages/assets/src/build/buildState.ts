// SPDX-License-Identifier: Apache-2.0
/**
 * The build state of each asset. After a build, `.scenity/cache/build-state.json` keeps the hash of the inputs of each
 * asset (its record, its source hash and the build settings of the project) and the errors of its build. The states of
 * an asset are:
 *
 * - `built`: the build output has the asset, and its inputs did not change after the build;
 * - `stale`: the inputs changed after the build (the asset build panel and the tiles show a mark);
 * - `unbuilt`: the build output does not have the asset;
 * - `failed`: the last build gave errors for the asset.
 *
 * The file is not a part of the build output, so `assets build --check` does not compare it. A build output from
 * before the file has no inputs to compare: each asset of it is `built`.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { canonicalJson } from "@scenity/scene";
import type { AssetDatabase } from "../database";
import type { AssetEntry } from "../types";
import type { Finding } from "./checks";

export const BUILD_STATE_FILE = ".scenity/cache/build-state.json";
export const BUILD_STATE_FORMAT = "scenity.build-state/1";

/** The state of the build of one asset. */
export type AssetBuildState = "built" | "stale" | "unbuilt" | "failed";

interface StateFile {
  readonly format: typeof BUILD_STATE_FORMAT;
  /** The day of the build (YYYY-MM-DD). */
  readonly built: string;
  readonly assets: Readonly<Record<string, { readonly inputs: string; readonly errors: readonly string[] }>>;
}

/** The hash of the inputs of the build of an asset: its record text, its source hash and the project build settings. */
export function assetBuildInputs(db: AssetDatabase, entry: AssetEntry): string {
  const record = join(db.dir, entry.recordPath);
  const hash = createHash("sha256");
  hash.update(existsSync(record) ? readFileSync(record) : "");
  hash.update(`\n${entry.hash ?? "missing"}\n`);
  hash.update(canonicalJson(db.project.build ?? {}));
  return hash.digest("hex");
}

/**
 * Write the build state of each asset of the database after a build with these findings. A build with errors writes
 * no output: then only the assets with errors get a new state, and the others keep the state of the last build.
 */
export function writeBuildState(db: AssetDatabase, findings: readonly Finding[], today = new Date()): void {
  const old = readState(db.dir);
  const failed = findings.some((finding) => finding.level === "error");
  const assets: Record<string, { inputs: string; errors: readonly string[] }> = {};
  for (const entry of db.entries()) {
    const errors = findings
      .filter((finding) => finding.level === "error" && finding.asset === entry.id)
      .map((finding) => finding.message);
    const kept = old?.assets[entry.id];
    if (failed && errors.length === 0) {
      if (kept !== undefined) assets[entry.id] = kept;
    } else assets[entry.id] = { inputs: assetBuildInputs(db, entry), errors };
  }
  const file: StateFile = { format: BUILD_STATE_FORMAT, built: today.toISOString().slice(0, 10), assets };
  const path = join(db.dir, BUILD_STATE_FILE);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, canonicalJson(file));
}

/** The build state file of a project, or null (no file, or a file that does not read). */
function readState(dir: string): StateFile | null {
  const path = join(dir, BUILD_STATE_FILE);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8")) as Partial<StateFile>;
    return value.format === BUILD_STATE_FORMAT && typeof value.assets === "object" ? (value as StateFile) : null;
  } catch {
    return null;
  }
}

/** The build state of one asset, with the reason of a state other than `built`. */
export interface AssetBuildStatus {
  readonly id: string;
  readonly state: AssetBuildState;
  readonly reason: string | null;
}

/** The build state of each asset of the database. `built` holds the asset IDs of the build manifest. */
export function assetBuildStates(db: AssetDatabase, built: ReadonlySet<string>): AssetBuildStatus[] {
  const file = readState(db.dir);
  return db.entries().map((entry): AssetBuildStatus => {
    const stamp = file?.assets[entry.id];
    if (stamp !== undefined && stamp.errors.length > 0) {
      return { id: entry.id, state: "failed", reason: stamp.errors.join("; ") };
    }
    if (!built.has(entry.id)) return { id: entry.id, state: "unbuilt", reason: "the build output does not have it" };
    if (stamp !== undefined && stamp.inputs !== assetBuildInputs(db, entry)) {
      return {
        id: entry.id,
        state: "stale",
        reason: `the record or the source changed after the build of ${file?.built ?? ""}`,
      };
    }
    return { id: entry.id, state: "built", reason: null };
  });
}
