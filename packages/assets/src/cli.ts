// SPDX-License-Identifier: Apache-2.0
/**
 * The CLI of the asset database. Run from the repo root:
 *
 *   bun packages/assets/src/cli.ts index <projectDir> [--json]     the index and the problems
 *   bun packages/assets/src/cli.ts used-by <projectDir> <id> [--json]
 *   bun packages/assets/src/cli.ts missing <projectDir> [--json]   the broken references
 *   bun packages/assets/src/cli.ts new-id                          a new asset ID (a ULID)
 *   bun packages/assets/src/cli.ts import <projectDir> <file|id>   run the importer of an asset (importCli.ts)
 *   bun packages/assets/src/cli.ts build <projectDir> [--check]    build the assets of a project (buildCli.ts)
 *   bun packages/assets/src/cli.ts stills <projectDir> [--check]   the state of the asset stills (stillsCli.ts)
 *   bun packages/assets/src/cli.ts release-check <projectDir>      the release gate of a project (releaseCli.ts)
 *   bun packages/assets/src/cli.ts export <projectDir> <scene>     the glTF export of a scene (exportCli.ts)
 *
 * `index` exits with 1 on a broken reference or a duplicate ID. `missing` exits with 1 on a broken reference. A usage
 * error or a project that does not read exits with 2.
 */
import { BUILD_USAGE, runBuildCli } from "./buildCli";
import { AssetDatabase, ProjectReadError } from "./database";
import { EXPORT_USAGE, runExportCli } from "./exportCli";
import { newAssetId } from "./ids";
import type { ImporterRegistry } from "./import/registry";
import { IMPORT_USAGE, runImportCli } from "./importCli";
import { RELEASE_USAGE, runReleaseCli } from "./releaseCli";
import { STILLS_USAGE, runStillsCli } from "./stillsCli";
import { systemIdSource } from "./system";
import type { AssetProblem, AssetUse } from "./types";

const USAGE = `usage:
  bun packages/assets/src/cli.ts index <projectDir> [--json]
  bun packages/assets/src/cli.ts used-by <projectDir> <id> [--json]
  bun packages/assets/src/cli.ts missing <projectDir> [--json]
  bun packages/assets/src/cli.ts new-id
  ${IMPORT_USAGE}
  ${BUILD_USAGE}
  ${STILLS_USAGE}
  ${RELEASE_USAGE}
  ${EXPORT_USAGE}`;

/** The output lines and the exit code of a CLI run. */
export interface CliResult {
  readonly out: string[];
  readonly code: number;
}

/** The options of a CLI run. */
export interface CliOptions {
  /** The importers (default: the built-in importers). `scenity assets` adds the importers of the plugins. */
  readonly registry?: ImporterRegistry;
}

/** Run the CLI with its arguments (no `bun` and no script path). */
export async function runCli(argv: readonly string[], options: CliOptions = {}): Promise<CliResult> {
  if (argv[0] === "import") return runImportCli(argv.slice(1), options.registry);
  if (argv[0] === "build") return runBuildCli(argv.slice(1), options.registry);
  if (argv[0] === "stills") return runStillsCli(argv.slice(1));
  if (argv[0] === "release-check") return runReleaseCli(argv.slice(1));
  if (argv[0] === "export") return runExportCli(argv.slice(1));
  const json = argv.includes("--json");
  const [command, dir, id] = argv.filter((arg) => arg !== "--json");
  if (command === "new-id") return { out: [newAssetId(systemIdSource)], code: 0 };
  if (dir === undefined || !["index", "used-by", "missing"].includes(command ?? "")) return { out: [USAGE], code: 2 };
  let db: AssetDatabase;
  try {
    db = await AssetDatabase.open(dir);
  } catch (error) {
    if (error instanceof ProjectReadError) return { out: [error.message], code: 2 };
    throw error;
  }
  if (command === "index") return indexCommand(db, json);
  if (command === "missing") return missingCommand(db, json);
  if (id === undefined) return { out: [USAGE], code: 2 };
  const uses = db.usedBy(id);
  if (json) return { out: [JSON.stringify({ id, uses, dependents: db.dependents(id) }, null, 2)], code: 0 };
  const out = uses.map(formatUse);
  for (const dependent of db.dependents(id)) out.push(`asset:${dependent} (dependencies)`);
  if (out.length === 0) out.push(`no document uses asset:${id}`);
  return { out, code: 0 };
}

function indexCommand(db: AssetDatabase, json: boolean): CliResult {
  const problems = db.problems();
  const code = problems.some((problem) => problem.code === "broken-reference" || problem.code === "duplicate-id")
    ? 1
    : 0;
  if (json) {
    const entries = db.entries().map((entry) => ({ ...entry, record: undefined }));
    return { out: [JSON.stringify({ project: db.project.id, entries, problems }, null, 2)], code };
  }
  const out = db.entries().map((entry) => {
    const hash = entry.hash === null ? "missing" : entry.hash.slice(0, 12);
    return `${entry.id}  ${entry.kind.padEnd(13)} ${hash}  ${entry.sourcePath}`;
  });
  out.push(`${String(db.entries().length)} assets, ${String(problems.length)} problems`);
  out.push(...problems.map(formatProblem));
  return { out, code };
}

function missingCommand(db: AssetDatabase, json: boolean): CliResult {
  const broken = db.missing();
  if (json) return { out: [JSON.stringify(broken, null, 2)], code: broken.length > 0 ? 1 : 0 };
  const out = broken.map((use) => `asset:${use.id}  ${formatUse(use)}`);
  out.push(broken.length === 0 ? "no broken references" : `${String(broken.length)} broken references`);
  return { out, code: broken.length > 0 ? 1 : 0 };
}

function formatUse(use: AssetUse): string {
  const entity = use.entity === undefined ? "" : `  entity ${use.entity}`;
  return `${use.document}#${use.pointer}${entity}`;
}

function formatProblem(problem: AssetProblem): string {
  return `${problem.code}: ${problem.file}: ${problem.message}`;
}

if (import.meta.main) {
  const result = await runCli(process.argv.slice(2));
  for (const line of result.out) console.log(line);
  process.exit(result.code);
}
