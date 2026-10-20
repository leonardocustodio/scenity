// SPDX-License-Identifier: Apache-2.0
/**
 * The markers face of a project plugin: the `scenity.markers` field of the package.json of the plugin, else the first
 * file of `MARKER_FILES` that exists. The default export of the face is `{ markers?, modules? }`:
 *
 *     export default {
 *       markers: [{ id: "acme.metric", what: "a motion metric", text: "acme.metric" }],
 *       modules: [{ id: "acme-dev", what: "the dev part of acme", pattern: "/plugins/acme/dev/" }],
 *     };
 *
 * A marker has `text` (a quoted string in the script) or `pattern` (a RegExp or its source), and a `kind` (`lab`
 * by default, `dev` or `info`). A module marker has a `pattern` of a module path with "/".
 */
import { existsSync, readFileSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import type { ProjectPlugin } from "../vite/resolve";
import { quoted, type Marker, type MarkerKind, type MarkerSet, type ModuleMarker } from "./markers";

/** The files of a plugin folder that can hold the markers face, in the order of the search. */
export const MARKER_FILES = ["markers.ts", "src/markers.ts", "markers.js", "src/markers.js"];

const KINDS: ReadonlySet<string> = new Set<MarkerKind>(["lab", "dev", "info"]);

function isFile(path: string): boolean {
  return existsSync(path) && statSync(path).isFile();
}

/** The markers face of a plugin folder, or undefined when the folder has none. */
export function markersFace(dir: string): string | undefined {
  const manifest = join(dir, "package.json");
  if (isFile(manifest)) {
    const data = JSON.parse(readFileSync(manifest, "utf8")) as { scenity?: { markers?: unknown } };
    const field = data.scenity?.markers;
    if (typeof field === "string") {
      const path = resolve(dir, field);
      if (!isFile(path)) throw new Error(`${manifest}: the markers face "${field}" does not exist`);
      return path;
    }
  }
  return MARKER_FILES.map((file) => join(dir, file)).find(isFile);
}

function asPattern(value: unknown, where: string): RegExp {
  if (value instanceof RegExp) return value;
  if (typeof value === "string" && value !== "") return new RegExp(value);
  throw new Error(`${where}: a pattern is a RegExp or its source text`);
}

function asText(value: unknown, where: string): string {
  if (typeof value === "string" && value !== "") return value;
  throw new Error(`${where} needs a text`);
}

/** One marker of a face. */
function readMarker(item: unknown, where: string): Marker {
  const value = (item ?? {}) as Record<string, unknown>;
  const id = asText(value.id, `${where}: id`);
  const kind = value.kind ?? "lab";
  if (typeof kind !== "string" || !KINDS.has(kind)) throw new Error(`${where}: the kind is lab, dev or info`);
  const pattern =
    value.text !== undefined ? quoted(asText(value.text, `${where}: text`)) : asPattern(value.pattern, where);
  return { id, kind: kind as MarkerKind, what: asText(value.what, `${where}: what`), pattern };
}

/** One module marker of a face. */
function readModule(item: unknown, where: string): ModuleMarker {
  const value = (item ?? {}) as Record<string, unknown>;
  return {
    id: asText(value.id, `${where}: id`),
    what: asText(value.what, `${where}: what`),
    pattern: asPattern(value.pattern, where),
  };
}

/** Check the default export of a markers face. */
export function readMarkerFace(value: unknown, file: string): MarkerSet {
  const face = (value ?? {}) as { markers?: unknown; modules?: unknown };
  const list = (field: unknown, name: string): unknown[] => {
    if (field === undefined) return [];
    if (!Array.isArray(field)) throw new Error(`${file}: "${name}" is an array`);
    return field as unknown[];
  };
  return {
    markers: list(face.markers, "markers").map((item, index) => readMarker(item, `${file}: markers/${String(index)}`)),
    modules: list(face.modules, "modules").map((item, index) => readModule(item, `${file}: modules/${String(index)}`)),
  };
}

/** The markers of the plugins of a project: the markers face of each plugin that has one. */
export async function pluginMarkers(plugins: readonly ProjectPlugin[]): Promise<MarkerSet> {
  const sets: MarkerSet[] = [];
  for (const plugin of plugins) {
    const file = markersFace(plugin.dir);
    if (file === undefined) continue;
    const module = (await import(pathToFileURL(file).href)) as { default?: unknown };
    sets.push(readMarkerFace(module.default, file));
  }
  return { markers: sets.flatMap((set) => set.markers), modules: sets.flatMap((set) => set.modules) };
}
