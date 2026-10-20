// SPDX-License-Identifier: Apache-2.0
/**
 * The entity table of the Search window. A query has the words of the hierarchy search (`c:`, `tag:`, `name:` and plain
 * words), the kind word `t:` (model, light, camera, sound, note) and comparisons of a field with a value
 * (`intensity>2`, `light.range<=4`, `castShadow=true`). The result has a row for each entity that matches, in tree
 * order, and a column for each compared field. A query with no comparison and one exact `c:` component gives a column
 * for each plain value of that component. Pure functions, no DOM.
 */
import { entityMatches, searchTerms, treeOrder } from "@scenity/editor-core";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import { ENTITY_KINDS } from "../selectionCommands";

/** The operators of a comparison. */
export const COMPARE_OPS = [">=", "<=", "!=", ">", "<", "="] as const;
export type CompareOp = (typeof COMPARE_OPS)[number];

/** One comparison of a query: a field path, an operator and the text of the value. */
export interface Comparison {
  /** The field path: `intensity`, or `light.intensity` with the component first. */
  readonly path: string;
  readonly op: CompareOp;
  readonly value: string;
}

/** A query of the table after its parse. */
export interface TableQuery {
  /** The words for the hierarchy search (`c:`, `tag:`, `name:` and plain words). */
  readonly words: string;
  /** The kind of the `t:` word, or null. */
  readonly kind: string | null;
  readonly comparisons: readonly Comparison[];
}

/** A column of the table: a field of a component. */
export interface TableColumn {
  /** The key of the column: the path of the comparison, or `<component>.<field>`. */
  readonly key: string;
  /** The component of the field, or null: each entity finds the field in its own components. */
  readonly component: string | null;
  /** The field path in the component (dots between the parts). */
  readonly field: string;
}

/** A cell of the table: the component and the value of the field in one entity. */
export interface TableCell {
  readonly component: string;
  readonly field: string;
  readonly value: unknown;
}

/** A row of the table: an entity and its cells by the column key. */
export interface TableRow {
  readonly id: string;
  readonly label: string;
  readonly components: readonly string[];
  readonly cells: Readonly<Record<string, TableCell>>;
}

/** The table of a query. */
export interface EntityTable {
  readonly columns: readonly TableColumn[];
  readonly rows: readonly TableRow[];
  /** The number of entities that match, before the limit. */
  readonly matches: number;
}

/** The most rows of a table. */
export const TABLE_LIMIT = 500;
/** The most columns of the plain values of one component. */
const COMPONENT_COLUMNS = 6;
const COMPARISON = /^([A-Za-z_][\w.]*)(>=|<=|!=|>|<|=)(.+)$/;

/** Parse the text of the Search window into the words, the kind and the comparisons. */
export function parseTable(text: string): TableQuery {
  const words: string[] = [];
  const comparisons: Comparison[] = [];
  let kind: string | null = null;
  for (const word of text.trim().split(/\s+/)) {
    if (word === "") continue;
    const match = COMPARISON.exec(word);
    if (word.toLowerCase().startsWith("t:") && word.length > 2) kind = word.slice(2).toLowerCase();
    else if (match !== null && !word.includes(":"))
      comparisons.push({ path: match[1] ?? "", op: match[2] as CompareOp, value: match[3] ?? "" });
    else words.push(word);
  }
  return { words: words.join(" "), kind, comparisons };
}

/** The value at a field path of a component value, or undefined. */
export function valueAt(value: unknown, field: string): unknown {
  let at: unknown = value;
  for (const part of field.split(".")) {
    if (at === null || typeof at !== "object") return undefined;
    at = (at as Record<string, unknown>)[part];
  }
  return at;
}

/**
 * True when a value meets a comparison. Numbers compare as numbers; other values compare as text, with = and != only.
 */
export function meets(value: unknown, op: CompareOp, text: string): boolean {
  if (value === undefined) return false;
  const target = Number(text);
  if (typeof value === "number" && text.trim() !== "" && Number.isFinite(target)) {
    const order: Readonly<Record<CompareOp, boolean>> = {
      ">=": value >= target,
      "<=": value <= target,
      "!=": value !== target,
      ">": value > target,
      "<": value < target,
      "=": value === target,
    };
    return order[op];
  }
  const shown = typeof value === "string" ? value : JSON.stringify(value);
  const same = shown.toLowerCase() === text.toLowerCase();
  return op === "=" ? same : op === "!=" ? !same : false;
}

type Components = Readonly<Record<string, unknown>>;

/** The cell of a field path in the components of an entity; `only` keeps the components that hold its text. */
function cellOf(components: Components, path: string, only: string | null): TableCell | null {
  const [head = "", ...rest] = path.split(".");
  if (rest.length > 0 && Object.hasOwn(components, head)) {
    const field = rest.join(".");
    const value = valueAt(components[head], field);
    return value === undefined ? null : { component: head, field, value };
  }
  for (const component of Object.keys(components).sort()) {
    if (only !== null && !component.toLowerCase().includes(only)) continue;
    const value = valueAt(components[component], path);
    if (value !== undefined) return { component, field: path, value };
  }
  return null;
}

/** The `c:` text of the words, or null. */
function componentWord(words: string): string | null {
  const term = searchTerms(words).find((item) => item.field === "component");
  return term?.text ?? null;
}

/** The columns of the plain values (number, true or false, text) of one component. */
function componentColumns(doc: EntityDocument, ids: readonly string[], component: string): TableColumn[] {
  const value = ids.map((id) => doc.entities[id]?.components[component]).find((item) => item !== undefined);
  if (value === null || typeof value !== "object") return [];
  return Object.entries(value as Record<string, unknown>)
    .filter(([, field]) => ["number", "boolean", "string"].includes(typeof field))
    .slice(0, COMPONENT_COLUMNS)
    .map(([field]) => ({ key: `${component}.${field}`, component, field }));
}

/** The entities that match a query, as a table with a column for each compared field. */
export function entityTable(doc: EntityDocument, text: string, limit = TABLE_LIMIT): EntityTable {
  const query = parseTable(text);
  const terms = searchTerms(query.words);
  const only = componentWord(query.words);
  const kind = query.kind === null ? null : (ENTITY_KINDS[query.kind] ?? query.kind);
  const ids = treeOrder(doc).filter((id) => {
    const components = doc.entities[id]?.components ?? {};
    if (kind !== null && !Object.hasOwn(components, kind)) return false;
    if (terms.length > 0 && !entityMatches(doc, id, terms)) return false;
    return query.comparisons.every((item) => {
      const cell = cellOf(components, item.path, only);
      return cell !== null && meets(cell.value, item.op, item.value);
    });
  });
  const exact = only !== null && ids.some((id) => Object.hasOwn(doc.entities[id]?.components ?? {}, only));
  const columns: TableColumn[] =
    query.comparisons.length > 0
      ? [...new Set(query.comparisons.map((item) => item.path))].map((path) => ({
          key: path,
          component: null,
          field: path,
        }))
      : exact
        ? componentColumns(doc, ids, only)
        : [];
  const rows = ids.slice(0, limit).map((id): TableRow => {
    const entity = doc.entities[id];
    const components = entity?.components ?? {};
    const cells: Record<string, TableCell> = {};
    for (const column of columns) {
      const cell = cellOf(components, column.key, only);
      if (cell !== null) cells[column.key] = cell;
    }
    return { id, label: entity?.name ?? id, components: Object.keys(components).sort(), cells };
  });
  return { columns, rows, matches: ids.length };
}
