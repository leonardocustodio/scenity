// SPDX-License-Identifier: Apache-2.0
/**
 * The parts of the content hash: a finer invalidation of the frame index per module, only where a test proves it.
 * The content hash (contentHash.ts) stays one hash of all the content files. This module divides the files into two
 * kinds of parts:
 *
 * - the shared part: every file that the module cannot prove. An edit of a shared file makes every take stale (the
 *   fallback).
 * - the family parts: a file of the folder of the pose families that only the family registry (an object of pose
 *   functions in the `index.ts` of the folder) reaches. Its part is the set of families whose pose function reaches it
 *   through imports. The code of such a file runs only in a call of `registry[family]`.
 *
 * A plugin gives the folder and the name of the registry object (`FamilyConfig`, a field of the content config of its
 * frame index source). A project with no family config has no family parts: each file is shared.
 *
 * The renderer of the plugin records the families that it calls for each frame (`reads`). A frame
 * keeps its picture over an edit when every changed file is in a family part and no family of those parts is in the
 * reads of the frame (`carries`). Thus an edit of a family that a frame does not call keeps the frame, but an edit of a
 * file that the core imports (a shared file) makes it stale.
 *
 * The rules of a family file (else it is shared):
 * - no file outside the families folder imports it, directly or through other files (the registry does not count);
 * - its top-level statements are declarations only (no call or assignment as a statement);
 * - each `tunable` key of it is a literal that no other file registers;
 * - it has no dynamic import and no glob import.
 *
 * A limit of the rule: the initial value of a top-level declaration can call a function. The rule accepts that such a
 * call changes only the value that it gives (as `tunable` does, under a key of its own).
 *
 * Every family part is off (each file shared) when the registry has another form than this module reads, when a file
 * reads an entry of the registry object out of the registry (the trace of the renderer would not see the call), or
 * when a file has a dynamic import that this module cannot follow. contentParts.test.ts proves the rule on small
 * trees.
 *
 * The module is pure (no `node:`, `bun:` or DOM import).
 */

/** The pose families of a plugin, relative to the root of the content hash. */
export interface FamilyConfig {
  /** The folder of the family files, with a final `/`. */
  readonly dir: string;
  /** The name of the registry object in the `index.ts` of the folder. */
  readonly registryName: string;
}

/** The family registry of a config: the only file outside a family part that may import the files of a family part. */
export function familyRegistry(families: FamilyConfig): string {
  return `${families.dir}index.ts`;
}

/** What the scan of one source file finds. */
export interface FileScan {
  /** The module specifiers of the static imports, the re-exports and the literal dynamic imports. */
  readonly imports: readonly string[];
  /** The literal keys of the `tunable` calls. */
  readonly tunables: readonly string[];
  /** A `tunable` call without a literal key. */
  readonly dynamicTunable: boolean;
  /** The literal patterns of the glob imports (`import.meta.glob`). */
  readonly globs: readonly string[];
  /** A dynamic import or a glob import without a literal, or a `require` call. */
  readonly dynamicImport: boolean;
  /** A top-level statement that is not a declaration (a call or an assignment). */
  readonly topLevelEffect: boolean;
  /** The file reads an entry of the registry object out of the registry (a member access, a copy of the values). */
  readonly readsRegistryEntry: boolean;
}

