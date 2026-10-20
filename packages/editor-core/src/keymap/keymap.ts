// SPDX-License-Identifier: Apache-2.0
/**
 * The key map of an editor: the keys of each command of the registry. The default keys come from the command
 * definitions (`keys` of a command). The key map document of the user (`scenity.keymap/1`) replaces the keys of the
 * commands that it names. A key acts in a context of the page, for example `scene` for the viewport and the panels,
 * and `sequencer` for the sequencer panel. The context `global` acts in each context. Two commands on one key in
 * contexts that overlap are a conflict. No DOM, no Vue.
 */
import { KEYMAP_FORMAT, type KeymapDocument } from "@scenity/scene/schema/editor";
import { normalChord } from "./chords";

/** The context of a key that acts in each context of the page. */
export const GLOBAL_CONTEXT = "global";

/** A command as the key map reads it: its ID, its default keys and the context of its keys. */
export interface KeyCommand {
  readonly id: string;
  /** The default keys (chords, see `KEY_CHORD` of `@scenity/scene`). */
  readonly keys?: readonly string[] | undefined;
  /** The context of the keys (default: `global`). */
  readonly keyContext?: string | undefined;
}

/** One key of a command. */
export interface KeyBinding {
  readonly command: string;
  readonly chord: string;
  readonly context: string;
  /** "default": from the command definition; "user": from the key map document of the user. */
  readonly source: "default" | "user";
}

/** Two or more commands on one key in contexts that overlap. */
export interface KeyConflict {
  readonly chord: string;
  readonly commands: readonly string[];
  readonly contexts: readonly string[];
}

/** A key map: the keys of the commands with the changes of the user. */
export interface KeyMap {
  readonly bindings: readonly KeyBinding[];
  /** The current keys of a command (an empty list: no key). */
  keysOf(id: string): readonly string[];
  /** The default keys of a command (from its definition). */
  defaultsOf(id: string): readonly string[];
  /** The commands of a chord in the contexts, the first context first (for example `["sequencer", "global"]`). */
  commandsFor(chord: string, contexts: readonly string[]): readonly string[];
  /** The conflicts of the key map: two commands on one key in contexts that overlap. */
  conflicts(): readonly KeyConflict[];
  /** The command IDs of the user document that no command of the registry has (the map keeps them). */
  readonly unknown: readonly string[];
}

/** True when keys of the two contexts can act on the same key press (the same context, or one is `global`). */
export function contextsOverlap(a: string, b: string): boolean {
  return a === b || a === GLOBAL_CONTEXT || b === GLOBAL_CONTEXT;
}

/** The chords of a list in the fixed form, with no repeat. A text that is not a chord is left out. */
function chords(list: readonly string[]): string[] {
  const out: string[] = [];
  for (const item of list) {
    const chord = normalChord(item);
    if (chord !== null && !out.includes(chord)) out.push(chord);
  }
  return out;
}

/** The conflicts of a list of bindings. */
function conflictsOf(bindings: readonly KeyBinding[]): KeyConflict[] {
  const byChord = new Map<string, KeyBinding[]>();
  for (const binding of bindings) byChord.set(binding.chord, [...(byChord.get(binding.chord) ?? []), binding]);
  const out: KeyConflict[] = [];
  for (const [chord, list] of byChord) {
    const commands = new Set<string>();
    const contexts = new Set<string>();
    for (const a of list) {
      for (const b of list) {
        if (a.command === b.command || !contextsOverlap(a.context, b.context)) continue;
        commands.add(a.command).add(b.command);
        contexts.add(a.context).add(b.context);
      }
    }
    if (commands.size > 0) out.push({ chord, commands: [...commands].sort(), contexts: [...contexts].sort() });
  }
  return out.sort((a, b) => a.chord.localeCompare(b.chord));
}

/** Make the key map of the commands with the key map document of the user (null: the defaults only). */
export function createKeyMap(commands: readonly KeyCommand[], user: KeymapDocument | null = null): KeyMap {
  const known = new Map(commands.map((command) => [command.id, command]));
  const bindings: KeyBinding[] = [];
  for (const command of commands) {
    const changed = user?.keys[command.id];
    const context = command.keyContext ?? GLOBAL_CONTEXT;
    const source = changed === undefined ? "default" : "user";
    for (const chord of chords(changed ?? command.keys ?? []))
      bindings.push({ command: command.id, chord, context, source });
  }
  const unknown = Object.keys(user?.keys ?? {})
    .filter((id) => !known.has(id))
    .sort();
  return {
    bindings,
    keysOf: (id) => bindings.filter((binding) => binding.command === id).map((binding) => binding.chord),
    defaultsOf: (id) => chords(known.get(id)?.keys ?? []),
    commandsFor: (chord, contexts) => {
      const out: string[] = [];
      for (const context of contexts) {
        for (const binding of bindings) {
          if (binding.chord === chord && binding.context === context && !out.includes(binding.command)) {
            out.push(binding.command);
          }
        }
      }
      return out;
    },
    conflicts: () => conflictsOf(bindings),
    unknown,
  };
}

/** An empty key map document of a user. */
export function emptyKeymap(): KeymapDocument {
  return { format: KEYMAP_FORMAT, keys: {} };
}

/**
 * The key map document of the user with new keys for a command. Keys equal to the defaults remove the entry. Thus the
 * document keeps only the changes. `null` keys also remove the entry (the defaults apply again).
 */
export function withKeys(
  doc: KeymapDocument | null,
  id: string,
  keys: readonly string[] | null,
  defaults: readonly string[] = [],
): KeymapDocument {
  const rest = Object.fromEntries(Object.entries(doc?.keys ?? {}).filter(([key]) => key !== id));
  const next = keys === null ? null : chords(keys);
  const same = next !== null && next.length === defaults.length && next.every((chord, at) => chord === defaults[at]);
  return { format: KEYMAP_FORMAT, keys: next === null || same ? rest : { ...rest, [id]: next } };
}

/**
 * The commands that a new key of a command would share in contexts that overlap (the conflicts that the change makes).
 */
export function keyClashes(map: KeyMap, commands: readonly KeyCommand[], id: string, chord: string): string[] {
  const context = commands.find((command) => command.id === id)?.keyContext ?? GLOBAL_CONTEXT;
  return map.bindings
    .filter((binding) => binding.chord === chord && binding.command !== id)
    .filter((binding) => contextsOverlap(binding.context, context))
    .map((binding) => binding.command);
}
