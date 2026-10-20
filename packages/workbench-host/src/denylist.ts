// SPDX-License-Identifier: Apache-2.0
/**
 * The denylist of the workbench: files that the workbench never shows, sends or
 * reads for the page or for Claude. The diff view, the run file route, the context packet, the file tool of a plugin,
 * the turn snapshots and the Git paths of the host all ask `isDenied` first.
 *
 * - `.env*` files at any depth (`.env`, `.env.local`, `.envrc`, also `.env.example`: a simple, tight rule);
 * - keys and certificates (`*.pem`, `*.key`, `*.p12`, `*.pfx`, `id_rsa*`, `id_ed25519*`, `id_ecdsa*`);
 * - the files of a state folder of the host (`org.scenity.editor/host/…`): the generated settings hold the launch
 *   token;
 * - the patterns of `workbench.denylist` of the project manifest (`denyPatterns`).
 */
import { isAbsolute, relative, resolve, sep } from "node:path";

/** The names of the app folder of the state folders (state.ts `APP_ID`, and the old name `OLD_APP_ID`). */
const STATE_FOLDERS = new Set(["org.scenity.editor", "org.codeblue.labs"]);

/** The base names that the workbench never shows. */
const DENIED_NAME = /^(\.env.*|.*\.(pem|key|p12|pfx)|id_(rsa|ed25519|ecdsa|dsa)(\..*)?)$/i;

/** The folders of the state folders that the host knows (state.ts adds each one at its start). */
const stateFolders = new Set<string>();

/** The patterns of the project manifest, as regular expressions over a path with `/`. */
const projectPatterns = new Map<string, RegExp>();

/**
 * Turn a glob of the manifest into a regular expression. `**` matches any folders, `*` and `?` match in one part. A
 * glob without a slash matches a part of the path (a file or folder name); a glob with a slash matches the end of the
 * path at a part border.
 */
export function globPattern(glob: string): RegExp {
  const clean = glob.replace(/^\.\//, "").replace(/\/$/, "");
  let text = "";
  for (let index = 0; index < clean.length; index += 1) {
    const char = clean[index] ?? "";
    if (char === "*" && clean[index + 1] === "*") {
      const slash = clean[index + 2] === "/";
      text += slash ? "(?:.*/)?" : ".*";
      index += slash ? 2 : 1;
    } else if (char === "*") text += "[^/]*";
    else if (char === "?") text += "[^/]";
    else text += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return clean.includes("/") ? new RegExp(`(^|/)${text}(/|$)`) : new RegExp(`^${text}$`);
}

/** Deny the paths that match the globs of `workbench.denylist` too. A second call adds to the first. */
export function denyPatterns(globs: readonly string[]): void {
  for (const glob of globs) if (!projectPatterns.has(glob)) projectPatterns.set(glob, globPattern(glob));
}

/** True when a pattern of the project matches the path. */
function projectDenied(parts: readonly string[]): boolean {
  if (projectPatterns.size === 0) return false;
  const joined = parts.join("/");
  for (const [glob, pattern] of projectPatterns) {
    if (glob.includes("/") ? pattern.test(joined) : parts.some((part) => pattern.test(part))) return true;
  }
  return false;
}

/** Add a state folder of a host: its files are denied too. */
export function denyFolder(folder: string): void {
  stateFolders.add(resolve(folder));
}

/** True when the path (relative or absolute, `/` or the system separator) is on the denylist. */
export function isDenied(path: string): boolean {
  const parts = path.split(/[\\/]+/).filter((part) => part !== "");
  if (parts.some((part) => DENIED_NAME.test(part))) return true;
  if (parts.some((part) => STATE_FOLDERS.has(part))) return true;
  if (projectDenied(parts)) return true;
  if (!isAbsolute(path)) return false;
  const full = resolve(path);
  for (const folder of stateFolders) {
    const near = relative(folder, full);
    if (near === "" || (!near.startsWith("..") && !isAbsolute(near))) return true;
  }
  return false;
}

/** The paths that are not on the denylist. */
export function allowedPaths<T extends string>(paths: readonly T[]): T[] {
  return paths.filter((path) => !isDenied(path));
}

/** The words of a line that look like paths: the text between spaces, without quotes, brackets and end marks. */
function pathWords(line: string): string[] {
  return line
    .split(/[\s,;()[\]"'`]+/)
    .map((word) => word.replace(/[.:]+$/, ""))
    .filter((word) => word.includes("/") || word.startsWith("."));
}

/** The lines that name no path of the denylist (the packet, a file tool): a line with one is left out. */
export function withoutDenied(lines: readonly string[]): string[] {
  return lines.filter((line) => !pathWords(line).some(isDenied));
}

/** Throw an error for a path of the denylist; give the path for another. */
export function checkAllowed(path: string): string {
  if (isDenied(path)) throw new Error(`The workbench does not show or send this file: ${path.split(sep).join("/")}`);
  return path;
}
