// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the Search window: the text, the kind of results, and the saved searches of the project. The saved
 * searches are a convenience of the person, so the storage of the browser keeps them (no storage: the list stays in the
 * page only). The text of a result list without the comparisons goes to the providers of the search box
 * (studio/shell/search.ts); the entity table reads all the text (searchTable.ts).
 */
import { ref, type Ref } from "vue";
import { COMPARE_OPS } from "./searchTable";

/** The most saved searches of a project. */
export const SAVED_MAX = 20;

/** The storage key of the saved searches of a project. */
export function savedKey(project: string): string {
  return `scenity.search.saved.${project}`;
}

/** The state of the Search window of one page. */
export class SearchWindowState {
  readonly text = ref("");
  /** The provider of the results that show, or null for all of them. */
  readonly scope: Ref<string | null> = ref(null);
  readonly saved: Ref<readonly string[]> = ref([]);
  readonly #key: string;
  readonly #storage: () => Storage;

  constructor(project: string, storage: () => Storage = () => localStorage) {
    this.#key = savedKey(project);
    this.#storage = storage;
    this.saved.value = this.#read();
  }

  #read(): string[] {
    try {
      const value: unknown = JSON.parse(this.#storage().getItem(this.#key) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  #write(list: readonly string[]): void {
    this.saved.value = list;
    try {
      this.#storage().setItem(this.#key, JSON.stringify(list));
    } catch {
      // No storage: the list stays in the page only.
    }
  }

  /** Save a text (the first of the list); an empty text does nothing. */
  save(text: string): void {
    const value = text.trim();
    if (value === "") return;
    this.#write([value, ...this.saved.value.filter((item) => item !== value)].slice(0, SAVED_MAX));
  }

  /** Remove a saved text. */
  remove(text: string): void {
    this.#write(this.saved.value.filter((item) => item !== text));
  }
}

/** The text without its comparisons (`intensity>2`): the providers of the search box take it. */
export function listText(text: string): string {
  return text
    .split(/\s+/)
    .filter((word) => word.includes(":") || !COMPARE_OPS.some((op) => word.includes(op)))
    .join(" ")
    .trim();
}
