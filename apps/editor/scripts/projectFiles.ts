// SPDX-License-Identifier: Apache-2.0
/**
 * The files of a project for the Project window: the folders and the files of the project folder with their kinds
 * (scene, prefab, material, sequence, rules, plugin, asset, folder, file), a move or a rename of a file or a folder,
 * and a new folder. An asset source moves with its record (`<source>.meta.json`), so its ID stays and each reference
 * `asset:<id>` stays correct. The `rights` path of each moved record follows the move. The paths of
 * `scenity.project.json` (scenes, rules, plugins) follow a moved file or folder. No path leaves the project.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

/** The kinds of the entries of the Project window. */
export type ProjectFileKind =
  "folder" | "scene" | "prefab" | "material" | "sequence" | "rules" | "plugin" | "asset" | "file";

/** One entry of the project folder. */
export interface ProjectFile {
  /** The path in the project, with "/" between the parts. */
  readonly path: string;
  readonly kind: ProjectFileKind;
  readonly bytes: number;
  /** The asset ID of an asset source, else null. */
  readonly asset: string | null;
}

/** The folders that the window does not list (the build output, the state of the tools, the packages). */
const SKIPPED = new Set(["node_modules", ".git", ".scenity", "build", "dist"]);
/** The most entries of a listing. */
export const FILES_MAX = 5000;

const SUFFIXES: readonly (readonly [string, ProjectFileKind])[] = [
  [".scene.json", "scene"],
  [".prefab.json", "prefab"],
  [".material.json", "material"],
  [".sequence.json", "sequence"],
  [".rules.json", "rules"],
];

/** The path of a file in the project with "/", or null for a path out of the project. */
export function projectPath(dir: string, path: string): string | null {
  const full = resolve(dir, path);
  const inside = relative(dir, full);
  if (inside === "" || inside.startsWith("..") || resolve(dir, inside) !== full) return null;
  return inside.split(sep).join("/");
}

/** The asset ID of the record beside a source file, or null. */
function recordId(file: string): string | null {
  try {
    const value = JSON.parse(readFileSync(`${file}.meta.json`, "utf8")) as { id?: unknown };
    return typeof value.id === "string" ? value.id : null;
  } catch {
    return null;
  }
}

/** The kind of a file of the project. */
function fileKind(path: string, asset: string | null): ProjectFileKind {
  if (asset !== null) return "asset";
  return SUFFIXES.find(([suffix]) => path.endsWith(suffix))?.[1] ?? "file";
}

/** The folders and the files of a project, folders first, at most `FILES_MAX`. */
export function listProjectFiles(dir: string): ProjectFile[] {
  const out: ProjectFile[] = [];
  const visit = (folder: string, depth: number): void => {
    if (out.length >= FILES_MAX || depth > 12) return;
    const names = readdirSync(folder, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const item of names) {
      if (out.length >= FILES_MAX) return;
      if (item.name.startsWith(".") || item.name.endsWith(".meta.json") || SKIPPED.has(item.name)) continue;
      const full = join(folder, item.name);
      const path = relative(dir, full).split(sep).join("/");
      if (item.isDirectory()) {
        const plugin = path.startsWith("plugins/") && !path.slice("plugins/".length).includes("/");
        out.push({ path, kind: plugin ? "plugin" : "folder", bytes: 0, asset: null });
        visit(full, depth + 1);
      } else if (item.isFile()) {
        const asset = recordId(full);
        out.push({ path, kind: fileKind(path, asset), bytes: statSync(full).size, asset });
      }
    }
  };
  visit(dir, 0);
  return out;
}

/** The records (`*.meta.json`) under a path (a file: its record, a folder: each record in it). */
function recordsUnder(full: string): string[] {
  if (statSync(full).isFile()) return existsSync(`${full}.meta.json`) ? [`${full}.meta.json`] : [];
  return readdirSync(full, { withFileTypes: true, recursive: true })
    .filter((item) => item.isFile() && item.name.endsWith(".meta.json"))
    .map((item) => join(item.parentPath, item.name));
}

/** Write the `rights` path of a moved record again, relative to its new place. */
function moveRights(oldRecord: string, newRecord: string): void {
  const record = JSON.parse(readFileSync(newRecord, "utf8")) as Record<string, unknown>;
  if (typeof record.rights !== "string") return;
  const target = resolve(dirname(oldRecord), record.rights);
  const next = relative(dirname(newRecord), target).split(sep).join("/");
  if (next === record.rights) return;
  writeFileSync(newRecord, `${JSON.stringify({ ...record, rights: next }, null, 2)}\n`);
}

/** The paths of the project file that follow a move (a path that is the moved path or under it). */
function moveProjectPaths(dir: string, from: string, to: string): void {
  const file = join(dir, "scenity.project.json");
  if (!existsSync(file)) return;
  const project = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
  const follow = (path: unknown): unknown =>
    typeof path !== "string"
      ? path
      : path === from
        ? to
        : path.startsWith(`${from}/`)
          ? `${to}${path.slice(from.length)}`
          : path;
  let changed = false;
  for (const key of ["scenes", "rules", "plugins", "sequences"]) {
    const list = project[key];
    if (!Array.isArray(list)) continue;
    const next = list.map(follow);
    if (next.some((item, index) => item !== list[index])) {
      project[key] = next;
      changed = true;
    }
  }
  if (changed) writeFileSync(file, `${JSON.stringify(project, null, 2)}\n`);
}

/** Move (or rename) a file or a folder of the project. Gives the reason of a refusal, or null. */
export function moveProjectFile(dir: string, from: string, to: string): string | null {
  const source = projectPath(dir, from);
  const target = projectPath(dir, to);
  if (source === null || target === null) return "A path leaves the project.";
  if (source === target) return null;
  const full = join(dir, source);
  const next = join(dir, target);
  if (!existsSync(full)) return `No file ${source} in the project.`;
  if (existsSync(next)) return `${target} is there already.`;
  if (target.startsWith(`${source}/`)) return "A folder cannot go into itself.";
  const records = recordsUnder(full).map((record) => ({ old: record, next: join(next, relative(full, record)) }));
  mkdirSync(dirname(next), { recursive: true });
  renameSync(full, next);
  // A file has its record beside it (a folder moves its records with it).
  if (statSync(next).isFile() && existsSync(`${full}.meta.json`)) renameSync(`${full}.meta.json`, `${next}.meta.json`);
  for (const record of records) {
    const moved = statSync(next).isFile() ? `${next}.meta.json` : record.next;
    if (existsSync(moved)) moveRights(record.old, moved);
  }
  moveProjectPaths(dir, source, target);
  return null;
}

/** Make a new folder of the project. Gives the reason of a refusal, or null. */
export function makeProjectFolder(dir: string, path: string): string | null {
  const target = projectPath(dir, path);
  if (target === null) return "A path leaves the project.";
  if (existsSync(join(dir, target))) return `${target} is there already.`;
  mkdirSync(join(dir, target), { recursive: true });
  return null;
}
