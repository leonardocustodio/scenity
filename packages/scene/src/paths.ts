// SPDX-License-Identifier: Apache-2.0
/**
 * Pure path helpers for the paths in the documents: the paths use `/` and are relative to the
 * folder of their document. The helpers do not use the file system.
 */

/** The folder of a path (`scenes/main.scene.json` → `scenes`; a bare name → `""`). */
export function dirname(path: string): string {
  const index = path.lastIndexOf("/");
  return index < 0 ? "" : path.slice(0, index);
}

/** The path of `relative` from the folder `base`, with `.` and `..` resolved. A `..` above the base stays. */
export function joinPath(base: string, relative: string): string {
  const parts: string[] = [];
  const absolute = base.startsWith("/");
  for (const part of `${base}/${relative}`.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === ".." && parts.length > 0 && parts[parts.length - 1] !== "..") parts.pop();
    else if (part === ".." && absolute) continue;
    else parts.push(part);
  }
  return (absolute ? "/" : "") + parts.join("/");
}

/** The path of a file that a document names, from the path of the document. */
export function resolveFrom(documentPath: string, relative: string): string {
  return joinPath(dirname(documentPath), relative);
}
