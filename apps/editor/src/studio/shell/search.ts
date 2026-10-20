// SPDX-License-Identifier: Apache-2.0
/**
 * Search and ask: one box for the commands, the entities, the assets, the files, the settings and the docs of the
 * window. Each kind is a provider that the page registers. The model has
 * no Vue component: the box (SearchBox.vue) shows it.
 *
 * - A word at the start narrows the providers: `>` commands, `@` entities, `#` assets, `/` recipes, `?` docs. The
 *   filters `t:` (kind), `c:` (component), `tag:` and `in:` (folder) go to the providers.
 * - The rank: an exact name first, then a name that starts with the text and a word that starts with it. Then each
 *   word of the text in the item, and the letters of the text in their order. Among equal items, the items that the
 *   person ran last come first.
 * - A text that reads as a sentence gives "Ask the agent" as the first item. A text with no result also gives it.
 */
import { markRaw, shallowReactive } from "vue";

/** One result of a provider. */
export interface SearchItem {
  /** The ID of the item in its provider (a command ID, an entity ID, a path). */
  readonly id: string;
  readonly label: string;
  /** The second text (a path, the keys, the place). */
  readonly detail?: string;
  /** More words that find the item (an ID, the components, the category). */
  readonly words?: readonly string[];
  /** The reason why the item cannot run. The box shows the item as disabled. */
  readonly reason?: string | null;
  /** The text that ⌘C copies (an ID, a path). */
  readonly copy?: string;
  /** The URL of the docs of the item (a command of a plugin with a docs link). F1 opens it. */
  readonly docs?: string;
  run(): unknown;
}

/** The filters of the text (`t:`, `c:`, `tag:`, `in:`). */
export type SearchFilters = Readonly<Partial<Record<"t" | "c" | "tag" | "in", string>>>;

/** A kind of results of the box. */
export interface SearchProvider {
  readonly id: string;
  /** The word that narrows the box to this provider (`>`, `@`, `#`, `?`, `/`). */
  readonly prefix: string;
  /** The title of the group of the results. */
  readonly title: string;
  /** The items of the provider for the filters (the box ranks them). */
  items(filters: SearchFilters): readonly SearchItem[];
}

/** A ranked result. */
export interface SearchResult {
  readonly provider: string;
  readonly item: SearchItem;
  readonly score: number;
}

/** A text of the box after its parse: the provider of the prefix, the filters and the words. */
export interface SearchQuery {
  readonly provider: string | null;
  readonly filters: SearchFilters;
  readonly text: string;
}

const FILTERS = ["t", "c", "tag", "in"] as const;
/** The words that start a question or a request to the agent. */
const ASK_WORDS = new Set(["how", "what", "why", "where", "when", "which", "who", "can", "could", "please", "make"]);
/** The most results of one provider. */
const PER_PROVIDER = 8;
/** The most recent items that the box keeps. */
const RECENT_MAX = 30;
/** The storage key of the recent items. */
export const RECENT_KEY = "scenity.studio.search.recent";

/** Parse a text of the box with the prefixes of the providers. */
export function parseQuery(raw: string, providers: readonly Pick<SearchProvider, "id" | "prefix">[]): SearchQuery {
  let text = raw.trimStart();
  const owner = providers.find((provider) => provider.prefix !== "" && text.startsWith(provider.prefix));
  if (owner !== undefined) text = text.slice(owner.prefix.length);
  const filters: Partial<Record<(typeof FILTERS)[number], string>> = {};
  const words = text.split(/\s+/).filter((word) => {
    const [name, value] = word.split(":", 2);
    const filter = FILTERS.find((item) => item === name);
    if (filter === undefined || value === undefined || value === "") return true;
    filters[filter] = value.toLowerCase();
    return false;
  });
  return { provider: owner?.id ?? null, filters, text: words.join(" ").trim().toLowerCase() };
}

/** True when the letters of `query` are in `text` in their order. */
function inOrder(query: string, text: string): boolean {
  let at = 0;
  for (const letter of text) if (letter === query[at]) at += 1;
  return at === query.length;
}

/** The score of one text for a query (0: no match). */
export function scoreText(query: string, text: string): number {
  const value = text.toLowerCase();
  if (query === "") return 1;
  if (value === query) return 100;
  if (value.startsWith(query)) return 80;
  const words = value.split(/[^a-z0-9]+/);
  if (words.some((word) => word.startsWith(query))) return 60;
  if (value.includes(query)) return 45;
  const parts = query.split(" ").filter((part) => part !== "");
  if (parts.length > 1 && parts.every((part) => value.includes(part))) return 35;
  if (query.length >= 3 && inOrder(query.replaceAll(" ", ""), value)) return 10;
  return 0;
}

