// SPDX-License-Identifier: Apache-2.0
/**
 * The domain word lint: no engine package names the domain of the resus room.
 *
 * Run from the repo root:
 *     bun tools/domain-words.ts              # exit 1 on a new hit or on a stale allowlist entry
 *     bun tools/domain-words.ts --update     # write the current counts; refuse a count that goes up
 *     bun tools/domain-words.ts --update --moved   # also accept new files when the total does not go up (a move)
 *     bun tools/domain-words.ts --report     # the hits per package, and the files with the most hits
 *
 * The lint reads the source files under apps/, packages/ and tools/ (the engine) and counts the domain words in each
 * file. The folders plugins/ and samples/ hold domain code, so the lint does not read them. A file with hits must
 * have an entry in domain-words-allowlist.json with the same count and the area of the file. The list can
 * only become shorter: a new hit fails, and an entry above its count is stale and fails too.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { extname, join, relative, resolve, sep } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");
export const ALLOWLIST = join(ROOT, "tools", "domain-words-allowlist.json");

/** The folders of the engine. */
const ENGINE_ROOTS = ["apps", "packages", "tools"];
/** Folders that the lint does not read: build outputs, caches, generated files and pictures. */
const SKIPPED_FOLDERS = new Set([
  "node_modules",
  "dist",
  "test-results",
  "playwright-report",
  "generated",
  "__screenshots__",
  "__pycache__",
  ".vite",
  ".cache",
  ".turbo",
]);
/** The file types that hold code, texts or data of the engine. */
const EXTENSIONS = new Set([".ts", ".vue", ".js", ".mjs", ".py", ".ftl", ".css", ".json", ".html", ".sh"]);
/**
 * Files that only list the words, and vendored third-party builds. The Emscripten glue of the Basis transcoder names
 * its run dependency "monitor", and so does the glue of the Draco decoder. This repository cannot change them.
 */
const SKIPPED_FILES = new Set([
  "tools/domain-words.ts",
  "tools/domain-words.test.ts",
  "tools/domain-words-allowlist.json",
  "packages/render/src/vendor/basis_transcoder.js",
  "packages/render/src/vendor/draco_wasm_wrapper.js",
]);

/** The domain words of the resus room. Each word matches at the start of a word part. */
export const DOMAIN_WORDS = [
  "patient",
  "bed",
  "defib",
  "paddle",
  "bvm",
  "cpr",
  "airway",
  "iv",
  "monitor",
  "shock",
  "medicat",
  "intubat",
  "leader",
  "clinical",
  "acls",
  "resus",
] as const;

// "iv" is short, so it must be a whole word part ("IV", "iv_pole", "ivLine"; not "ivory").
const WORD_PATTERN = new RegExp(
  `(?<![a-z])(?:${DOMAIN_WORDS.map((word) => (word === "iv" ? "iv(?![a-z])" : word)).join("|")})`,
  "g",
);

/** One entry of the allowlist: the count of hits in the file and the area of the file. */
export interface AllowEntry {
  readonly hits: number;
  readonly area: string;
}

export interface Allowlist {
  readonly files: Readonly<Record<string, AllowEntry>>;
}

/** A hex color text (`#bedfff`): it is not a word. */
const HEX_COLOR = /#[0-9a-f]{3,8}(?![0-9a-z])/gi;

/**
 * The count of domain words in a text. A camel case name counts each part ("bedRelease" has "bed"). A hex color text
 * is not a word (for example the color `#bedfff` of the engine tokens).
 */
export function countHits(text: string): number {
  let hits = 0;
  for (const line of text.split("\n")) {
    const parts = line
      .replace(HEX_COLOR, "")
      .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
      .toLowerCase();
    hits += parts.match(WORD_PATTERN)?.length ?? 0;
  }
  return hits;
}

function walk(folder: string, out: string[]): void {
  for (const name of readdirSync(folder)) {
    const path = join(folder, name);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      // A build output has the name "dist" or "dist-<name>" (the scene page writes dist-scene).
      if (!SKIPPED_FOLDERS.has(name) && !name.startsWith("dist-")) walk(path, out);
    } else if (EXTENSIONS.has(extname(name))) out.push(path);
  }
}

/**
 * The source files under the given folders, relative to the repo root with "/" as the separator. The fixture check
 * (tools/fixture-check.ts) uses the same walk.
 */
export function sourceFiles(root: string, folders: readonly string[]): string[] {
  const out: string[] = [];
  for (const folder of folders) if (existsSync(join(root, folder))) walk(join(root, folder), out);
  return out.map((path) => relative(root, path).split(sep).join("/")).sort();
}

/** The engine files, relative to the repo root with "/" as the separator. */
export function engineFiles(root = ROOT): string[] {
  return sourceFiles(root, ENGINE_ROOTS).filter((path) => !SKIPPED_FILES.has(path));
}

