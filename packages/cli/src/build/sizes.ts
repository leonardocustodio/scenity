// SPDX-License-Identifier: Apache-2.0
/**
 * The size budgets of the entries of a build. `scenity build` measures the player entries with it, and
 * `tools/size-budget.ts` measures the worker and core entries of the 3D room.
 *
 * The module reads the import graph from the files of a build folder (a build has no Vite manifest):
 *
 * - static edges: `import … from "./x.js"`, `import "./x.js"`, `export … from "./x.js"`;
 * - lazy edges: `import("./x.js")`, the file lists of `__vite__mapDeps` ("assets/x.js") and
 *   `new URL("x.js", import.meta.url)` (workers).
 *
 * A measure is the gzip size of each file with level 9 (as the size-limit tool does), with the level-1 size and the
 * raw bytes as information. A precompressed copy (`<file>.br`, `<file>.gz`) is not a file of the build: the module
 * checks that each copy is the compressed form of its file.
 *
 * An exception gives a budget a higher allowance with a reason and the record that approves it. A measure above its
 * limit passes only at or below the allowance. An exception for a measure at or below its limit is stale, and a stale
 * exception is a problem.
 */
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, posix, relative } from "node:path";
import { brotliDecompressSync, gunzipSync, gzipSync } from "node:zlib";

/** One kibibyte. The budgets are in KB; 1 KB = 1,024 bytes. */
export const KB = 1024;

/** A file of the build: its path relative to the build folder (for example "assets/index-abc.js"). */
export interface BuiltFile {
  readonly path: string;
  readonly bytes: number;
  readonly gzip9: number;
  readonly gzip1: number;
  /** The bytes of the precompressed copies `<file>.br` and `<file>.gz`, or null without a copy. */
  readonly br: number | null;
  readonly gz: number | null;
}

/** The suffixes of the precompressed copies and the function that decodes each copy. */
const COPIES: readonly { readonly suffix: string; readonly name: string; readonly decode: (data: Buffer) => Buffer }[] =
  [
    { suffix: ".br", name: "Brotli", decode: (data) => brotliDecompressSync(data) },
    { suffix: ".gz", name: "gzip", decode: (data) => gunzipSync(data) },
  ];

/** Return true for a precompressed copy (`<file>.br`, `<file>.gz`). */
export function isCopy(path: string): boolean {
  return COPIES.some((copy) => path.endsWith(copy.suffix));
}

export interface Edges {
  readonly static: readonly string[];
  readonly lazy: readonly string[];
}

