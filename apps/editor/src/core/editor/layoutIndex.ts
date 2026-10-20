// SPDX-License-Identifier: Apache-2.0
/**
 * The saved layouts of the lab: the files `apps/editor/src/core/layouts/<name>.json`. Vite reads them with
 * `import.meta.glob`. A new file of `labs layout-save` comes into the page with the next update of Vite. The tools of
 * Bun (`labs list`) read the folder themselves (apps/editor/scripts/lab/layoutSave.ts), because Bun has no
 * `import.meta.glob`.
 *
 * A file that is not a layout (a bad name or bad values) is not in the list. `layoutProblems` names it.
 */
import { parseLayoutFile, type LayoutFile } from "./layoutFiles";
import { t } from "../../texts";

const FILES = import.meta.glob<unknown>("../layouts/*.json", { import: "default", eager: true });

/** The name of a layout file from its path (`../layouts/bay-b.json` → `bay-b`). */
function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1).replace(/\.json$/, "");
}

/** The saved layouts of a set of files, in the order of their names. */
export function layoutsOf(files: Readonly<Record<string, unknown>>): LayoutFile[] {
  return Object.entries(files)
    .map(([path, value]) => parseLayoutFile(value, nameOf(path)))
    .filter((layout): layout is LayoutFile => layout !== null)
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The files of the folder that are not layouts. */
export function layoutProblems(files: Readonly<Record<string, unknown>> = FILES): string[] {
  return Object.entries(files)
    .filter(([path, value]) => parseLayoutFile(value, nameOf(path)) === null)
    .map(([path]) => t("commands-layout-bad-file", { name: nameOf(path) }));
}

/** The saved layouts of the checkout. */
export const SAVED_LAYOUTS: readonly LayoutFile[] = layoutsOf(FILES);