/** The hits of each engine file that has hits. */
export function scan(root = ROOT): Map<string, number> {
  const hits = new Map<string, number>();
  for (const path of engineFiles(root)) {
    const count = countHits(readFileSync(join(root, path), "utf8"));
    if (count > 0) hits.set(path, count);
  }
  return hits;
}

/** The area of a file: its package or app folder (for example `packages/runtime`), else its top folder. */
export function areaOf(path: string): string {
  const parts = path.split("/");
  return parts[0] === "packages" || parts[0] === "apps" ? parts.slice(0, 2).join("/") : (parts[0] ?? path);
}

export interface Problem {
  readonly path: string;
  readonly message: string;
}

/** Compare the hits with the allowlist: a new hit and a stale entry are problems. */
export function compare(hits: ReadonlyMap<string, number>, allow: Allowlist): Problem[] {
  const problems: Problem[] = [];
  for (const [path, count] of hits) {
    const entry = allow.files[path];
    if (entry === undefined) problems.push({ path, message: `${String(count)} domain words; the file has no entry` });
    else if (count > entry.hits)
      problems.push({ path, message: `${String(count)} domain words; the allowlist has ${String(entry.hits)}` });
    else if (count < entry.hits)
      problems.push({
        path,
        message: `stale entry: ${String(count)} domain words, the allowlist has ${String(entry.hits)}`,
      });
  }
  for (const path of Object.keys(allow.files))
    if (!hits.has(path)) problems.push({ path, message: "stale entry: the file has no domain word (or is gone)" });
  return problems;
}

/** The new allowlist of an update, or the reason for a refusal. */
export function updated(
  hits: ReadonlyMap<string, number>,
  allow: Allowlist,
  moved: boolean,
): { readonly allow: Allowlist } | { readonly refusal: string } {
  const total = (counts: Iterable<number>) => [...counts].reduce((sum, count) => sum + count, 0);
  const before = total(Object.values(allow.files).map((entry) => entry.hits));
  const after = total(hits.values());
  if (after > before) return { refusal: `the total goes up from ${String(before)} to ${String(after)}` };
  if (!moved) {
    for (const [path, count] of hits) {
      const entry = allow.files[path];
      if (entry === undefined) return { refusal: `${path} is new (a move? use --moved)` };
      if (count > entry.hits) return { refusal: `${path} goes up from ${String(entry.hits)} to ${String(count)}` };
    }
  }
  const files: Record<string, AllowEntry> = {};
  for (const [path, count] of [...hits].sort(([a], [b]) => a.localeCompare(b)))
    files[path] = { hits: count, area: allow.files[path]?.area ?? areaOf(path) };
  return { allow: { files } };
}

export function readAllowlist(path = ALLOWLIST): Allowlist {
  return existsSync(path) ? (JSON.parse(readFileSync(path, "utf8")) as Allowlist) : { files: {} };
}

function packageOf(path: string): string {
  const parts = path.split("/");
  return parts[0] === "tools"
    ? parts[1]?.includes(".") === false
      ? `tools/${parts[1]}`
      : "tools"
    : parts.slice(0, 2).join("/");
}

function report(hits: ReadonlyMap<string, number>): void {
  const perPackage = new Map<string, { hits: number; files: number }>();
  for (const [path, count] of hits) {
    const entry = perPackage.get(packageOf(path)) ?? { hits: 0, files: 0 };
    perPackage.set(packageOf(path), { hits: entry.hits + count, files: entry.files + 1 });
  }
  for (const [name, entry] of [...perPackage].sort((a, b) => b[1].hits - a[1].hits))
    console.log(`${name.padEnd(32)} ${String(entry.hits).padStart(6)} hits in ${String(entry.files)} files`);
}

function main(argv: readonly string[]): number {
  const hits = scan();
  const allow = readAllowlist();
  if (argv.includes("--report")) {
    report(hits);
    return 0;
  }
  if (argv.includes("--update")) {
    const result = updated(hits, allow, argv.includes("--moved"));
    if ("refusal" in result) {
      console.error(`domain words: no update: ${result.refusal}`);
      return 1;
    }
    writeFileSync(ALLOWLIST, `${JSON.stringify(result.allow, null, 2)}\n`);
    console.log(`domain words: ${String(Object.keys(result.allow.files).length)} files in the allowlist`);
    return 0;
  }
  const problems = compare(hits, allow);
  for (const problem of problems) console.error(`domain words: ${problem.path}: ${problem.message}`);
  const total = [...hits.values()].reduce((sum, count) => sum + count, 0);
  console.log(
    `domain words: ${String(total)} hits in ${String(hits.size)} engine files; ${String(problems.length)} problems`,
  );
  return problems.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
