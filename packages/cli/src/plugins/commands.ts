// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of the project plugins: `scenity <command>` for a name that is not a command of the CLI. A plugin gives
 * commands in its CLI face: the `scenity.cli` field of its package.json names a module whose default export is a
 * `CliFace`. The project is the project of the work folder (or `--project`), with the rule of the other commands
 * (workspace.ts). A command of the CLI always wins over a plugin command of the same name, and the first plugin of the
 * project document wins over a later one.
 *
 * The face runs in the process of the CLI. A plugin that needs other packages (a lab, a browser) starts its own
 * process from its face, so the CLI does not depend on the plugin code.
 */
import { pathToFileURL } from "node:url";
import { resolvePluginEntries } from "../vite/resolve";
import { commandProjectDir } from "../workspace";

/** The context of a plugin command. */
export interface CliContext {
  /** The project folder (absolute). */
  readonly project: string;
}

/** One command of a plugin. */
export interface CliCommand {
  readonly name: string;
  /** One line for `scenity --help`. */
  readonly summary: string;
  /** The help lines of `scenity <name> --help`. Default: the summary. */
  readonly help?: readonly string[];
  /** Run the command with the arguments after its name; the result is the exit code. */
  run(argv: readonly string[], context: CliContext): Promise<number> | number;
}

/** The CLI face of a plugin: the default export of the module of `scenity.cli`. */
export interface CliFace {
  readonly commands: readonly CliCommand[];
}

/** A plugin command with the entry of its plugin. */
export interface PluginCommand extends CliCommand {
  readonly plugin: string;
}

function isFace(value: unknown): value is CliFace {
  const commands = (value as { commands?: unknown } | null)?.commands;
  return (
    Array.isArray(commands) &&
    commands.every((item: unknown) => {
      const command = item as Partial<CliCommand> | null;
      return typeof command?.name === "string" && typeof command.run === "function";
    })
  );
}

/** The value of `--project` in the arguments, if any. */
export function projectFlag(argv: readonly string[]): string | undefined {
  const index = argv.indexOf("--project");
  const value = index === -1 ? undefined : argv[index + 1];
  return value === undefined || value.startsWith("--") ? undefined : value;
}

/**
 * The plugin commands of a project folder, in the order of the project document. `reserved` are the names of the CLI
 * commands. A plugin whose face does not load is a problem in `problems`, not an exception.
 */
export async function pluginCommands(
  project: string,
  entries: readonly string[],
  reserved: ReadonlySet<string>,
  problems: string[] = [],
): Promise<PluginCommand[]> {
  const found: PluginCommand[] = [];
  const names = new Set(reserved);
  for (const plugin of resolvePluginEntries(entries, project)) {
    if (plugin.cli === undefined) continue;
    let face: unknown;
    try {
      face = ((await import(pathToFileURL(plugin.cli).href)) as { default?: unknown }).default;
    } catch (error) {
      problems.push(
        `${plugin.entry}: the CLI face does not load: ${error instanceof Error ? error.message : String(error)}`,
      );
      continue;
    }
    if (!isFace(face)) {
      problems.push(`${plugin.entry}: the CLI face has no default export { commands: [{ name, summary, run }] }`);
      continue;
    }
    for (const command of face.commands) {
      if (names.has(command.name)) continue;
      names.add(command.name);
      found.push({ ...command, plugin: plugin.entry });
    }
  }
  return found;
}

/** The plugin commands of the project of a command line, or an empty list when there is no project. */
export async function projectCommands(
  argv: readonly string[],
  reserved: ReadonlySet<string>,
  cwd: string = process.cwd(),
): Promise<{ project: string | null; commands: PluginCommand[]; problems: string[] }> {
  let project: string;
  try {
    project = commandProjectDir(projectFlag(argv), cwd);
  } catch {
    return { project: null, commands: [], problems: [] };
  }
  const { readBuildProject } = await import("../build/run");
  const problems: string[] = [];
  try {
    const entries = readBuildProject(project).plugins ?? [];
    return { project, commands: await pluginCommands(project, entries, reserved, problems), problems };
  } catch (error) {
    problems.push(error instanceof Error ? error.message : String(error));
    return { project, commands: [], problems };
  }
}
