// SPDX-License-Identifier: Apache-2.0
/**
 * A module of `@scenity/assets` for the dev server plugins of the scene page.
 *
 * The specifier is not a literal, so the bundle of the Vite config does not contain the asset tools. Bun loads them at
 * the first project request. The resolver starts at the folder of this file, so the editor finds its own dependency in a
 * checkout and in an installed package (`node_modules/@scenity/editor`).
 */
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const resolveFrom = createRequire(import.meta.url);

/** Load an entry of `@scenity/assets` by its export subpath (`""` is the main entry, else for example `"import"`). */
export function assetsModule<T>(subpath: string): Promise<T> {
  const file = resolveFrom.resolve(subpath === "" ? "@scenity/assets" : `@scenity/assets/${subpath}`);
  return import(/* @vite-ignore */ pathToFileURL(file).href) as Promise<T>;
}
