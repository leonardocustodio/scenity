// SPDX-License-Identifier: Apache-2.0
/**
 * The command `scenity assets`: the asset CLI of `@scenity/assets` (packages/assets/src/cli.ts) with the project of the
 * work folder:
 *
 *   scenity assets <subcommand> [projectDir] [arguments]
 *
 * The subcommands: `import <file|id>`, `build [--check]`, `stills [--check]`, `release-check`,
 * `export <scene> [--out <file.glb>]`, `index`, `missing`, `used-by <id>` and `new-id`. The project folder is optional:
 * with one plain word less than the subcommand needs, the command puts the project of the work folder (or `--project`)
 * first. The exit codes are those of the asset CLI.
 */
import type { CommandResult } from "../args";
import { projectHostImporters } from "../plugins/importers";
import { commandProjectDir, CommandSetupError } from "../workspace";

export const ASSETS_USAGE = "scenity assets <subcommand> [projectDir] [arguments] [--project <dir>]";

/** The plain words of each subcommand, with the project folder first. */
export const ASSET_WORDS: Readonly<Record<string, number>> = {
  import: 2,
  build: 1,
  stills: 1,
  "release-check": 1,
  export: 2,
  index: 1,
  missing: 1,
  "used-by": 2,
  "new-id": 0,
};

/** The flags of the asset CLI that take a value. */
const VALUE_FLAGS = new Set(["--out", "--rights", "--kind", "--project"]);

export const ASSETS_HELP = [
  `usage: ${ASSETS_USAGE}`,
  "The asset tools of the project of the work folder (or --project, or a projectDir word):",
  "  import <file|id> [--force] [--rights <path>] [--kind <kind>]   run the importer of an asset",
  "  build [--check] [--no-cache] [--no-import]                      the asset build of the project",
  "  stills [--check]                                                the state of the asset stills",
  "  release-check                                                   the release gate: rights and approvals",
  "  export <scene> [--out <file.glb>] [--no-import]                 one GLB of a scene",
  "  index | missing | used-by <id> | new-id                         the asset database",
  "Each subcommand takes --json.",
];

/** The arguments of the asset CLI: the subcommand, the project folder and the rest, or null for a usage error. */
export function assetArgs(argv: readonly string[], projectDir: () => string): string[] | null {
  const [sub, ...rest] = argv;
  const words = sub === undefined ? undefined : ASSET_WORDS[sub];
  if (sub === undefined || words === undefined) return null;
  const plain: string[] = [];
  const other: string[] = [];
  let project: string | undefined;
  for (let index = 0; index < rest.length; index += 1) {
    const arg = rest[index] ?? "";
    if (VALUE_FLAGS.has(arg)) {
      const value = rest[index + 1];
      if (value === undefined) return null;
      if (arg === "--project") project = value;
      else other.push(arg, value);
      index += 1;
    } else if (arg.startsWith("--")) other.push(arg);
    else plain.push(arg);
  }
  if (words === 0) return plain.length === 0 && project === undefined ? [sub, ...other] : null;
  if (project !== undefined && plain.length !== words - 1) return null;
  if (plain.length === words) return [sub, ...plain, ...other];
  if (plain.length !== words - 1) return null;
  return [sub, project ?? projectDir(), ...plain, ...other];
}

/** Run `scenity assets` with the arguments after the word `assets`. */
export async function runAssetsCommand(argv: readonly string[]): Promise<CommandResult> {
  let args: string[] | null;
  try {
    args = assetArgs(argv, () => commandProjectDir(undefined));
  } catch (error) {
    if (error instanceof CommandSetupError) return { out: [error.message], code: 2 };
    throw error;
  }
  if (args === null) return { out: [`usage: ${ASSETS_USAGE}`, ...ASSETS_HELP.slice(1)], code: 2 };
  const { runCli } = await import("@scenity/assets/cli");
  // An import and a build use the importers of the plugins of the project too.
  const dir = args[1];
  if ((args[0] !== "import" && args[0] !== "build") || dir === undefined) return runCli(args);
  const { importerRegistryWith } = await import("@scenity/assets/import");
  const warn = (text: string): void => console.error(`scenity assets: ${text}`);
  const registry = importerRegistryWith(await projectHostImporters(dir, warn), warn);
  return runCli(args, { registry });
}
