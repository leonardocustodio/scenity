// SPDX-License-Identifier: Apache-2.0
/**
 * The Fluent texts of the editor. The lab page, the scene page and the player window have one runtime per page. The
 * runtime holds the texts of the ui package and the files `src/i18n/<locale>/<name>.ftl` of the editor. Each part
 * has one namespace, for example `scene-bar` or `hierarchy`. The room texts that the 3D room view reads
 * (`room-3d-loading`, `room-team`) are in `room.ftl`.
 *
 * The URL parameter `locale` selects the locale of the page: a supported locale, or `pseudo` (also `en-XA`) for the
 * pseudo-locale. Each other value gives en-US. The Vue apps of the page install `editorI18n().plugin`. Plain DOM code
 * calls `t(id, args)`.
 *
 * The editor texts hold file paths and IDs, and the locales are left to right. Thus the runtime puts no isolation
 * marks around the placeables (`useIsolating: false`), so a copied path has no hidden characters.
 */
import {
  collectResources,
  createI18n,
  isUiLocale,
  PSEUDO_LOCALE,
  SOURCE_LOCALE,
  type DisplayLocale,
  type FtlResource,
  type I18n,
} from "@scenity/i18n";

/** The folder of the FTL files of the ui package. The index module of the package would add each ui component. */
const UI_FOLDER = "../../../packages/ui/src/i18n/";

/**
 * The FTL files by path. Vite gives them (`import.meta.glob`). A Bun script that imports an editor module (the lab
 * CLI, a test) has no glob: it reads the same files from the disk (`bunFiles`).
 */
function ftlFiles(): Record<string, string> {
  try {
    return {
      ...import.meta.glob<string>("./i18n/*/*.ftl", { query: "?raw", import: "default", eager: true }),
      ...import.meta.glob<string>("../../../packages/ui/src/i18n/*.ftl", {
        query: "?raw",
        import: "default",
        eager: true,
      }),
    };
  } catch {
    return bunFiles();
  }
}

/** The node:fs functions that bunFiles() uses. */
interface FileSystem {
  readdirSync(path: URL): string[];
  readFileSync(path: URL, encoding: "utf8"): string;
  existsSync(path: URL): boolean;
}

/** The FTL files from the disk, in Bun only (`import.meta.require`); elsewhere none. */
function bunFiles(): Record<string, string> {
  const meta = import.meta as ImportMeta & { require?: (id: string) => unknown };
  if (typeof meta.require !== "function") return {};
  const fs = meta.require("node:fs") as FileSystem;
  const out: Record<string, string> = {};
  const read = (folder: string, key: string): void => {
    const url = new URL(folder, import.meta.url);
    if (!fs.existsSync(url)) return;
    for (const name of fs.readdirSync(url)) {
      if (name.endsWith(".ftl")) out[`${key}${name}`] = fs.readFileSync(new URL(name, url), "utf8");
    }
  };
  const editor = new URL("./i18n/", import.meta.url);
  for (const locale of fs.existsSync(editor) ? fs.readdirSync(editor) : [])
    read(`./i18n/${locale}/`, `./i18n/${locale}/`);
  read(UI_FOLDER, UI_FOLDER);
  return out;
}

const FILES = ftlFiles();

/** The resources of the ui package (namespace "ui"). */
const UI_FILES: readonly FtlResource[] = collectResources(
  Object.fromEntries(
    Object.entries(FILES)
      .filter(([path]) => path.startsWith(UI_FOLDER))
      .map(([path, source]) => [`packages/ui/src/i18n/${path.slice(UI_FOLDER.length)}`, source]),
  ),
);

/** The Fluent resources of the editor, by locale and namespace. */
export const EDITOR_RESOURCES: readonly FtlResource[] = collectResources(
  Object.fromEntries(Object.entries(FILES).filter(([path]) => path.startsWith("./i18n/"))),
);

/** The URL values that select the pseudo-locale. */
const PSEUDO_VALUES: ReadonlySet<string> = new Set(["pseudo", PSEUDO_LOCALE]);

/** Return the locale that the `locale` parameter of a URL search selects (en-US when the value is not known). */
export function pageLocale(search: string): DisplayLocale {
  const value = new URLSearchParams(search).get("locale");
  if (value !== null && PSEUDO_VALUES.has(value)) return PSEUDO_LOCALE;
  return isUiLocale(value) ? value : SOURCE_LOCALE;
}

let shared: I18n | null = null;

/** The Fluent runtime of this page. The first call reads the locale of the page URL and sets `<html lang>`. */
export function editorI18n(): I18n {
  if (shared === null) {
    const locale = pageLocale(typeof location === "undefined" ? "" : location.search);
    shared = createI18n({ locale, resources: [...UI_FILES, ...EDITOR_RESOURCES], useIsolating: false });
    if (typeof document !== "undefined") document.documentElement.lang = locale;
  }
  return shared;
}

/** The text of a message of the editor. A message that no locale has gives its ID. */
export function t(id: string, args?: Record<string, unknown>): string {
  return editorI18n().format(id, args);
}

/** The IDs of the en-US messages of the editor (each locale falls back to en-US). */
const MESSAGE_IDS: ReadonlySet<string> = new Set(
  EDITOR_RESOURCES.filter((resource) => resource.locale === SOURCE_LOCALE).flatMap((resource) =>
    Array.from(resource.source.matchAll(/^([a-z][\w-]*)\s*=/gm), (match) => match[1] ?? ""),
  ),
);

/**
 * The text of a message when the editor has it, else the fallback text. The page gives its own message for a text
 * that a package gives in English (a command title, a setting label). An ID of the package is the key.
 */
export function textOr(id: string, fallback: string, args?: Record<string, unknown>): string {
  return MESSAGE_IDS.has(id) ? t(id, args) : fallback;
}

/**
 * The message ID of a dotted ID of a package: the prefix, then the parts with hyphens ("entity.copy" →
 * "x-entity-copy").
 */
export function messageIdOf(prefix: string, id: string): string {
  return `${prefix}-${id
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .toLowerCase()}`;
}
