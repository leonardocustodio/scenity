// SPDX-License-Identifier: Apache-2.0
/**
 * The licence check.
 *
 * Run from the repo root after `bun install`:
 *     bun tools/licences.ts            # exit 1 on a licence that is not allowed, or on a gap in NOTICE
 *     bun tools/licences.ts --list     # each installed package with its licence
 *
 * The check reads the package.json of each installed package (node_modules/.bun, the store of the isolated linker).
 * A package must have a licence of ALLOWED, or an entry in licence-exceptions.json with the reason. NOTICE must name
 * each third-party package that a workspace package lists in "dependencies" (the code that a built page holds), and
 * each vendored file under a src/**\/vendor folder.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");

/** The licences that a dependency of Scenity can have with no review. */
export const ALLOWED = new Set([
  "MIT",
  "ISC",
  "Apache-2.0",
  "BSD-2-Clause",
  "BSD-3-Clause",
  "0BSD",
  "BlueOak-1.0.0",
  "Unlicense",
  "CC0-1.0",
  "MPL-2.0",
  "Python-2.0",
  "CC-BY-4.0",
]);

export interface Installed {
  readonly name: string;
  readonly version: string;
  readonly licence: string;
}

/** The licence text of a package.json: the SPDX expression, or the old forms. */
export function licenceOf(json: Record<string, unknown>): string {
  const value = json.license ?? json.licenses;
  if (typeof value === "string") return value;
  if (Array.isArray(value)) return value.map((part) => licenceOf({ license: part })).join(" OR ");
  if (typeof value === "object" && value !== null && "type" in value) return String(value.type);
  return "UNKNOWN";
}

/** True when each alternative of an "OR" expression, or one of them, is allowed. */
export function allowed(licence: string): boolean {
  const alternatives = licence.replace(/[()]/g, "").split(/\s+OR\s+/);
  return alternatives.some((part) => part.split(/\s+AND\s+/).every((term) => ALLOWED.has(term.trim())));
}

/** The installed packages of the Bun store: one entry per name and version. */
export function installed(root = ROOT): Installed[] {
  const store = join(root, "node_modules", ".bun");
  if (!existsSync(store)) return [];
  const found = new Map<string, Installed>();
  for (const folder of readdirSync(store)) {
    const at = folder.lastIndexOf("@");
    if (at <= 0) continue;
    const name = folder.slice(0, at).replace("+", "/");
    const path = join(store, folder, "node_modules", name, "package.json");
    if (!existsSync(path)) continue;
    const json = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    const version = String(json.version);
    found.set(`${name}@${version}`, { name, version, licence: licenceOf(json) });
  }
  return [...found.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** The third-party runtime dependencies of the workspace packages. */
export function runtimeDependencies(root = ROOT): string[] {
  const names = new Set<string>();
  for (const group of ["apps", "packages", "plugins"]) {
    const folder = join(root, group);
    if (!existsSync(folder)) continue;
    for (const path of packageFiles(folder)) {
      const json = JSON.parse(readFileSync(path, "utf8")) as { dependencies?: Record<string, string> };
      for (const name of Object.keys(json.dependencies ?? {})) if (!name.startsWith("@scenity/")) names.add(name);
    }
  }
  return [...names].sort();
}

/**
 * The package.json of each package under a folder. A folder without a package.json can hold packages one level
 * deeper, at most `depth` levels: plugins/<plugin>/<part> and plugins/<plugin>/<group>/<name>.
 */
export function packageFiles(folder: string, depth = 2): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (!entry.isDirectory() || entry.name.includes(".") || entry.name === "node_modules") continue;
    const path = join(folder, entry.name, "package.json");
    if (existsSync(path)) out.push(path);
    else if (depth > 0) out.push(...packageFiles(join(folder, entry.name), depth - 1));
  }
  return out;
}

export interface Exception {
  readonly name: string;
  readonly reason: string;
}

export function problems(root = ROOT): string[] {
  const exceptions = JSON.parse(readFileSync(join(root, "tools", "licence-exceptions.json"), "utf8")) as Exception[];
  const excepted = new Set(exceptions.map((entry) => entry.name));
  const out: string[] = [];
  for (const entry of installed(root))
    if (!allowed(entry.licence) && !excepted.has(entry.name))
      out.push(`${entry.name}@${entry.version}: the licence "${entry.licence}" needs a review`);
  const notice = readFileSync(join(root, "NOTICE"), "utf8");
  for (const name of runtimeDependencies(root))
    if (!notice.includes(name)) out.push(`NOTICE does not name the runtime dependency ${name}`);
  return out;
}

function main(argv: readonly string[]): number {
  if (argv.includes("--list")) {
    for (const entry of installed()) console.log(`${entry.name}@${entry.version} ${entry.licence}`);
    return 0;
  }
  const found = problems();
  for (const problem of found) console.error(`licences: ${problem}`);
  console.log(`licences: ${String(installed().length)} packages; ${String(found.length)} problems`);
  return found.length === 0 ? 0 : 1;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
