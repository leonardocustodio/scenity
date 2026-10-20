// SPDX-License-Identifier: Apache-2.0
/**
 * The command kit: the shape of a command, the check of its arguments, the selection rules and the small helpers of the
 * build functions. Every editor action is a named command with a title, a key, an argument schema, a selection rule and
 * a build function. The keys, the buttons, the palette, the script API and the tools of Claude run the same commands.
 *
 * The kit is generic: the state that a command reads, the host of a view command and the op type of an edit are type
 * parameters. An editor and its plugins add their own parts to the base types. No Vue import.
 */
import type { EditOp } from "./ops";

/** The schema of one argument of a command. */
export type ArgSpec =
  | {
      readonly type: "number";
      readonly description: string;
      readonly optional?: boolean;
      readonly default?: number;
      readonly min?: number;
      readonly max?: number;
      readonly integer?: boolean;
    }
  | {
      readonly type: "string";
      readonly description: string;
      readonly optional?: boolean;
      readonly default?: string;
      /** The values that the argument can have (an enum). */
      readonly values?: readonly string[];
    }
  | { readonly type: "boolean"; readonly description: string; readonly optional?: boolean; readonly default?: boolean };

/** The arguments of a command after the check of its schema (the defaults are in). */
export type Args = Readonly<Record<string, number | string | boolean>>;

/** One selected item: its kind (an entity, or a kind of a plugin) and its ID. */
export interface SelectionItem {
  readonly kind: string;
  readonly id: string;
}

/**
 * The selection that a command needs: none (an empty list), a selection of one of the kinds, or any selection. With
 * `orArg`, the argument of that name can name the target in place of the selection (Claude names an item).
 */
export interface SelectionRule<K extends string = string> {
  readonly kinds: readonly K[] | "any";
  readonly orArg?: string;
}

/** The base of what the commands read: the selection, the tune values, the history and the proposals. */
export interface CommandState<T extends SelectionItem = SelectionItem> {
  readonly selection: T | null;
  /** Every selected item, the item of `selection` first; absent: `selection` alone. */
  readonly selected?: readonly T[];
  /** The current tune values (path to value) and their defaults. */
  readonly tunes: Readonly<Record<string, number>>;
  readonly defaults: ReadonlyMap<string, number>;
  readonly canUndo: boolean;
  readonly canRedo: boolean;
  /** The number of proposals that wait. */
  readonly proposals: number;
}

/** The base of the functions of the page that the view commands use. The runner gives the proposal functions. */
export interface CommandHost<T extends SelectionItem = SelectionItem> {
  select(target: T | null): void;
  /** Selects a list of items (the first is the primary item). Absent: the host selects only the first item. */
  selectAll?(targets: readonly T[]): void;
  undo(): void;
  redo(): void;
  accept(id: string): unknown;
  reject(id: string): boolean;
  acceptAll(): unknown;
  rejectAll(): number;
}

/** The result of a command: edit ops, or a function that runs on the page. */
export type CommandOutcome<O = EditOp, H = CommandHost> =
  | { readonly kind: "edit"; readonly title: string; readonly ops: readonly O[] }
  | { readonly kind: "view"; readonly title: string; run(host: H): unknown };

export type CommandKind = "edit" | "view";

/** The history step that a run of a command makes: a step of the scene, a step of the sequence, or none. */
export type UndoKind = "scene" | "sequence" | "none";

/**
 * A command. `S` is the state that it reads, `H` the host of a view command and `O` the op type of an edit. The
 * functions are methods, so a command of a plugin with more state parts can go into the registry of the editor.
 */
