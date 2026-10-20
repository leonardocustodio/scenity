// SPDX-License-Identifier: Apache-2.0
/**
 * Fluent resources from the files of the workspace (README "Fluent resources").
 *
 * Each package or feature keeps one file per locale next to its code: `i18n/<locale>.ftl`, or
 * `i18n/<locale>/<namespace>.ftl` for a folder with more than one namespace. The app collects the files
 * with `import.meta.glob` and gives them to createI18n().
 */

/** The text of one Fluent file. */
export interface FtlResource {
  /** The BCP 47 tag of the file, for example "en-US". */
  readonly locale: string;
  /** The name of the package, feature or folder that owns the file, for example "app" or "registry". */
  readonly namespace: string;
  /** The FTL source. */
  readonly source: string;
}

const LOCALE_TAG = /^[a-z]{2,3}(?:-[A-Z][a-z]{3})?(?:-(?:[A-Z]{2}|\d{3}))?$/;
/** Folder names that do not name a namespace: the namespace is the folder above them. */
const NEUTRAL_FOLDERS: ReadonlySet<string> = new Set(["i18n", "src", "locales", "."]);

/** True when a file or folder name is a locale tag such as "en-US" or "pt-BR". */
export function isLocaleTag(name: string): boolean {
  return LOCALE_TAG.test(name);
}

/**
 * Return the locale and the namespace of a Fluent file path, or null when the path names no locale.
 *
 * - `.../features/library/i18n/en-US.ftl` gives en-US and "library".
 * - `.../packages/ui/src/i18n/pt-BR.ftl` gives pt-BR and "ui".
 * - `.../i18n/en-US/room.ftl` gives en-US and "room".
 * - `.../i18n/src/registry/en-US.ftl` gives en-US and "registry".
 */
export function resourcePath(path: string): { locale: string; namespace: string } | null {
  const parts = path.split(/[\\/]/).filter((part) => part !== "");
  const file = parts.at(-1);
  if (file?.endsWith(".ftl") !== true) {
    return null;
  }
  const stem = file.slice(0, -".ftl".length);
  const folders = parts.slice(0, -1);
  if (isLocaleTag(stem)) {
    const namespace = [...folders].reverse().find((folder) => !NEUTRAL_FOLDERS.has(folder));
    return { locale: stem, namespace: namespace ?? "app" };
  }
  const parent = folders.at(-1);
  if (parent !== undefined && isLocaleTag(parent)) {
    return { locale: parent, namespace: stem };
  }
  return null;
}

/**
 * Turn the result of `import.meta.glob("…/*.ftl", { query: "?raw", import: "default", eager: true })`
 * into resources. Paths that name no locale are ignored. The result is in a stable order (by path), so
 * the bundles are the same in every build.
 */
export function collectResources(modules: Record<string, string>): FtlResource[] {
  return Object.keys(modules)
    .sort()
    .flatMap((path) => {
      const where = resourcePath(path);
      const source = modules[path];
      return where === null || source === undefined ? [] : [{ ...where, source }];
    });
}
