// SPDX-License-Identifier: Apache-2.0
/**
 * The files of the project for the Project window: the client of the dev server (scripts/projectFilesServer.ts), the
 * folder tree, the entries of a folder, the search words and the kind filter, and the favourites of the person (the
 * browser storage, one list for each project).
 */
import { t } from "../../texts";

/** The kinds of the entries (scripts/projectFiles.ts). */
export const FILE_KINDS = [
  "folder",
  "scene",
  "prefab",
  "material",
  "sequence",
  "rules",
  "plugin",
  "asset",
  "file",
] as const;
export type FileKind = (typeof FILE_KINDS)[number];

/** One entry of the project folder. */
export interface ProjectEntry {
  readonly path: string;
  readonly kind: FileKind;
  readonly bytes: number;
  readonly asset: string | null;
}

/** The client of the files of a project. */
export interface ProjectFilesClient {
  list(): Promise<readonly ProjectEntry[]>;
  /** A move or a rename; the reason of a refusal, or null. */
  move(from: string, to: string): Promise<string | null>;
  folder(path: string): Promise<string | null>;
  reveal(path: string): Promise<string | null>;
}

/** The header of a write of the Project window. */
const PROJECT_HEADER = "x-scenity-project";

/** The client of the dev server for the project folder `base` (`/projects/<name>/`). */
export function devServerFiles(base: string): ProjectFilesClient {
  const write = async (action: string, body: object): Promise<string | null> => {
    const answer = await fetch(`${base}project.${action}`, {
      method: "POST",
      headers: { "content-type": "application/json", [PROJECT_HEADER]: "1" },
      body: JSON.stringify(body),
    }).catch((error: unknown) => error as Error);
    if (answer instanceof Error) return answer.message;
    const value = (await answer.json().catch(() => ({}))) as { reason?: unknown };
    return answer.ok ? null : typeof value.reason === "string" ? value.reason : t("project-failed");
  };
  return {
    list: async () => {
      const answer = await fetch(`${base}project.files.json`, { cache: "no-store" });
      if (!answer.ok) throw new Error(t("project-failed"));
      return ((await answer.json()) as { files: ProjectEntry[] }).files;
    },
    move: (from, to) => write("move", { from, to }),
    folder: (path) => write("folder", { path }),
    reveal: (path) => write("reveal", { path }),
  };
}

/** The folder of a path ("" for the root). */
export function folderOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** The last part of a path. */
export function nameOf(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}

/** The folders of the tree, in their order (a folder or a plugin). */
export function folders(entries: readonly ProjectEntry[]): ProjectEntry[] {
  return entries.filter((entry) => entry.kind === "folder" || entry.kind === "plugin");
}

/** The entries of the view: the children of a folder, or with search words, each match in the folder and below it. */
export function shownEntries(
  entries: readonly ProjectEntry[],
  folder: string,
  query: string,
  kind: FileKind | null,
): ProjectEntry[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  const inside = (path: string): boolean => folder === "" || path.startsWith(`${folder}/`);
  const list = entries.filter((entry) =>
    words.length > 0
      ? inside(entry.path) && words.every((word) => entry.path.toLowerCase().includes(word))
      : folderOf(entry.path) === folder,
  );
  const kept = kind === null ? list : list.filter((entry) => entry.kind === kind);
  return [...kept].sort(
    (a, b) => Number(b.kind === "folder") - Number(a.kind === "folder") || a.path.localeCompare(b.path),
  );
}

/** The favourites of a project (the browser storage). */
export function favouritesOf(project: string): { read(): string[]; write(paths: readonly string[]): void } {
  const key = `scenity.project.favourites.${project}`;
  return {
    read: () => {
      try {
        const value = JSON.parse(localStorage.getItem(key) ?? "[]") as unknown;
        return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
      } catch {
        return [];
      }
    },
    write: (paths) => {
      try {
        localStorage.setItem(key, JSON.stringify(paths));
      } catch {
        // No storage: the favourites stay for this page only.
      }
    },
  };
}