export interface Command<S = CommandState, H = CommandHost, O = EditOp> {
  readonly id: string;
  readonly title: string;
  /** The key of the command as the palette shows it, or null. */
  readonly key: string | null;
  /**
   * The default keys of the command for the key map (chords such as `Mod+D`, see keymap/chords.ts). A user key map
   * replaces them. Absent: the command has no default key.
   */
  readonly keys?: readonly string[];
  /** The context of the keys (for example `scene` or `sequencer`; default `global`). */
  readonly keyContext?: string;
  readonly kind: CommandKind;
  /** What the command does, in words for an agent (default: the title). */
  readonly description?: string;
  /** The name of the icon of the command (a lucide name in kebab case). */
  readonly icon?: string;
  /** The group of the command in the search box (default: the first word of the ID). */
  readonly category?: string;
  /** The menu of the command in the menu bar: a menu ID, then a submenu ID (`edit`, `window/theme`). */
  readonly menu?: string;
  /** The history step that a run makes (default: "scene" for an edit, "none" for a view command). */
  readonly undo?: UndoKind;
  readonly args: Readonly<Record<string, ArgSpec>>;
  readonly selection: SelectionRule;
  /** True: only the owner runs it (the palette, a key). A script and Claude cannot (for example `proposal.*`). */
  readonly owner?: boolean;
  /**
   * True when the edit is a proposal also for the owner (the owner accepts it on the card). The mode "apply" of the
   * owner still applies it. Claude and a script follow their rule.
   */
  readonly proposes?: boolean;
  /** Null when the command can run in this state, else the reason (the palette hides the command). */
  when?(state: S): string | null;
  build(args: Args, state: S): CommandOutcome<O, H>;
}

/** A command as the palette, the script API and the tools list it. */
export interface CommandListing {
  readonly id: string;
  readonly title: string;
  readonly key: string | null;
  readonly kind: CommandKind;
  /** The metadata of the command (`Command`), with the defaults in. */
  readonly description: string;
  readonly category: string;
  readonly icon: string | null;
  readonly menu: string | null;
  readonly undo: UndoKind;
  /** The default keys of the command (chords such as `Mod+D`). */
  readonly keys: readonly string[];
  readonly args: Readonly<Record<string, ArgSpec>>;
  /** The JSON schema of the arguments (argsSchema.ts), for the tools of the agents. */
  readonly schema: Readonly<Record<string, unknown>>;
  /** The selection rule in words, for example "a prop selection (or the prop argument)". */
  readonly selection: string;
  readonly owner: boolean;
  /** True when the selection rule and the condition pass in the current state. */
  readonly available: boolean;
  /** Why the command cannot run in the current state, or null. */
  readonly reason: string | null;
}

/** The metadata of a command with its defaults (the listings, the search box and the menus read it). */
export function commandMeta(
  command: Pick<
    Command<never, never, never>,
    "id" | "title" | "kind" | "description" | "icon" | "category" | "menu" | "undo"
  >,
): Pick<CommandListing, "description" | "category" | "icon" | "menu" | "undo"> {
  return {
    description: command.description ?? command.title,
    category: command.category ?? command.id.split(".")[0] ?? command.id,
    icon: command.icon ?? null,
    menu: command.menu ?? null,
    undo: command.undo ?? (command.kind === "edit" ? "scene" : "none"),
  };
}

/** An error of a command: an unknown ID, a bad argument, a missing selection, or a state in which it cannot run. */
export class CommandError extends Error {
  override readonly name = "CommandError";
}

/** The form of a command ID: dot-separated words, for example `prop.move` or `layout.variant.save`. */
export const COMMAND_ID = /^[a-z][A-Za-z0-9]*(\.[a-z][A-Za-z0-9]*)*$/;

/**
 * Define a command. The function checks the ID and gives the command with its types. A registry (registry.ts) takes
 * the commands of the editor and of its plugins.
 */
export function defineCommand<S = CommandState, H = CommandHost, O = EditOp>(
  command: Command<S, H, O>,
): Command<S, H, O> {
  // The function does not read the argument schema. The reason is that a description can be a getter that reads a
  // plugin later.
  if (!COMMAND_ID.test(command.id)) throw new Error(`The command ID "${command.id}" is not dot-separated words.`);
  return command;
}

/** Define a list of commands with the same types (a command module of an editor or a plugin). */
export function defineCommands<S = CommandState, H = CommandHost, O = EditOp>(
  commands: readonly Command<S, H, O>[],
): readonly Command<S, H, O>[] {
  return commands.map((command) => defineCommand(command));
}

// ---------------------------------------------------------------------------------------------
// The check of the arguments.

