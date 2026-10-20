// SPDX-License-Identifier: Apache-2.0
/**
 * Write a layout of the room into apps/editor/src/core/layouts/<name>.json:
 * `bun run labs layout-save <name> --tunes "<path:value,…>" [--doc "<text>"] [--view <camera or view>] [--replace]
 * [--dry]`. The tune text holds the layout values: the prop places (`room.props.<slot>.at.*`, `.yaw`) and the cable
 * bends (`routes.*`). `--tunes` can occur more than once (the parts join). `--view` keeps the camera of the save (a
 * camera name or `x,y,z,tx,ty,tz,fov`) as a note of the file. The file text is the result of `layoutFileText` of the lab
 * (src/core/editor/layoutFiles.ts), so the lab and the tool write the same bytes. An existing name is refused unless
 * `--replace`. The dry run prints the file that it writes and writes nothing, as `labs camera-save --dry` does.
 *
 * A layout is a lab tool only: the game never reads the folder. `labs list` lists the layouts.
 *
 * The functions are pure apart from `layoutSaveRun` and `layoutNames`, which read and write the folder (a test gives
 * a temporary folder).
 */
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { parseTunes } from "@scenity/runtime-dev";
import {
  layoutDocProblem,
  layoutFileText,
  layoutNameProblem,
  layoutTuneProblems,
  LAYOUTS_FOLDER,
} from "../../src/core/editor/layoutFiles";

/** The options of the command line of `labs layout-save`. */
export interface LayoutSaveOptions {
  readonly name: string | undefined;
  /** The `--tunes` texts (one or more parts of one tune text). */
  readonly tunes: readonly string[] | undefined;
  readonly doc: string | undefined;
  /** The camera of the save (`--view`): a camera name or a view text, or undefined. */
  readonly view: string | undefined;
  readonly replace: boolean;
  readonly dry: boolean;
}

/** A camera note: a camera name, or seven numbers (the host checks the same rule). */
const CAMERA_NOTE = /^(?:[a-z][a-z0-9]*(?:-[a-z0-9]+)*|-?\d+(?:\.\d+)?(?:,-?\d+(?:\.\d+)?){6})$/;

/** The names of the saved layouts of a folder, in the order of their names (none for a missing folder). */
export function layoutNames(folder: string): string[] {
  if (!existsSync(folder)) return [];
  return readdirSync(folder)
    .filter((file) => file.endsWith(".json"))
    .map((file) => file.replace(/\.json$/, ""))
    .sort();
}

/** The line of `labs list` for the saved layouts. */
export function layoutListLine(names: readonly string[]): string {
  return `layouts: ${names.length === 0 ? "none (labs layout-save writes one)" : names.join(", ")}`;
}

/** The tune values of the `--tunes` parts, or the problems of a pair that is not `path:number`. */
function tunesOf(parts: readonly string[]): { values: Record<string, number>; problems: string[] } {
  const text = parts.filter((part) => part !== "").join(",");
  const values = parseTunes(text);
  const pairs = text === "" ? [] : text.split(",");
  const problems = pairs.length === Object.keys(values).length ? [] : ["each pair of --tunes is path:number"];
  return { values, problems };
}

/**
 * The run of `labs layout-save` on a folder: the lines of its output (the file text, then the summary), or the error.
 * `known` tells if a path is a tuned number (absent: every layout path passes). The dry run writes nothing.
 */
export function layoutSaveRun(
  folder: string,
  options: LayoutSaveOptions,
  known?: (path: string) => boolean,
): { readonly out: string[]; readonly error: string | null } {
  const name = options.name ?? "";
  const usage = 'give the name: layout-save <name> --tunes "path:value,…" [--doc "…"] [--view <camera>]';
  if (name === "") return { out: [], error: usage };
  const doc = options.doc ?? "";
  const camera = options.view ?? null;
  const { values, problems } = tunesOf(options.tunes ?? []);
  const problem =
    layoutNameProblem(name) ??
    layoutDocProblem(doc) ??
    (camera !== null && !CAMERA_NOTE.test(camera) ? "--view is a camera name or x,y,z,tx,ty,tz,fov" : null) ??
    [...problems, ...layoutTuneProblems(values, known)].at(0) ??
    null;
  if (problem !== null) return { out: [], error: problem };
  const file = join(folder, `${name}.json`);
  const replaced = existsSync(file);
  if (replaced && !options.replace) {
    return {
      out: [],
      error: `the layout "${name}" exists (${LAYOUTS_FOLDER}/${name}.json): give another name, or --replace`,
    };
  }
  const text = layoutFileText({ name, doc, camera, tunes: values });
  const shown = `${LAYOUTS_FOLDER}/${name}.json`;
  const out = text
    .trimEnd()
    .split("\n")
    .map((line, index) => `${shown}:${String(index + 1)}  + ${line}`);
  const what = `layout "${name}" ${replaced ? "replaced" : "added"} (${String(Object.keys(values).length)} values)`;
  if (options.dry) {
    out.push(`dry run: ${what}; nothing written`);
    return { out, error: null };
  }
  mkdirSync(folder, { recursive: true });
  writeFileSync(file, text);
  out.push(`${what} in ${shown}`, `labs list lists it; layout.variant.open {name: "${name}"} opens it after a reload`);
  return { out, error: null };
}
