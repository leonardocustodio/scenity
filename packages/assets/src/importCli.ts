// SPDX-License-Identifier: Apache-2.0
/**
 * The `import` command of the asset CLI. Run from the repo root:
 *
 *   bun packages/assets/src/cli.ts import <projectDir> <file|id> [--force] [--json] [--rights <path>] [--kind <kind>]
 *
 * `<file>` is a source file or its record, relative to the project folder (or absolute); an asset ID also works. A
 * source without a record gets a new record when `--rights` names its rights record (relative to the project folder).
 * The import writes into `<projectDir>/.scenity/imports/<id>/`. An import with the same key does nothing; `--force`
 * imports again. The exit code is 1 when the import fails and 2 for a usage error.
 */
import { existsSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import { AssetDatabase, ProjectReadError } from "./database";
import { toPosix } from "./files";
import type { ImporterRegistry } from "./import/registry";
import { defaultImporterRegistry, importAsset, type ImportOutcome } from "./import/run";
import { writeNewRecord } from "./import/newRecord";
import { ASSET_ID_RE, RECORD_SUFFIX, recordPathFor } from "./record";
import { systemIdSource } from "./system";

export const IMPORT_USAGE =
  "bun packages/assets/src/cli.ts import <projectDir> <file|id> [--force] [--json] [--rights <path>] [--kind <kind>]";

interface ImportArgs {
  readonly dir: string;
  readonly target: string;
  readonly force: boolean;
  readonly json: boolean;
  readonly rights?: string;
  readonly kind?: string;
}

function parseArgs(argv: readonly string[]): ImportArgs | null {
  const plain: string[] = [];
  const values: Record<string, string> = {};
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index] ?? "";
    if (arg === "--rights" || arg === "--kind") {
      const value = argv[++index];
      if (value === undefined) return null;
      values[arg.slice(2)] = value;
    } else if (arg !== "--force" && arg !== "--json") {
      plain.push(arg);
    }
  }
  const [dir, target] = plain;
  if (dir === undefined || target === undefined || plain.length > 2) return null;
  return {
    dir,
    target,
    force: argv.includes("--force"),
    json: argv.includes("--json"),
    ...(values.rights === undefined ? {} : { rights: values.rights }),
    ...(values.kind === undefined ? {} : { kind: values.kind }),
  };
}

/** The record path (relative to the project folder) of the target. Throws when the target has no record. */
async function recordPathOf(args: ImportArgs, registry: ImporterRegistry): Promise<string> {
  const absolute = isAbsolute(args.target) ? args.target : resolve(args.dir, args.target);
  const path = toPosix(relative(args.dir, absolute));
  if (path.endsWith(RECORD_SUFFIX)) return path;
  if (existsSync(resolve(args.dir, recordPathFor(path)))) return recordPathFor(path);
  if (!existsSync(absolute) && ASSET_ID_RE.test(args.target)) {
    const entry = (await AssetDatabase.open(args.dir)).get(args.target);
    if (entry !== undefined) return entry.recordPath;
  }
  if (!existsSync(absolute)) throw new Error(`${args.target}: no such file or asset ID`);
  if (args.rights === undefined) throw new Error(`${path} has no record; give --rights <path> to make one`);
  return writeNewRecord(args.dir, path, {
    registry,
    rights: args.rights,
    ids: systemIdSource,
    ...(args.kind === undefined ? {} : { kind: args.kind }),
  });
}

function formatOutcome(dir: string, outcome: ImportOutcome): string[] {
  const { stamp } = outcome;
  const where = toPosix(relative(dir, outcome.outDir));
  const head = outcome.status === "imported" ? "imported" : "current";
  const out = [`${head}: ${stamp.id} (${stamp.importer}) -> ${where}/${stamp.files.join(", ")}`];
  for (const warning of stamp.warnings) out.push(`warning: ${warning}`);
  return out;
}

/** Run the import command with its arguments (after the word `import`). */
export async function runImportCli(
  argv: readonly string[],
  registry: ImporterRegistry = defaultImporterRegistry(),
): Promise<{ out: string[]; code: number }> {
  const args = parseArgs(argv);
  if (args === null) return { out: [`usage: ${IMPORT_USAGE}`], code: 2 };
  try {
    const recordPath = await recordPathOf(args, registry);
    const outcome = await importAsset(args.dir, recordPath, { force: args.force, registry });
    if (args.json) return { out: [JSON.stringify({ status: outcome.status, ...outcome.stamp }, null, 2)], code: 0 };
    return { out: formatOutcome(args.dir, outcome), code: 0 };
  } catch (error) {
    if (error instanceof ProjectReadError) return { out: [error.message], code: 2 };
    // An ImportError names the record and each bad value; another error has its own text.
    if (error instanceof Error) return { out: [`import: ${error.message}`], code: 1 };
    throw error;
  }
}
