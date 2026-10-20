// SPDX-License-Identifier: Apache-2.0
/**
 * The view of a simulation state. A state is plain JSON. A field that holds a record of records (the cars of the
 * traffic plugin, its walkers) becomes a table. The table has a row for each key and a column for each field with a
 * plain value. The other fields are values with their names. The module has only pure functions and no DOM.
 */

/** A plain value of a cell: a number, a text, a flag or null. Another value shows as JSON. */
export type Cell = string | number | boolean | null;

/** A table of a state: its field, its columns and a row for each key. */
export interface StateTable {
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly { readonly id: string; readonly cells: readonly Cell[] }[];
}

/** The view of one state: its tables and its other fields. */
export interface StateView {
  readonly tables: readonly StateTable[];
  readonly values: readonly { readonly name: string; readonly value: string }[];
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The cell of a value: a number to 4 decimals, a plain value as it is, another value as JSON. */
function cellOf(value: unknown): Cell {
  if (typeof value === "number") return Math.round(value * 1e4) / 1e4;
  if (value === undefined || value === null) return null;
  if (typeof value === "string" || typeof value === "boolean") return value;
  return JSON.stringify(value);
}

/** The view of a state. Each record of records is a table, and the other fields are values. */
export function stateView(state: unknown): StateView {
  if (!isRecord(state)) return { tables: [], values: [{ name: "", value: JSON.stringify(state) }] };
  const tables: StateTable[] = [];
  const values: { name: string; value: string }[] = [];
  for (const [name, value] of Object.entries(state).sort(([a], [b]) => a.localeCompare(b))) {
    const entries = isRecord(value) ? Object.entries(value) : [];
    if (entries.length > 0 && entries.every(([, row]) => isRecord(row))) {
      const columns = [...new Set(entries.flatMap(([, row]) => Object.keys(row as object)))].sort();
      const rows = entries
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([id, row]) => ({ id, cells: columns.map((column) => cellOf((row as Record<string, unknown>)[column])) }));
      tables.push({ name, columns, rows });
    } else {
      const cell = cellOf(value);
      values.push({ name, value: typeof cell === "string" ? cell : JSON.stringify(cell) });
    }
  }
  return { tables, values };
}
