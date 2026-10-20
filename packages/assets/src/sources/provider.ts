// SPDX-License-Identifier: Apache-2.0
/**
 * The asset sources: a provider of assets has a search, a preview of each item, the licence of
 * its items (a rights record), and the files of an item to download. Poly Haven is built in (CC0, `polyhaven.ts`); a
 * plugin adds a provider to the registry.
 */
import type { RightsInput } from "../rights/write";

/** The kinds of items of a source: environment maps, models and textures. */
export type SourceKind = "environment" | "model" | "texture";
export const SOURCE_KINDS: readonly SourceKind[] = ["environment", "model", "texture"];

/** One item of a search. */
export interface SourceItem {
  readonly id: string;
  readonly name: string;
  readonly kind: SourceKind;
  readonly tags: readonly string[];
  /** The SPDX ID of the licence of the item. */
  readonly licence: string;
  readonly authors: readonly string[];
}

/** One file of an item: its path in the folder of the item (POSIX, relative) and its URL. The main file is first. */
export interface SourceFile {
  readonly path: string;
  readonly url: string;
  readonly bytes?: number;
}

/** A function that fetches a URL (the global `fetch`, or a fake in a test). */
export type Fetcher = (
  url: string,
  init?: {
    readonly method?: string;
    readonly headers?: Record<string, string>;
    readonly body?: string;
  },
) => Promise<Response>;

/** A provider of assets. */
export interface AssetProvider {
  /** The ID of the provider: the folder of its items and the name of its rights record (`rights/<id>.yaml`). */
  readonly id: string;
  readonly name: string;
  readonly kinds: readonly SourceKind[];
  /** The rights record of the items of the provider, without its date (the import gives the date of the day). */
  readonly rights: Omit<RightsInput, "licenceDate">;
  /** The items of a kind whose name, ID or tags have the text (all items for an empty text), best first. */
  search(kind: SourceKind, text: string): Promise<SourceItem[]>;
  /** The URL of the preview picture of an item. */
  preview(id: string): string;
  /** The files of an item at a resolution (the default of the provider when none), the main file first. */
  files(id: string, kind: SourceKind, resolution?: string): Promise<SourceFile[]>;
}

/** The providers of the asset sources. */
export class ProviderRegistry {
  readonly #providers = new Map<string, AssetProvider>();

  /** Add a provider. A second provider with the same ID throws. */
  add(provider: AssetProvider): this {
    if (!/^[a-z0-9][a-z0-9-]{0,63}$/.test(provider.id)) throw new Error(`"${provider.id}" is not a provider ID`);
    if (this.#providers.has(provider.id)) throw new Error(`the provider ${provider.id} exists already`);
    this.#providers.set(provider.id, provider);
    return this;
  }

  get(id: string): AssetProvider | undefined {
    return this.#providers.get(id);
  }

  list(): AssetProvider[] {
    return [...this.#providers.values()];
  }
}

/** The text of a search as lower-case words. */
export function searchWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .filter((word) => word !== "");
}

/** True when each word of the search is in the ID, the name or a tag of the item. */
export function itemMatches(item: Pick<SourceItem, "id" | "name" | "tags">, words: readonly string[]): boolean {
  const hay = [item.id, item.name, ...item.tags].join(" ").toLowerCase();
  return words.every((word) => hay.includes(word));
}
