#!/usr/bin/env bun
// SPDX-License-Identifier: Apache-2.0
/**
 * The `scenity` command. The bin of `@scenity/cli` runs this file with Bun; in the checkout
 * `bun packages/cli/src/cli.ts <command>` is the same:
 *
 *   scenity <command> [arguments]
 *   scenity <command> --help
 *
 * The commands are in commands.ts: create, dev, build, check, shot, sheet, clip, bench, verify, pool and assets. Each
 * command loads its module on demand, so a light command never loads the runtime. A name that is not a command of the
 * CLI goes to the CLI faces of the project plugins (plugins/commands.ts). The lab CLI of the checkout is
 * `bun run labs`. The editor plugin of the lab project also gives it as `scenity labs`.
 */
import { wantsHelp } from "./args";
import { COMMANDS, usageLines } from "./commands";
import { projectCommands, projectFlag } from "./plugins/commands";

const NAMES = new Set(COMMANDS.map((entry) => entry.name));

/** The arguments without `--project <dir>` (a plugin command gets its project in the context). */
function withoutProject(argv: readonly string[]): string[] {
  const value = projectFlag(argv);
  if (value === undefined) return [...argv];
  const index = argv.indexOf("--project");
  return [...argv.slice(0, index), ...argv.slice(index + 2)];
}

/** Run a plugin command, or print the usage. The result is the exit code. */
async function runPluginCommand(command: string | undefined, rest: readonly string[]): Promise<number> {
  const help = command === undefined || command === "--help" || command === "-h" || command === "help";
  const found = await projectCommands(rest, NAMES);
  for (const problem of found.problems) console.error(`scenity: ${problem}`);
  const plugin = help ? undefined : found.commands.find((entry) => entry.name === command);
  if (plugin === undefined || found.project === null) {
    const lines = usageLines(found.commands);
    for (const line of lines) (help ? console.log : console.error)(line);
    if (!help) console.error(`scenity: no command "${command}"`);
    return help ? 0 : 2;
  }
  if (wantsHelp(rest)) {
    for (const line of plugin.help ?? [`scenity ${plugin.name}: ${plugin.summary}`]) console.log(line);
    return 0;
  }
  return plugin.run(withoutProject(rest), { project: found.project });
}

/** Run the command of the arguments; the result is the exit code. */
export async function main(argv: readonly string[]): Promise<number> {
  const [command, ...rest] = argv;
  const entry = COMMANDS.find((item) => item.name === command);
  if (entry === undefined) return runPluginCommand(command, rest);
  const module = await entry.load();
  if (wantsHelp(rest)) {
    for (const line of module.help) console.log(line);
    return 0;
  }
  const result = await module.run(rest);
  for (const line of result.out) console.log(line);
  return result.code;
}

if (import.meta.main) process.exit(await main(process.argv.slice(2)));