// Rolldown writes static imports with double quotes and other strings with back ticks.
const STATIC_IMPORT = /(?:\bfrom|\bimport)\s*["']([^"'`]+?\.(?:js|mjs|css))["']/g;
const DYNAMIC_IMPORT = /\bimport\(\s*["'`]([^"'`]+?\.(?:js|mjs))["'`]\s*\)/g;
const MAP_DEPS = /__vite__mapDeps=\([^)]*?m\.f=\[([^\]]*)\]/g;
const QUOTED = /["'`]([^"'`]+?\.(?:js|mjs|css))["'`]/g;
const WORKER_URL = /new URL\(\s*["'`]([^"'`]+?\.(?:js|mjs))["'`]\s*,\s*import\.meta\.url\s*\)/g;
/** An absolute asset path in a string: workers and worklets ("/assets/entry-x.js"). */
const ASSET_PATH = /["'`](\/assets\/[^"'`]+?\.(?:js|mjs))["'`]/g;

/** Resolve an import specifier of a chunk to a path of the build. Bare specifiers give null. */
export function resolveSpecifier(from: string, specifier: string): string | null {
  if (specifier.startsWith("/")) {
    return specifier.slice(1);
  }
  if (specifier.startsWith("./") || specifier.startsWith("../")) {
    return posix.normalize(posix.join(posix.dirname(from), specifier));
  }
  // The file lists of __vite__mapDeps are relative to the base: "assets/x.js".
  if (specifier.startsWith("assets/")) {
    return specifier;
  }
  return null;
}

/** Read the static and lazy edges of one chunk. */
export function parseEdges(from: string, source: string): Edges {
  const lazySpecifiers = new Set<string>();
  for (const match of source.matchAll(DYNAMIC_IMPORT)) {
    lazySpecifiers.add(match[1] ?? "");
  }
  for (const match of source.matchAll(MAP_DEPS)) {
    for (const item of (match[1] ?? "").matchAll(QUOTED)) {
      lazySpecifiers.add(item[1] ?? "");
    }
  }
  for (const match of source.matchAll(WORKER_URL)) {
    const specifier = match[1] ?? "";
    lazySpecifiers.add(/^[./]/.test(specifier) ? specifier : `./${specifier}`);
  }
  for (const match of source.matchAll(ASSET_PATH)) {
    lazySpecifiers.add(match[1] ?? "");
  }
  const staticPaths = new Set<string>();
  for (const match of source.matchAll(STATIC_IMPORT)) {
    const path = resolveSpecifier(from, match[1] ?? "");
    if (path !== null) staticPaths.add(path);
  }
  const lazyPaths = new Set<string>();
  for (const specifier of lazySpecifiers) {
    const path = resolveSpecifier(from, specifier);
    if (path !== null && !staticPaths.has(path)) lazyPaths.add(path);
  }
  return { static: [...staticPaths].sort(), lazy: [...lazyPaths].sort() };
}

/** Every file below a build folder, with its sizes, without the source maps and the precompressed copies. */
export function readBuild(dist: string): Map<string, BuiltFile> {
  const files = new Map<string, BuiltFile>();
  const copySize = (full: string): number | null => (existsSync(full) ? statSync(full).size : null);
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (!name.endsWith(".map") && !isCopy(name)) {
        const data = readFileSync(full);
        const path = relative(dist, full).split("\\").join("/");
        files.set(path, {
          path,
          bytes: data.byteLength,
          gzip9: gzipSync(data, { level: 9 }).byteLength,
          gzip1: gzipSync(data, { level: 1 }).byteLength,
          br: copySize(`${full}.br`),
          gz: copySize(`${full}.gz`),
        });
      }
    }
  };
  walk(dist);
  return files;
}

/**
 * Check the precompressed copies below a build folder. A copy without its file, or a copy that does not decompress to
 * the bytes of its file, is stale: the server would send old bytes. Return one problem for each stale copy.
 */
export function checkCopies(dist: string): string[] {
  const problems: string[] = [];
  const walk = (folder: string): void => {
    for (const name of readdirSync(folder).sort()) {
      const full = join(folder, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      const copy = COPIES.find((item) => name.endsWith(item.suffix));
      if (copy === undefined) continue;
      const path = relative(dist, full).split("\\").join("/");
      const source = full.slice(0, -copy.suffix.length);
      if (!existsSync(source)) {
        problems.push(`${path} has no file of its own (a stale copy)`);
        continue;
      }
      let same: boolean;
      try {
        same = copy.decode(readFileSync(full)).equals(readFileSync(source));
      } catch {
        same = false;
      }
      if (!same) problems.push(`${path} is not the ${copy.name} form of its file (a stale copy)`);
    }
  };
  walk(dist);
  return problems;
}

/**
 * The closure of a set of files. `lazy` true follows the lazy edges too. The closure does not go into the files of
 * `stop` (for example the shell of a page). Files that the build does not have are in `missing`.
 */
export function closure(
  starts: readonly string[],
  edgesOf: (path: string) => Edges | null,
  lazy = false,
  stop: ReadonlySet<string> = new Set(),
): { readonly files: Set<string>; readonly missing: Set<string> } {
  const files = new Set<string>();
  const missing = new Set<string>();
  const queue = [...starts];
  while (queue.length > 0) {
    const path = queue.pop() ?? "";
    if (files.has(path) || missing.has(path) || stop.has(path)) continue;
    const edges = edgesOf(path);
    if (edges === null) {
      missing.add(path);
      continue;
    }
    files.add(path);
    queue.push(...edges.static, ...(lazy ? edges.lazy : []));
  }
  return { files, missing };
}

/** The file of a named chunk: "assets/<name>-<hash>.js", or null. */
export function findChunk(files: Iterable<string>, name: string): string | null {
  const pattern = new RegExp(`^assets/${name}-[A-Za-z0-9_-]+\\.js$`);
  for (const path of files) {
    if (pattern.test(path)) return path;
  }
  return null;
}

/** The import graph of a build folder: the edges of each file, read once. */
export function edgeReader(dist: string, build: ReadonlyMap<string, BuiltFile>): (path: string) => Edges | null {
  const cache = new Map<string, Edges>();
  return (path) => {
    if (!build.has(path)) return null;
    const cached = cache.get(path);
    if (cached !== undefined) return cached;
    const edges = /\.(js|mjs)$/.test(path)
      ? parseEdges(path, readFileSync(join(dist, path), "utf8"))
      : { static: [], lazy: [] };
    cache.set(path, edges);
    return edges;
  };
}

/** The sums of a group of files. `br`: the Brotli copy of each file, else its gzip-9 size. */
export interface GroupSize {
  readonly gzip9: number;
  readonly gzip1: number;
  readonly raw: number;
  readonly files: number;
  readonly br: number;
}

/** The sums of the given files of a build. A file that the build does not have counts as zero. */
export function sumFiles(files: Iterable<string>, build: ReadonlyMap<string, BuiltFile>): GroupSize {
  let gzip9 = 0;
  let gzip1 = 0;
  let raw = 0;
  let br = 0;
  let count = 0;
  for (const path of files) {
    const file = build.get(path);
    if (file === undefined) continue;
    gzip9 += file.gzip9;
    gzip1 += file.gzip1;
    raw += file.bytes;
    br += file.br ?? file.gzip9;
    count += 1;
  }
  return { gzip9, gzip1, raw, files: count, br };
}

/** The budget of one entry: a limit of the gzip-9 bytes of its file group. */
export interface EntryBudget {
  readonly id: string;
  readonly label: string;
  readonly limitBytes: number;
}

/** An approved exception to one budget. */
export interface BudgetException {
  readonly budget: string;
  /** The allowance in KB (gzip level 9). */
  readonly allowKB: number;
  readonly reason: string;
  /** The record that approves the exception, relative to the repo root. */
  readonly record: string;
}

export type MeasureResult = "ok" | "exception" | "exceeded";

/** The measure of one entry against its budget. */
export interface EntryMeasure {
  readonly id: string;
  readonly label: string;
  readonly limitBytes: number;
  readonly gzip9: number;
  readonly gzip1: number;
  readonly raw: number;
  readonly files: readonly string[];
  readonly result: MeasureResult;
  /** The allowance of an exception, or null. */
  readonly allowBytes: number | null;
  readonly ok: boolean;
}

/** Read an exception file (`{ "entries": [...] }`). A missing file gives no exception. `ids` are the budget IDs. */
export function readExceptions(path: string, ids: readonly string[]): BudgetException[] {
  if (!existsSync(path)) return [];
  const document = JSON.parse(readFileSync(path, "utf8")) as { entries?: unknown };
  if (!Array.isArray(document.entries)) {
    throw new Error(`${path}: "entries" must be an array`);
  }
  return document.entries.map((entry: unknown, index: number) => {
    const item = entry as Partial<BudgetException>;
    if (
      typeof item.budget !== "string" ||
      !ids.includes(item.budget) ||
      typeof item.allowKB !== "number" ||
      !(item.allowKB > 0) ||
      typeof item.reason !== "string" ||
      item.reason.trim() === "" ||
      typeof item.record !== "string" ||
      item.record.trim() === ""
    ) {
      throw new Error(`${path}: entry ${String(index)} needs budget (${ids.join(", ")}), allowKB > 0, reason, record`);
    }
    return item as BudgetException;
  });
}

/** Compare one measure with its limit and its exception. */
export function judge(
  gzip9: number,
  limitBytes: number,
  exception: BudgetException | undefined,
): { readonly result: MeasureResult; readonly allowBytes: number | null; readonly stale: boolean } {
  const allowBytes = exception !== undefined ? exception.allowKB * KB : null;
  if (gzip9 <= limitBytes) {
    return { result: "ok", allowBytes, stale: exception !== undefined };
  }
  if (allowBytes !== null && gzip9 <= allowBytes) {
    return { result: "exception", allowBytes, stale: false };
  }
  return { result: "exceeded", allowBytes, stale: false };
}

/**
 * Compare each file group with its budget and its exception. A group of null (an entry that the build does not have)
 * gives no measure. Stale exceptions go into `problems`.
 */
export function measureEntries(
  groups: Readonly<Record<string, readonly string[] | null | undefined>>,
  build: ReadonlyMap<string, BuiltFile>,
  budgets: readonly EntryBudget[],
  exceptions: readonly BudgetException[],
  problems: string[],
): EntryMeasure[] {
  const measures: EntryMeasure[] = [];
  for (const budget of budgets) {
    const files = groups[budget.id];
    if (files === null || files === undefined) continue;
    const total = sumFiles(files, build);
    const verdict = judge(
      total.gzip9,
      budget.limitBytes,
      exceptions.find((item) => item.budget === budget.id),
    );
    if (verdict.stale) {
      problems.push(`the exception of "${budget.id}" is stale: the measure is within the limit, so remove the entry`);
    }
    measures.push({
      id: budget.id,
      label: budget.label,
      limitBytes: budget.limitBytes,
      gzip9: total.gzip9,
      gzip1: total.gzip1,
      raw: total.raw,
      files: [...files].sort(),
      result: verdict.result,
      allowBytes: verdict.allowBytes,
      ok: verdict.result !== "exceeded",
    });
  }
  return measures;
}

/** A size in KB with one decimal: "300.7 KB". */
export function formatKB(bytes: number): string {
  return `${(bytes / KB).toFixed(1)} KB`;
}
