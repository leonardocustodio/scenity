// SPDX-License-Identifier: Apache-2.0
/**
 * The keys of the key map: the text of a key with its modifiers (a chord), the chord of a key event and the label of
 * a chord for the owner. The form of a chord is `KEY_CHORD` of `@scenity/scene`: `Mod` (⌘ on macOS, Ctrl on other
 * systems), `Alt`, `Shift` in this order, then the key. No DOM: a key event is the part of a `KeyboardEvent` that the
 * functions read.
 */
import { KEY_CHORD } from "@scenity/scene/schema/editor";

/** The part of a key event that the key map reads. */
export interface KeyPress {
  readonly key: string;
  readonly code: string;
  readonly metaKey: boolean;
  readonly ctrlKey: boolean;
  readonly altKey: boolean;
  readonly shiftKey: boolean;
}

/** The keys of the codes with a sign. The code gives the same key with and without Shift on each keyboard layout. */
const CODE_KEYS: Readonly<Record<string, string>> = {
  Comma: ",",
  Period: ".",
  Slash: "/",
  Semicolon: ";",
  Quote: "'",
  BracketLeft: "[",
  BracketRight: "]",
  Backslash: "\\",
  Backquote: "`",
  Equal: "=",
  Minus: "-",
  Space: "Space",
};

/** The other names of the modifiers in a typed chord. */
const MODIFIERS: Readonly<Record<string, "Mod" | "Alt" | "Shift">> = {
  mod: "Mod",
  cmd: "Mod",
  command: "Mod",
  meta: "Mod",
  ctrl: "Mod",
  control: "Mod",
  "⌘": "Mod",
  alt: "Alt",
  option: "Alt",
  opt: "Alt",
  "⌥": "Alt",
  shift: "Shift",
  "⇧": "Shift",
};

/** The named keys in the form of a chord, by their lower-case name. */
const NAMED = new Map(
  [
    "Space",
    "Enter",
    "Escape",
    "Tab",
    "Delete",
    "Backspace",
    "Insert",
    "Home",
    "End",
    "PageUp",
    "PageDown",
    "ArrowUp",
    "ArrowDown",
    "ArrowLeft",
    "ArrowRight",
    ...Array.from({ length: 12 }, (_, index) => `F${String(index + 1)}`),
  ].map((name) => [name.toLowerCase(), name]),
);
NAMED.set("esc", "Escape");
NAMED.set("del", "Delete");
NAMED.set("return", "Enter");

/** The chord of a key with its modifiers in the fixed order. */
function chordText(key: string, mod: boolean, alt: boolean, shift: boolean): string {
  return `${mod ? "Mod+" : ""}${alt ? "Alt+" : ""}${shift ? "Shift+" : ""}${key}`;
}

/** The key of a key name in a typed chord ("g", "f2", "esc", ","), or null. */
function keyOfName(name: string): string | null {
  if (name.length === 1) {
    const upper = name.toUpperCase();
    return KEY_CHORD.test(upper) ? upper : null;
  }
  return NAMED.get(name.toLowerCase()) ?? null;
}

/**
 * The chord of a typed text in the fixed form, or null when it is not a chord. The text can use other names of the
 * modifiers (Cmd, Ctrl, Option, ⌘) in any order and any case: `ctrl+shift+z` gives `Mod+Shift+Z`.
 */
export function normalChord(text: string): string | null {
  const trimmed = text.trim();
  // A chord that ends with "+" has the plus key. The key map does not accept that key.
  const parts = trimmed.split("+").map((part) => part.trim());
  const name = parts.pop() ?? "";
  const found = new Set<string>();
  for (const part of parts) {
    const modifier = MODIFIERS[part.toLowerCase()];
    if (modifier === undefined || found.has(modifier)) return null;
    found.add(modifier);
  }
  const key = keyOfName(name);
  if (key === null) return null;
  const chord = chordText(key, found.has("Mod"), found.has("Alt"), found.has("Shift"));
  return KEY_CHORD.test(chord) ? chord : null;
}

/**
 * The key of a key event in the form of a chord, or null (a modifier alone, or a key that the map does not accept).
 * The code comes first, because it gives the same key with and without Shift and on each keyboard layout.
 */
function eventKey(event: KeyPress): string | null {
  const sign = CODE_KEYS[event.code];
  if (sign !== undefined) return sign;
  if (/^Key[A-Z]$/.test(event.code)) return event.code.slice(3);
  if (/^Digit[0-9]$/.test(event.code)) return event.code.slice(5);
  const named = NAMED.get(event.code.toLowerCase());
  if (named !== undefined) return named;
  // An event with no known code (a synthetic event) gives its key.
  return keyOfName(event.key);
}

/** The chord of a key event, or null. Meta and Ctrl both give `Mod`. */
export function chordOfEvent(event: KeyPress): string | null {
  const key = eventKey(event);
  if (key === null) return null;
  return chordText(key, event.metaKey || event.ctrlKey, event.altKey, event.shiftKey);
}

/** The signs of the modifiers on macOS. */
const MAC_SIGNS: Readonly<Record<string, string>> = { Mod: "⌘", Alt: "⌥", Shift: "⇧" };

/** The label of a chord for the owner: `⇧⌘Z` on macOS, `Ctrl+Shift+Z` on other systems. */
export function chordLabel(chord: string, mac: boolean): string {
  const parts = chord.split("+");
  const key = parts.pop() ?? "";
  if (mac) {
    const order = ["Alt", "Shift", "Mod"].filter((modifier) => parts.includes(modifier));
    return `${order.map((modifier) => MAC_SIGNS[modifier] ?? "").join("")}${key}`;
  }
  return [...parts.map((modifier) => (modifier === "Mod" ? "Ctrl" : modifier)), key].join("+");
}
