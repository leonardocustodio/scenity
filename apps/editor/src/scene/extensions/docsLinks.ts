// SPDX-License-Identifier: Apache-2.0
/**
 * The docs links of the plugins (the `docs` point of a studio face): a URL for a panel
 * (`panel:<id>`, F1 on the panel), a component (`component:<id>`, the docs button of its card in the inspector) or a
 * command (`command:<id>`).
 */
import { shallowReactive } from "vue";

/** The key of a docs link: the kind and the ID of the part. */
export type DocsKey = `panel:${string}` | `component:${string}` | `command:${string}`;

const links = shallowReactive(new Map<DocsKey, string>());

/** Add a docs link; the result removes it. */
export function addDocsLink(key: DocsKey, url: string): () => void {
  links.set(key, url);
  return () => {
    if (links.get(key) === url) links.delete(key);
  };
}

/** The docs link of a part, or null. */
export function docsLinkOf(key: DocsKey): string | null {
  return links.get(key) ?? null;
}