/** The `from "x"` of an import or a re-export, `import "x"` and `import("x")`. Comments can add specifiers (safe). */
const IMPORT_FORMS = [/\bfrom\s*["']([^"'\n]+)["']/g, /\bimport\s*\(?\s*["']([^"'\n]+)["']/g];
const DYNAMIC_FORMS = [
  /\bimport\s*\(\s*[^"'\s)]/,
  /\brequire\s*\(/,
  /\bimport\.meta\.glob\s*(<[^>]*>)?\s*\(\s*[^"'\s]/,
];
const GLOB = /\bimport\.meta\.glob\s*(?:<[^>]*>)?\s*\(\s*["']([^"'\n]+)["']/g;
const TUNABLE = /\btunable\s*\(\s*(["'`]?)([^"'`,)\n]*)\1/g;
/** The forms that read an entry of the registry object `name` (a member access, a copy of the values). */
function registryEntryForms(name: string): RegExp[] {
  return [
    new RegExp(`\\b${name}\\s*\\??\\.\\s*[A-Za-z_$]`),
    new RegExp(`\\}\\s*=\\s*${name}\\b`),
    new RegExp(`\\bObject\\.(values|entries)\\s*\\(\\s*${name}\\b`),
    new RegExp(`\\.\\.\\.\\s*${name}\\b`),
  ];
}
/** The starts of a top-level line that are not a statement with an effect. */
const DECLARATION =
  /^(import|export|const|let|var|function|async\s+function|type|interface|class|abstract\s+class|enum|declare)\b|^(\}|\)|\]|$)/;

/**
 * The text without its comments, for the scans that a comment must not change. The imports use the full text,
 * because a comment can only add an import, which is safe. A string with `//` or `/*` in it can remove more text.
 * Then the scans find less code, and the scan can miss a dynamic import of that file.
 */
export function withoutComments(text: string): string {
  return text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");
}

/** Scan the text of a source file. `registryName` is the name of the registry object, or null for none. */
export function scanSource(text: string, registryName: string | null = null): FileScan {
  const imports: string[] = [];
  for (const form of IMPORT_FORMS) for (const match of text.matchAll(form)) if (match[1]) imports.push(match[1]);
  const code = withoutComments(text);
  const tunables: string[] = [];
  let dynamicTunable = false;
  for (const match of code.matchAll(TUNABLE)) {
    const quote = match[1] ?? "";
    const key = match[2] ?? "";
    if (quote === "" || quote === "`" || key === "") dynamicTunable = true;
    else tunables.push(key);
  }
  const globs = [...code.matchAll(GLOB)].map((match) => match[1] ?? "");
  // Prettier puts each top-level statement at the start of a line and indents the lines inside it.
  const topLevelEffect = code.split("\n").some((line) => !/^\s/.test(line) && !DECLARATION.test(line));
  return {
    imports,
    tunables,
    dynamicTunable,
    globs,
    dynamicImport: DYNAMIC_FORMS.some((form) => form.test(code)),
    topLevelEffect,
    readsRegistryEntry: registryName !== null && registryEntryForms(registryName).some((form) => form.test(code)),
  };
}

function normalize(path: string): string {
  const out: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") out.pop();
    else out.push(part);
  }
  return out.join("/");
}

function dirOf(path: string): string {
  const at = path.lastIndexOf("/");
  return at < 0 ? "" : path.slice(0, at);
}

/** The folder of a relative glob pattern up to its first wild part (with a final `/`), or null for another pattern. */
export function globFolder(from: string, pattern: string): string | null {
  if (!pattern.startsWith(".")) return null;
  const fixed = pattern.split("/");
  const at = fixed.findIndex((part) => /[*?[{]/.test(part));
  const folder = normalize(`${dirOf(from)}/${(at < 0 ? fixed.slice(0, -1) : fixed.slice(0, at)).join("/")}`);
  return `${folder}/`;
}

/** The content file of a relative specifier of `from`, or null (a package, or a file that is not a content file). */
export function resolveImport(from: string, spec: string, files: ReadonlySet<string>): string | null {
  if (!spec.startsWith(".")) return null;
  const base = normalize(`${dirOf(from)}/${spec.split("?")[0] ?? ""}`);
  const stem = base.endsWith(".js") ? base.slice(0, -3) : base;
  for (const path of [base, `${stem}.ts`, `${base}.ts`, `${base}.vue`, `${base}.json`, `${base}/index.ts`]) {
    if (files.has(path)) return path;
  }
  return null;
}

/** The entries of the registry: each family and the modules of its pose function; null for another form. */
export function registryRoots(
  text: string,
  files: ReadonlySet<string>,
  families: FamilyConfig,
): Map<string, string[]> | null {
  // The registry exports only the registry object (and types).
  for (const match of text.matchAll(/^export\s+(\S+)\s*([A-Za-z_$][\w$]*)?/gm)) {
    const [, word = "", name = ""] = match;
    if (word === "type" || word === "interface") continue;
    if (word === "const" && name === families.registryName) continue;
    return null;
  }
  const names = new Map<string, string>();
  for (const match of text.matchAll(/^import\s+(type\s+)?\{([^}]*)\}\s*from\s*["']([^"']+)["'];?$/gm)) {
    if (match[1] !== undefined) continue;
    const module = resolveImport(familyRegistry(families), match[3] ?? "", files);
    if (module === null) return null;
    for (const item of (match[2] ?? "").split(",")) {
      const parts = item.trim().split(/\s+as\s+/);
      const local = (parts[1] ?? parts[0] ?? "").trim();
      if (local.startsWith("type ") || local === "") continue;
      names.set(local, module);
    }
  }
  const block = new RegExp(`export const ${families.registryName}\\b[^=]*=\\s*\\{([\\s\\S]*?)\\n\\};`).exec(text)?.[1];
  if (block === undefined) return null;
  const roots = new Map<string, string[]>();
  for (const line of block.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || trimmed.startsWith("//")) continue;
    const entry = /^([a-z][a-z0-9_]*)\s*:\s*(.+?),?$/.exec(trimmed);
    if (entry === null) return null;
    const modules: string[] = [];
    for (const name of (entry[2] ?? "").match(/[A-Za-z_$][\w$]*/g) ?? []) {
      const module = names.get(name);
      if (module === undefined) return null;
      modules.push(module);
    }
    if (modules.length === 0) return null;
    roots.set(entry[1] ?? "", modules);
  }
  return roots.size === 0 ? null : roots;
}

/** One content file: its path (relative to the repo root) and its scan; null for a file that is not source. */
export interface ScannedFile {
  readonly path: string;
  readonly scan: FileScan | null;
}

function isFamilyFile(path: string, config: FamilyConfig): boolean {
  const { dir } = config;
  return path.startsWith(dir) && path !== familyRegistry(config) && !path.slice(dir.length).includes("/");
}

/**
 * The family parts of the content files: each family file with the families of its part. A file that is not in the
 * map is shared. The map is empty when the rules of the module do not hold for the tree (see the head comment), and
 * with no family config.
 */
export function familyParts(
  files: readonly ScannedFile[],
  registryText: string | null,
  config: FamilyConfig | null,
): ReadonlyMap<string, readonly string[]> {
  const paths = new Set(files.map((file) => file.path));
  const none = new Map<string, readonly string[]>();
  if (registryText === null || config === null) return none;
  const { dir } = config;
  const registry = familyRegistry(config);
  // The last name of the folder, as a package specifier can name it ("/families" for ".../model/families/").
  const folderName = `/${
    dir
      .split("/")
      .filter((part) => part !== "")
      .pop() ?? ""
  }`;
  const roots = registryRoots(registryText, paths, config);
  if (roots === null) return none;
  const edges = new Map<string, string[]>();
  const tuneUse = new Map<string, number>();
  let dynamicTunable = false;
  for (const file of files) {
    if (file.scan === null) continue;
    if (file.scan.dynamicImport) return none;
    // A glob import that can name a file of the families folder: the scan cannot follow it.
    for (const glob of file.scan.globs) {
      const folder = globFolder(file.path, glob);
      if (folder === null || dir.startsWith(folder) || folder.startsWith(dir)) return none;
    }
    if (file.path !== registry && file.scan.readsRegistryEntry) return none;
    // A package specifier can name a file of the families folder only through an export of the runtime: none does.
    if (file.scan.imports.some((spec) => !spec.startsWith(".") && spec.includes(folderName))) return none;
    const out: string[] = [];
    for (const spec of file.scan.imports) {
      const target = resolveImport(file.path, spec, paths);
      if (target !== null) out.push(target);
    }
    edges.set(file.path, out);
    for (const key of file.scan.tunables) tuneUse.set(key, (tuneUse.get(key) ?? 0) + 1);
    dynamicTunable ||= file.scan.dynamicTunable;
  }
  const reach = (starts: readonly string[]): Set<string> => {
    const seen = new Set<string>();
    const stack = [...starts];
    while (stack.length > 0) {
      const path = stack.pop() ?? "";
      if (seen.has(path)) continue;
      seen.add(path);
      // The registry is the gate of the family parts: its imports are the roots of the families.
      if (path === registry) continue;
      for (const target of edges.get(path) ?? []) stack.push(target);
    }
    return seen;
  };
  const shared = reach(files.map((file) => file.path).filter((path) => !path.startsWith(dir)));
  const owners = new Map<string, string[]>();
  for (const [family, modules] of roots) {
    for (const path of reach(modules)) {
      if (!isFamilyFile(path, config) || shared.has(path)) continue;
      const list = owners.get(path) ?? [];
      list.push(family);
      owners.set(path, list);
    }
  }
  const scans = new Map(files.map((file) => [file.path, file.scan]));
  const parts = new Map<string, readonly string[]>();
  for (const [path, families] of owners) {
    const scan = scans.get(path);
    if (scan === null || scan === undefined || scan.topLevelEffect || scan.dynamicTunable) continue;
    if (scan.tunables.length > 0 && dynamicTunable) continue;
    if (scan.tunables.some((key) => (tuneUse.get(key) ?? 0) > 1)) continue;
    parts.set(path, [...new Set(families)].sort());
  }
  return parts;
}

/** The content files of one content hash: the digest of each file and the family parts. */
export interface ContentSnapshot {
  readonly hash: string;
  readonly digests: ReadonlyMap<string, string>;
  readonly parts: ReadonlyMap<string, readonly string[]>;
}

/**
 * The families whose code differs between two snapshots, or null when a shared file differs (every frame is stale).
 * A file that one snapshot has and the other has not differs too.
 */
export function changedFamilies(from: ContentSnapshot, to: ContentSnapshot): ReadonlySet<string> | null {
  const families = new Set<string>();
  const paths = new Set([...from.digests.keys(), ...to.digests.keys()]);
  for (const path of paths) {
    const before = from.digests.get(path);
    const after = to.digests.get(path);
    if (before === after) continue;
    const sides: (readonly string[] | undefined)[] = [];
    if (before !== undefined) sides.push(from.parts.get(path));
    if (after !== undefined) sides.push(to.parts.get(path));
    for (const side of sides) {
      if (side === undefined) return null;
      for (const family of side) families.add(family);
    }
  }
  return families;
}

/**
 * True when a frame of `from` is also the frame of `to`: the frame has its reads, and the families that differ are not
 * in them. Null reads (a frame of an older renderer or of a tool) never carry.
 */
export function carries(reads: readonly string[] | null | undefined, changed: ReadonlySet<string> | null): boolean {
  if (changed === null || reads === null || reads === undefined) return false;
  return reads.every((family) => !changed.has(family));
}
