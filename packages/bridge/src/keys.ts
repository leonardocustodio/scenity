// SPDX-License-Identifier: Apache-2.0
/**
 * The keys of the workbench chords (⌘ or Ctrl with the key), by `KeyboardEvent.code`. A frame with the focus
 * keeps the keys, so the frame sends these chords to the workbench page with the event `key` (events.ts).
 */
export const WORKBENCH_KEY_CODES = {
  Backslash: "\\",
  // ⌘1 to ⌘9 put the surface tabs in front, in the order of the tabs.
  Digit1: "1",
  Digit2: "2",
  Digit3: "3",
  Digit4: "4",
  Digit5: "5",
  Digit6: "6",
  Digit7: "7",
  Digit8: "8",
  Digit9: "9",
  KeyK: "k",
} as const;
export type WorkbenchKey = (typeof WORKBENCH_KEY_CODES)[keyof typeof WORKBENCH_KEY_CODES];
const WORKBENCH_KEYS: readonly unknown[] = Object.values(WORKBENCH_KEY_CODES);

/** True for a key of a workbench chord. */
export function isWorkbenchKey(value: unknown): value is WorkbenchKey {
  return WORKBENCH_KEYS.includes(value);
}

/** The workbench key of a `KeyboardEvent.code`, or null. */
export function workbenchKeyOf(code: string): WorkbenchKey | null {
  return Object.hasOwn(WORKBENCH_KEY_CODES, code)
    ? WORKBENCH_KEY_CODES[code as keyof typeof WORKBENCH_KEY_CODES]
    : null;
}