/** The score of an item: its label first, then its ID and its other words, then its detail (a path, a place). */
export function scoreItem(query: string, item: SearchItem): number {
  const label = scoreText(query, item.label);
  const other = Math.max(0, ...[item.id, ...(item.words ?? [])].map((text) => scoreText(query, text)));
  const detail = scoreText(query, item.detail ?? "");
  return Math.max(label, other * 0.9, detail * 0.5);
}

/** True when a text reads as a sentence: a question, a request word first, or four words or more. */
export function readsAsSentence(text: string): boolean {
  const words = text
    .trim()
    .split(/\s+/)
    .filter((word) => word !== "");
  if (words.length === 0) return false;
  return text.trim().endsWith("?") || ASK_WORDS.has(words[0]?.toLowerCase() ?? "") || words.length >= 4;
}

/** Rank the items of the providers for a text. `recent` has the keys (`provider:id`) of the last runs, newest first. */
export function searchAll(
  providers: readonly SearchProvider[],
  raw: string,
  recent: readonly string[] = [],
  limit = PER_PROVIDER,
): SearchResult[] {
  const query = parseQuery(raw, providers);
  const results: SearchResult[] = [];
  for (const provider of providers) {
    if (query.provider !== null && query.provider !== provider.id) continue;
    const found = provider
      .items(query.filters)
      .map((item) => {
        const score = scoreItem(query.text, item);
        const index = recent.indexOf(`${provider.id}:${item.id}`);
        // A recent item comes first among equal items. The last run gets the highest score.
        const bonus = score > 0 && index >= 0 ? (RECENT_MAX - index) / RECENT_MAX : 0;
        return { provider: provider.id, item, score: score === 0 ? 0 : score + bonus };
      })
      .filter((result) => result.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
    results.push(...found);
  }
  return results.sort((a, b) => b.score - a.score);
}

/** The state of the box of one window. */
export interface SearchState {
  open: boolean;
  text: string;
  /** One more after each load of the providers (the box ranks again). */
  version: number;
}

/** The search of one window: the providers, the open state and the recent items. */
export class WindowSearch {
  readonly state = shallowReactive<SearchState>({ open: false, text: "", version: 0 });
  readonly #providers: SearchProvider[] = [];
  readonly #storage: () => Storage;
  /** Ask the agent. If absent, the window has no agent, and the box shows the item as disabled. */
  ask: ((text: string) => void) | null = null;
  /** The loads of the providers at an open of the box (the files, the assets, the docs). */
  prepare: (() => Promise<void>) | null = null;
  /** Open a text in the Search window (⌥↩ in the box). Null when the window has no Search window. */
  openWindow: ((text: string) => void) | null = null;

  constructor(storage: () => Storage = () => localStorage) {
    this.#storage = storage;
    markRaw(this);
  }

  /** Add a provider (it replaces a registered provider with the same ID). The result removes it. */
  register(provider: SearchProvider): () => void {
    const at = this.#providers.findIndex((item) => item.id === provider.id);
    if (at >= 0) this.#providers.splice(at, 1, provider);
    else this.#providers.push(provider);
    return () => {
      const index = this.#providers.indexOf(provider);
      if (index >= 0) this.#providers.splice(index, 1);
    };
  }

  providers(): readonly SearchProvider[] {
    return this.#providers;
  }

  /** Open the box with a text (`@` for the scene filter of ⌘O). */
  open(text = ""): void {
    this.state.text = text;
    this.state.open = true;
    this.load();
  }

  /** Load the providers again. The results get a new rank after the load. */
  load(): void {
    void this.prepare?.().then(() => (this.state.version += 1));
  }

  close(): void {
    this.state.open = false;
  }

  /** The ranked results of a text, at most `limit` of each provider. */
  results(text: string, limit?: number): SearchResult[] {
    return searchAll(this.#providers, text, this.recent(), limit);
  }

  /** The keys of the last runs, newest first. */
  recent(): string[] {
    try {
      const value: unknown = JSON.parse(this.#storage().getItem(RECENT_KEY) ?? "[]");
      return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
    } catch {
      return [];
    }
  }

  /** Run a result: close the box, keep it as recent, then run it. */
  run(result: Pick<SearchResult, "provider" | "item">): void {
    this.close();
    const key = `${result.provider}:${result.item.id}`;
    const next = [key, ...this.recent().filter((item) => item !== key)].slice(0, RECENT_MAX);
    try {
      this.#storage().setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      // No storage: the order stays as it is.
    }
    void result.item.run();
  }
}
