// SPDX-License-Identifier: Apache-2.0
/**
 * The rows of the overrides of a prefab instance: the kind of each op, the place of its
 * value (the entity of the prefab, then the component and the field, or the name or the tags) and a short text of the
 * new value. Pure functions, no DOM.
 */

/** One row of an override. */
export interface OverrideRow {
  readonly index: number;
  /** The op: set, remove, add, move. */
  readonly kind: string;
  /** `entity ▸ component ▸ field`, or the path of the op. */
  readonly place: string;
  /** A short JSON text of the value, or null. */
  readonly value: string | null;
  /** The whole op as JSON (the tooltip). */
  readonly detail: string;
}

/** The longest text of a value. */
const VALUE_MAX = 40;

/** The place of a JSON path of a prefab op: `/entities/<id>/components/<c>/<field…>` gives `id ▸ c ▸ field`. */
export function overridePlace(path: string): string {
  const parts = path.split("/").filter((part) => part !== "");
  if (parts[0] !== "entities" || parts[1] === undefined) return path;
  const rest = parts.slice(2);
  const tail = rest[0] === "components" ? rest.slice(1) : rest;
  return [parts[1], ...(tail.length > 1 ? [tail[0], tail.slice(1).join(".")] : tail)].join(" ▸ ");
}

/** The rows of a list of override ops (an item that is no op shows its JSON). */
export function overrideRows(ops: readonly unknown[]): OverrideRow[] {
  return ops.map((op, index) => {
    const value = typeof op === "object" && op !== null ? (op as Record<string, unknown>) : {};
    const path =
      typeof value.path === "string" ? value.path : typeof value.id === "string" ? `/entities/${value.id}` : "";
    const shown =
      "value" in value ? JSON.stringify(value.value) : "entity" in value ? JSON.stringify(value.entity) : null;
    return {
      index,
      kind: typeof value.op === "string" ? value.op : "?",
      place: path === "" ? JSON.stringify(op) : overridePlace(path),
      value: shown === null ? null : shown.length > VALUE_MAX ? `${shown.slice(0, VALUE_MAX - 1)}…` : shown,
      detail: JSON.stringify(op),
    };
  });
}

/** The scope of the apply of one override: the entity of the prefab, and its component and field. */
export function overrideScope(op: unknown): { entity: string; component?: string; field?: string } | null {
  const value = typeof op === "object" && op !== null ? (op as Record<string, unknown>) : {};
  if (typeof value.id === "string") return { entity: value.id };
  if (typeof value.path !== "string") return null;
  const parts = value.path.split("/").filter((part) => part !== "");
  if (parts[0] !== "entities" || parts[1] === undefined) return null;
  const rest = parts.slice(2);
  if (rest[0] !== "components" || rest[1] === undefined) return { entity: parts[1] };
  const field = rest.slice(2).join("/");
  return { entity: parts[1], component: rest[1], ...(field === "" ? {} : { field }) };
}
