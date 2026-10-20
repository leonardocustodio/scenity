// SPDX-License-Identifier: Apache-2.0
/**
 * The key sheet of the editor window: each current key of the key map, by its context, with the held keys and the
 * modal keys. The `?` key opens it (`help.keys`).
 */
import { markRaw, shallowReactive } from "vue";

/** One row of the sheet. */
export interface KeyRow {
  readonly id: string;
  readonly label: string;
  readonly context: string;
  /** The keys as text ("⌘S"). */
  readonly keys: readonly string[];
  readonly keyKind: "press" | "held" | "modal";
}

/** The order of the contexts in the sheet. A different context comes after them. */
export const KEY_CONTEXTS = ["global", "scene", "hierarchy", "dock", "sequencer", "fly", "drag"] as const;

/** The rows by context in the order of the sheet, with only the rows that match a filter text. */
export function keyGroups(rows: readonly KeyRow[], filter = ""): { context: string; rows: KeyRow[] }[] {
  const text = filter.trim().toLowerCase();
  const kept = rows.filter(
    (row) =>
      row.keys.length > 0 &&
      (text === "" || `${row.label} ${row.id} ${row.keys.join(" ")}`.toLowerCase().includes(text)),
  );
  const contexts = [...new Set([...KEY_CONTEXTS, ...kept.map((row) => row.context)])];
  return contexts
    .map((context) => ({ context, rows: kept.filter((row) => row.context === context) }))
    .filter((group) => group.rows.length > 0);
}

/** The open state of the sheet of one window. */
export class WindowKeySheet {
  readonly state = shallowReactive({ open: false });

  constructor() {
    markRaw(this);
  }

  open(): void {
    this.state.open = true;
  }

  close(): void {
    this.state.open = false;
  }
}
