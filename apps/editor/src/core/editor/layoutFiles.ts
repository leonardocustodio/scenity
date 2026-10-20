// SPDX-License-Identifier: Apache-2.0
/**
 * The layout variants of the scene editor. A layout is a named tune set of the places of the room, kept in
 * `apps/editor/src/core/layouts/<name>.json`. A layout is a lab tool only: the game never reads the folder. A room kit
 * of the game is a separate change of the runtime.
 *
 * - **What a layout holds** (`LAYOUT_PREFIXES`): the places of the props (`room.props.<slot>.at.*`, `.yaw`) and the
 *   bends of the cable routes (`routes.*`), because a cable follows the device that it goes to. The light (`light.*`)
 *   and the hand targets (`pose.*`) stay out. They are the look and the motion, not the arrangement. A compare of two
 *   layouts must show the same light and the same motion. The team places are take events (`place`), not tune values,
 *   so a layout does not hold them. A layout keeps the camera of the save (`camera`, a named camera or a view text)
 *   as a note. "Open layout" does not change the camera.
 * - **The file**: `{ "name", "doc", "camera", "tunes": { path: number } }`, the paths in sorted order, the numbers on
 *   the grid of 0.1 mm (the grid of the commands). `labs layout-save` (apps/editor/scripts/lab/layoutSave.ts) writes it
 *   with the text of `layoutFileText`. Thus the lab and the tool write the same bytes.
 * - **Open** gives tune ops. Each layout path of the page that the layout does not hold returns to its default. Each
 *   value of the layout is set. Thus the page shows the layout exactly, and one undo removes it.
 *
 * No Vue import and no `import.meta.glob` (layoutIndex.ts reads the folder): the tools and the tests read it.
 */
import { tuneText } from "@scenity/runtime-dev";
import type { TuneOp } from "./ops";
import { t } from "../../texts";

/** The tune paths that a layout holds: the prop places and the cable bends. */
export const LAYOUT_PREFIXES: readonly string[] = ["room.props.", "routes."];

/** The tool of the source op of `layout.variant.save`: the host runs it as a run of the Runs tab. */
export const LAYOUT_SAVE_TOOL = "labs layout-save";

/** The folder of the layout files from the repo root. */
export const LAYOUTS_FOLDER = "apps/editor/src/core/layouts";

/** The names that are not layouts: the current layout of the page, and the layout of the code. */
export const NOW_LAYOUT = "now";
export const CODE_LAYOUT = "code";

/** A saved layout: the content of `layouts/<name>.json`. */
export interface LayoutFile {
  readonly name: string;
  readonly doc: string;
  /** The camera of the save: a named camera, or the seven numbers of a view. It is a note only. */
  readonly camera: string | null;
  readonly tunes: Readonly<Record<string, number>>;
}

