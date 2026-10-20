// SPDX-License-Identifier: Apache-2.0
/**
 * The command registry: the one list of the commands of an editor. The editor and its plugins register their commands
 * (made with `defineCommand`) in the order of the palette. The palette, the keys, the script API and the tools of
 * Claude read this one registry. Thus Claude can do what the owner can do.
 */
import { argsJsonSchema } from "./argsSchema";
import {
  CommandError,
  commandMeta,
  defineCommand,
  parseArgs,
  ruleText,
  rulePasses,
  type Args,
  type Command,
  type CommandListing,
  type CommandOutcome,
  type SelectionItem,
} from "./command";

/** The part of the state that the registry reads: the selection. */
export interface RuleState {
  readonly selection: SelectionItem | null;
}

export interface CommandRegistry<S extends RuleState, H, O> {
  /** Add commands at the end of the list. A second command with the same ID is an error. */
  register(commands: readonly Command<S, H, O>[]): void;
  /** Remove all commands (a new plugin registers its commands again). */
  clear(): void;
  /** Remove the commands of these IDs (a panel that closes removes its key commands). */
  unregister(ids: readonly string[]): void;
  /** The commands in the order of the palette. */
  list(): readonly Command<S, H, O>[];
  /** The command of an ID, or undefined. */
  named(id: string): Command<S, H, O> | undefined;
  /** Why a command cannot run in a state with these arguments (the selection rule, then the condition), or null. */
  block(command: Command<S, H, O>, state: S, args?: Args): string | null;
  /** The commands as the palette and the tools list them, with what can run in the current state. */
  listings(state: S): CommandListing[];
  /**
   * Prepare a command: find it, check its arguments and its selection rule, and build its result. A problem throws a
   * CommandError with the words for the owner and Claude.
   */
  prepare(id: string, raw: unknown, state: S): CommandOutcome<O, H>;
}

/** Make a command registry. */
export function createCommandRegistry<S extends RuleState, H, O>(): CommandRegistry<S, H, O> {
  let commands: Command<S, H, O>[] = [];
  const named = (id: string): Command<S, H, O> | undefined => commands.find((command) => command.id === id);
  const block = (command: Command<S, H, O>, state: S, args: Args = {}): string | null => {
    if (!rulePasses(command.selection, state.selection, args)) {
      return `${command.id} needs ${ruleText(command.selection)}.`;
    }
    return command.when?.(state) ?? null;
  };
  return {
    register(list) {
      for (const command of list) {
        defineCommand(command);
        if (named(command.id) !== undefined) throw new Error(`The command "${command.id}" is registered already.`);
        commands = [...commands, command];
      }
    },
    clear() {
      commands = [];
    },
    unregister(ids) {
      commands = commands.filter((command) => !ids.includes(command.id));
    },
    list: () => commands,
    named,
    block,
    listings: (state) =>
      commands.map((command) => {
        const reason = block(command, state);
        return {
          id: command.id,
          title: command.title,
          key: command.key,
          kind: command.kind,
          ...commandMeta(command),
          keys: command.keys ?? [],
          args: command.args,
          schema: argsJsonSchema(command.args),
          selection: ruleText(command.selection),
          owner: command.owner === true,
          available: reason === null,
          reason,
        };
      }),
    prepare(id, raw, state) {
      const command = named(id);
      if (command === undefined) {
        throw new CommandError(`No command "${id}". Commands: ${commands.map((item) => item.id).join(", ")}.`);
      }
      const { args, problems } = parseArgs(command.args, raw);
      if (problems.length > 0) throw new CommandError(`${id}: ${problems.join(" ")}`);
      const reason = block(command, state, args);
      if (reason !== null) throw new CommandError(reason);
      return command.build(args, state);
    },
  };
}