function argProblem(name: string, spec: ArgSpec, value: unknown): string | null {
  switch (spec.type) {
    case "number": {
      if (typeof value !== "number" || !Number.isFinite(value)) return `"${name}" is a finite number.`;
      if (spec.integer === true && !Number.isInteger(value)) return `"${name}" is a whole number.`;
      if (spec.min !== undefined && value < spec.min) return `"${name}" is at least ${String(spec.min)}.`;
      if (spec.max !== undefined && value > spec.max) return `"${name}" is at most ${String(spec.max)}.`;
      return null;
    }
    case "string":
      if (typeof value !== "string" || value.trim() === "") return `"${name}" is a text.`;
      if (spec.values !== undefined && !spec.values.includes(value)) {
        return `"${name}" is one of ${spec.values.join(", ")}.`;
      }
      return null;
    case "boolean":
      return typeof value === "boolean" ? null : `"${name}" is true or false.`;
  }
}

/** Check the arguments against the schema: the arguments with their defaults, or the problems. */
export function parseArgs(
  specs: Readonly<Record<string, ArgSpec>>,
  raw: unknown,
): { readonly args: Args; readonly problems: readonly string[] } {
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    return { args: {}, problems: ["The arguments are an object of names and values."] };
  }
  const given = (raw ?? {}) as Readonly<Record<string, unknown>>;
  const names = Object.keys(specs);
  const problems: string[] = [];
  for (const name of Object.keys(given)) {
    if (!Object.hasOwn(specs, name) && given[name] !== undefined) {
      problems.push(`No argument "${name}" (${names.length === 0 ? "none" : names.join(", ")}).`);
    }
  }
  const args: Record<string, number | string | boolean> = {};
  for (const [name, spec] of Object.entries(specs)) {
    const value = given[name] ?? spec.default;
    if (value === undefined) {
      if (spec.optional !== true) problems.push(`The argument "${name}" is missing: ${spec.description}`);
      continue;
    }
    const problem = argProblem(name, spec, value);
    if (problem === null) args[name] = value as number | string | boolean;
    else problems.push(problem);
  }
  return { args, problems };
}

// ---------------------------------------------------------------------------------------------
// The selection rules.

/** The selection rule in words. */
export function ruleText(rule: SelectionRule): string {
  if (rule.kinds !== "any" && rule.kinds.length === 0) return "no selection";
  const kinds = rule.kinds === "any" ? "any" : `a ${rule.kinds.join(" or ")}`;
  return `${kinds} selection${rule.orArg === undefined ? "" : ` (or the ${rule.orArg} argument)`}`;
}

/** True when the selection (or the argument that names the target) passes the rule. */
export function rulePasses(rule: SelectionRule, selection: SelectionItem | null, args: Args = {}): boolean {
  if (rule.kinds !== "any" && rule.kinds.length === 0) return true;
  if (rule.orArg !== undefined && args[rule.orArg] !== undefined) return true;
  if (selection === null) return false;
  return rule.kinds === "any" || rule.kinds.includes(selection.kind);
}

// ---------------------------------------------------------------------------------------------
// The helpers of the build functions.

/** The selection rule of a command that needs no selection. */
export const NO_RULE: SelectionRule = { kinds: [] };

/** The grid of a place that a command writes (0.1 mm). */
const PLACE_GRID = 1e-4;

/** A value on a grid step, rounded to 4 decimals (as the numbers that the source writers write). */
export function snapTo(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1e4) / 1e4;
}

/** A place value on the grid of the commands. */
export function grid(value: number): number {
  return snapTo(value, PLACE_GRID);
}

/** The words of a number of a title: at most 4 decimals. */
export function num(value: number): string {
  return String(Number(value.toFixed(4)));
}

/** A number argument (the schema check makes its type sure). */
export function numberArg(args: Args, name: string): number | undefined {
  const value = args[name];
  return typeof value === "number" ? value : undefined;
}

/** A text argument, or an empty text. */
export function textArg(args: Args, name: string): string {
  const value = args[name];
  return typeof value === "string" ? value : "";
}
