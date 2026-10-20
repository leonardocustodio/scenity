// SPDX-License-Identifier: Apache-2.0
/**
 * The log of the Console panel: the lines of the page, the worker, the dev server, the plugins, the jobs and the agent
 * tools in one list. A line that comes again (the same
 * source, level and text) is one entry with its count and its last time. Each entry keeps the entity and the file
 * that its text names, so a click selects the entity or opens the file. The newest `CONSOLE_MAX` entries stay.
 */
import { shallowRef, type ShallowRef } from "vue";

export const LOG_LEVELS = ["error", "warn", "info"] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const LOG_SOURCES = ["page", "worker", "server", "host", "plugin", "job", "agent"] as const;
export type LogSource = (typeof LOG_SOURCES)[number];

/** The most entries of the log. */
export const CONSOLE_MAX = 1000;
/** The longest text of an entry (characters). */
const TEXT_LIMIT = 8000;

/** One entry of the log. */
export interface LogEntry {
  readonly id: number;
  readonly level: LogLevel;
  readonly source: LogSource;
  /** The text; its first line is the line of the list. */
  readonly text: string;
  /** More words for the detail pane (a stack, the output of a job), or null. */
  readonly detail: string | null;
  readonly first: number;
  readonly last: number;
  readonly count: number;
  /** The entity that the text names (`entity:<id>`), or null. */
  readonly entity: string | null;
  /** The file that the text names (a path with an extension, with its line), or null. */
  readonly file: { readonly path: string; readonly line: number | null } | null;
}

/** A new line of the log. */
export interface LogInput {
  readonly level: LogLevel;
  readonly source: LogSource;
  readonly text: string;
  readonly detail?: string | null;
  readonly at?: number;
}

const ENTITY = /\bentity:([A-Za-z0-9_-]+)/;
const FILE =
  /(?:^|[\s(])((?:[\w.-]+\/)*[\w.-]+\.(?:scene\.json|prefab\.json|sequence\.json|material\.json|json|ts|js|vue))(?::(\d+))?/;

/** The entity and the file that a text names. */
export function refsOf(text: string): Pick<LogEntry, "entity" | "file"> {
  const entity = ENTITY.exec(text)?.[1] ?? null;
  const found = FILE.exec(text);
  const path = found?.[1];
  return {
    entity,
    file: path === undefined ? null : { path, line: found?.[2] === undefined ? null : Number(found[2]) },
  };
}

/** The log of one editor window. */
export class ConsoleStore {
  readonly entries: ShallowRef<readonly LogEntry[]> = shallowRef([]);
  #next = 1;

  /** Add a line. A line with the source, the level and the text of an entry increments the count of that entry. */
  add(input: LogInput): void {
    const text = input.text.length > TEXT_LIMIT ? `${input.text.slice(0, TEXT_LIMIT)}…` : input.text;
    const at = input.at ?? Date.now();
    const list = this.entries.value;
    const index = list.findIndex(
      (entry) => entry.source === input.source && entry.level === input.level && entry.text === text,
    );
    const same = index < 0 ? undefined : list[index];
    if (same !== undefined) {
      const next = [...list];
      next[index] = { ...same, count: same.count + 1, last: at, detail: input.detail ?? same.detail };
      this.entries.value = next;
      return;
    }
    const entry: LogEntry = {
      id: this.#next++,
      level: input.level,
      source: input.source,
      text,
      detail: input.detail ?? null,
      first: at,
      last: at,
      count: 1,
      ...refsOf(text),
    };
    this.entries.value = [...list, entry].slice(-CONSOLE_MAX);
  }

  clear(): void {
    this.entries.value = [];
  }

  /** The count of the lines of each level (an entry counts its repeats). */
  counts(): Record<LogLevel, number> {
    const counts: Record<LogLevel, number> = { error: 0, warn: 0, info: 0 };
    for (const entry of this.entries.value) counts[entry.level] += entry.count;
    return counts;
  }
}

/** The filter of the panel: the levels that show, a source (null: all) and the words of a search. */
export interface LogFilter {
  readonly levels: ReadonlySet<LogLevel>;
  readonly source: LogSource | null;
  readonly text: string;
}

/** The entries of a filter, the oldest first. */
export function filterEntries(entries: readonly LogEntry[], filter: LogFilter): LogEntry[] {
  const words = filter.text.toLowerCase().split(/\s+/).filter(Boolean);
  return entries.filter(
    (entry) =>
      filter.levels.has(entry.level) &&
      (filter.source === null || entry.source === filter.source) &&
      words.every((word) => `${entry.text} ${entry.detail ?? ""}`.toLowerCase().includes(word)),
  );
}

const current = new ConsoleStore();

/** The log of the page. */
export function pageConsole(): ConsoleStore {
  return current;
}
