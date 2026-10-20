// SPDX-License-Identifier: Apache-2.0
/**
 * The argument reader of these commands of `scenity`: `create`, `dev`, `sheet`, `clip`, `verify`, `pool` and
 * `assets`. The commands `check`, `build`, `bench` and `shot` have their own readers with the same rules.
 *
 * The rules: a flag in `values` takes the next word (a word that starts with `--` is not a value); a flag in `flags`
 * takes no value; another word that starts with `--` is a usage error; each other word is a plain word.
 */

/** The output lines and the exit code of a command. */
export interface CommandResult {
  readonly out: string[];
  readonly code: number;
}

/** The words of a command line after the command name. */
export interface ReadArgs {
  readonly values: Readonly<Record<string, string>>;
  readonly flags: ReadonlySet<string>;
  readonly plain: readonly string[];
}

/** Read the arguments, or null for a usage error. */
export function readArgs(
  argv: readonly string[],
  values: readonly string[],
  flags: readonly string[] = [],
): ReadArgs | null {
  const found: Record<string, string> = {};
  const set = new Set<string>();
  const plain: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] ?? "";
    if (flags.includes(arg)) set.add(arg);
    else if (values.includes(arg)) {
      const value = argv[index + 1];
      if (value === undefined || value.startsWith("--")) return null;
      found[arg.slice(2)] = value;
      index += 1;
    } else if (arg.startsWith("--")) return null;
    else plain.push(arg);
  }
  return { values: found, flags: set, plain };
}

/** A number of at least `min`, or null for a text that is not one; `fallback` for no text. */
export function numberOf(text: string | undefined, fallback: number, min = 0): number | null {
  if (text === undefined) return fallback;
  const value = Number(text);
  return Number.isFinite(value) && value >= min ? value : null;
}

/** The width and height of a size text (for example 1280x800), or null. */
export function sizeOf(text: string): { width: number; height: number } | null {
  const match = /^(\d{2,5})x(\d{2,5})$/.exec(text);
  return match === null ? null : { width: Number(match[1]), height: Number(match[2]) };
}

/** True when the arguments ask for the help text of a command. */
export function wantsHelp(argv: readonly string[]): boolean {
  return argv.includes("--help") || argv.includes("-h");
}
