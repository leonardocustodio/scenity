// SPDX-License-Identifier: Apache-2.0
/**
 * The keyboard picture of the Shortcuts window. The module has only pure functions and no DOM.
 *
 * - `KEYBOARD`: the rows of the keys, each key with the key of a chord (`KEY_CHORD` of `@scenity/scene`) and a width.
 *   A key that the key map does not take (Caps Lock, a modifier) is a gap.
 * - `keyBindings`: the commands on each key for the modifiers that the person chose, in one context or in all.
 * - `readKeymapFile`, `keymapFile`: the import and the export of the key map of the person (`scenity.keymap/1`).
 */
import { readEditorDocument, type KeymapDocument } from "@scenity/scene/schema/editor";

/** One key of the picture. `key` is empty for a gap. */
export interface KeyCap {
  readonly key: string;
  readonly width: number;
}

/** The modifiers of a chord. */
export interface Modifiers {
  readonly mod: boolean;
  readonly alt: boolean;
  readonly shift: boolean;
}

/** A command as the window shows it. */
export interface ShortcutCommand {
  readonly id: string;
  readonly title: string;
  readonly context: string;
  readonly keys: readonly string[];
}

// The texts of the rows hold ASCII signs only.
const keys = (text: string): KeyCap[] => Array.from(text, (key) => ({ key, width: 1 }));
const gap = (width: number): KeyCap => ({ key: "", width });

export const KEYBOARD: readonly (readonly KeyCap[])[] = [
  [
    { key: "Escape", width: 1.5 },
    ...Array.from({ length: 12 }, (_, index) => ({ key: `F${String(index + 1)}`, width: 1 })),
  ],
  [...keys("`1234567890-="), { key: "Backspace", width: 2 }],
  [{ key: "Tab", width: 1.5 }, ...keys("QWERTYUIOP[]"), { key: "\\", width: 1.5 }],
  [gap(1.75), ...keys("ASDFGHJKL;'"), { key: "Enter", width: 2.25 }],
  [gap(2.25), ...keys("ZXCVBNM,./"), gap(2.75)],
  [
    gap(4),
    { key: "Space", width: 6 },
    gap(1),
    ...["ArrowLeft", "ArrowUp", "ArrowDown", "ArrowRight"].map((key) => ({ key, width: 1 })),
  ],
  [...["Insert", "Home", "PageUp", "Delete", "End", "PageDown"].map((key) => ({ key, width: 1.5 }))],
];

/** The short label of a key on the picture. */
export function capLabel(key: string): string {
  const signs: Readonly<Record<string, string>> = {
    Escape: "Esc",
    Backspace: "⌫",
    Enter: "⏎",
    ArrowLeft: "←",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowRight: "→",
    Delete: "Del",
    Insert: "Ins",
    PageUp: "PgUp",
    PageDown: "PgDn",
  };
  return signs[key] ?? key;
}

/** The chord of a key with modifiers, in the fixed order of the key map. */
export function chordOf(key: string, modifiers: Modifiers): string {
  return `${modifiers.mod ? "Mod+" : ""}${modifiers.alt ? "Alt+" : ""}${modifiers.shift ? "Shift+" : ""}${key}`;
}

/** The key and the modifiers of a chord. */
export function partsOf(chord: string): { key: string; modifiers: Modifiers } {
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  return { key, modifiers: { mod: parts.includes("Mod"), alt: parts.includes("Alt"), shift: parts.includes("Shift") } };
}

/** The commands on each key for `modifiers`, in `context` (null: each context). */
export function keyBindings(
  commands: readonly ShortcutCommand[],
  modifiers: Modifiers,
  context: string | null,
): Map<string, ShortcutCommand[]> {
  const out = new Map<string, ShortcutCommand[]>();
  for (const command of commands) {
    if (context !== null && command.context !== context) continue;
    for (const chord of command.keys) {
      const parts = partsOf(chord);
      if (chordOf(parts.key, parts.modifiers) !== chordOf(parts.key, modifiers)) continue;
      out.set(parts.key, [...(out.get(parts.key) ?? []), command]);
    }
  }
  return out;
}

/** The contexts of the commands, sorted. */
export function contextsOf(commands: readonly ShortcutCommand[]): string[] {
  return [...new Set(commands.map((command) => command.context))].sort();
}

/** The text of the key map file of the person for an export. */
export function keymapFile(keymap: KeymapDocument | null): string {
  const doc: KeymapDocument = keymap ?? { format: "scenity.keymap/1", keys: {} };
  const sorted = Object.fromEntries(Object.entries(doc.keys).sort(([a], [b]) => a.localeCompare(b)));
  return `${JSON.stringify({ format: doc.format, keys: sorted }, null, 2)}\n`;
}

/** The result of the read of an imported key map file. */
export type KeymapImport =
  | { readonly ok: true; readonly doc: KeymapDocument; readonly unknown: readonly string[] }
  | { readonly ok: false; readonly errors: readonly string[] };

/** Read an imported key map file. `known` holds the command IDs of the page (an unknown ID stays, as a note). */
export function readKeymapFile(text: string, known: ReadonlySet<string>): KeymapImport {
  const read = readEditorDocument(text, "keymap");
  if (!read.ok) return { ok: false, errors: read.errors.map((error) => `${error.path || "/"}: ${error.message}`) };
  return { ok: true, doc: read.doc, unknown: Object.keys(read.doc.keys).filter((id) => !known.has(id)) };
}