const NAME_MAX = 40;
const DOC_MAX = 160;
/** A name: small letters and digits, parts with a hyphen between them (as a camera name). */
const NAME = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/;
/** The characters that a doc line cannot have: the characters that a run refuses, and line breaks. */
const DOC_BAD = /[;|&$`<>\\"\r\n]/;
/** A search variant of the page (`v1` to `v9`): not a name of a saved layout. */
const VARIANT_ID = /^v\d+$/;

/** True for a tune path that a layout holds. */
export function isLayoutPath(path: string): boolean {
  return LAYOUT_PREFIXES.some((prefix) => path.startsWith(prefix));
}

/** The layout part of tune values: the prop places and the cable bends. */
export function layoutValues(tunes: Readonly<Record<string, number>>): Record<string, number> {
  return Object.fromEntries(Object.entries(tunes).filter(([path]) => isLayoutPath(path)));
}

/** A number of a layout on the grid of 0.1 mm (the numbers that `labs tune-apply` writes). */
export function layoutNumber(value: number): number {
  return Math.round(value * 1e4) / 1e4;
}

/** Why a text is not the name of a new layout, or null. */
export function layoutNameProblem(name: string): string | null {
  if (name.length === 0 || name.length > NAME_MAX) return t("commands-layout-name-length", { max: String(NAME_MAX) });
  if (!NAME.test(name)) {
    return t("commands-layout-name-bad", { name });
  }
  if (name === NOW_LAYOUT || name === CODE_LAYOUT) return t("commands-layout-name-word", { name });
  if (VARIANT_ID.test(name)) return t("commands-layout-name-variant", { name });
  return null;
}

/** Why a text is not the doc line of a layout, or null. */
export function layoutDocProblem(doc: string): string | null {
  if (doc.length > DOC_MAX) return t("commands-layout-doc-length", { max: String(DOC_MAX) });
  if (DOC_BAD.test(doc)) return t("commands-layout-doc-bad");
  return null;
}

/** The problems of the tune values of a layout (empty: no problem). `known` tells if a path is a tuned number. */
export function layoutTuneProblems(
  tunes: Readonly<Record<string, number>>,
  known?: (path: string) => boolean,
): string[] {
  const problems: string[] = [];
  for (const [path, value] of Object.entries(tunes)) {
    if (!isLayoutPath(path))
      problems.push(t("commands-layout-not-place", { path, prefixes: LAYOUT_PREFIXES.join(", ") }));
    else if (known !== undefined && !known(path)) problems.push(t("commands-layout-not-tuned", { path }));
    if (!Number.isFinite(value)) problems.push(t("commands-layout-not-finite", { path }));
  }
  return problems;
}

/** The layout values in the order and on the grid of a file. */
export function sortedLayout(tunes: Readonly<Record<string, number>>): Record<string, number> {
  const entries = Object.entries(layoutValues(tunes)).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return Object.fromEntries(entries.map(([path, value]) => [path, layoutNumber(value)]));
}

/** The text of a layout file (two spaces, a line break at the end), as `labs layout-save` writes it. */
export function layoutFileText(layout: LayoutFile): string {
  const file = { name: layout.name, doc: layout.doc, camera: layout.camera, tunes: sortedLayout(layout.tunes) };
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** A layout of a file content (the parsed JSON), or null for a value that is not a layout. */
export function parseLayoutFile(value: unknown, name?: string): LayoutFile | null {
  if (typeof value !== "object" || value === null) return null;
  const item = value as Record<string, unknown>;
  const tunes = item.tunes;
  if (typeof item.name !== "string" || (name !== undefined && item.name !== name)) return null;
  if (typeof tunes !== "object" || tunes === null || Array.isArray(tunes)) return null;
  const values = Object.entries(tunes as Record<string, unknown>);
  if (!values.every(([path, number]) => isLayoutPath(path) && typeof number === "number" && Number.isFinite(number))) {
    return null;
  }
  return {
    name: item.name,
    doc: typeof item.doc === "string" ? item.doc : "",
    camera: typeof item.camera === "string" ? item.camera : null,
    tunes: Object.fromEntries(values) as Record<string, number>,
  };
}

/**
 * The tune values of the page with a layout in place of its layout part. Every layout path of the page goes out, and
 * the values of the layout come in. A value equal to its default stays out, as with `withTune`.
 */
export function withLayout(
  page: Readonly<Record<string, number>>,
  layout: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
): Record<string, number> {
  const rest = Object.fromEntries(Object.entries(page).filter(([path]) => !isLayoutPath(path)));
  for (const [path, value] of Object.entries(layoutValues(layout))) {
    if (defaults.get(path) !== value) rest[path] = value;
  }
  return rest;
}

/** The tune ops that open a layout on the page: the paths that change, in sorted order (empty: the layout is open). */
export function openLayoutOps(
  page: Readonly<Record<string, number>>,
  layout: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
): TuneOp[] {
  const next = withLayout(page, layout, defaults);
  const paths = [...new Set([...Object.keys(layoutValues(page)), ...Object.keys(layoutValues(next))])].sort();
  return paths
    .filter((path) => page[path] !== next[path])
    .map((path): TuneOp => ({ kind: "tune", path, value: next[path] ?? null }));
}

/** The options of a save of a layout. */
export interface LayoutSaveArgs {
  readonly name: string;
  readonly tunes: Readonly<Record<string, number>>;
  readonly doc?: string;
  readonly camera?: string | null;
  readonly replace?: boolean;
  readonly dry?: boolean;
}

/** The command line of a save for a terminal in the repo root (the lab page alone). */
export function layoutSaveCommand(args: LayoutSaveArgs): string {
  const tunes = tuneText(sortedLayout(args.tunes));
  const doc = args.doc === undefined || args.doc === "" ? "" : ` --doc "${args.doc}"`;
  const camera = args.camera === undefined || args.camera === null ? "" : ` --view=${args.camera}`;
  const flags = `${args.replace === true ? " --replace" : ""}${args.dry === false ? "" : " --dry"}`;
  return `bun run labs layout-save ${args.name} --tunes "${tunes}"${doc}${camera}${flags}`;
}
