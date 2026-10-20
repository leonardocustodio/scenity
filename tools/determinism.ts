// SPDX-License-Identifier: Apache-2.0
/**
 * The determinism lint: a frame is a pure function of its
 * inputs, so the code of a system or a simulation must not read the wall clock, use random numbers that have no
 * seed, use timers, or depend on the insertion order of a `Set` or a `Map`.
 *
 * Run from the repo root:
 *     bun tools/determinism.ts             # exit 1 on a finding
 *     bun tools/determinism.ts --root <dir>   # scan another root (the tests use it)
 *
 * The lint reads the `sim/` and `systems/` folders of each plugin and of each sample plugin, and the systems of the
 * runtime. The check of the iteration over a `Set` or a `Map` is a heuristic: it finds a `for … of` loop or a
 * `.forEach` call on a name with a `Set` or `Map` type, or a name that ends with "Set" or "Map". A comment
 * `// determinism: ordered` on the line or on the line before accepts the line.
 */
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const ROOT = resolve(import.meta.dir, "..");

/** The globs of the files that the lint reads, relative to the root. */
export const DETERMINISM_GLOBS = [
  "plugins/*/*/src/**/{sim,systems}/**/*.ts",
  "samples/*/plugins/**/{sim,systems}/**/*.ts",
  "packages/runtime/src/systems/**/*.ts",
];

/** The comment that accepts a line. */
export const ACCEPT_MARK = "determinism: ordered";

/** The calls that a system or a simulation must not make. */
const FORBIDDEN: readonly { readonly pattern: RegExp; readonly message: string }[] = [
  { pattern: /\bDate\.now\s*\(/, message: "Date.now reads the wall clock; use ctx.t" },
  { pattern: /\bperformance\.now\s*\(/, message: "performance.now reads the wall clock; use ctx.t" },
  { pattern: /\bnew\s+Date\s*\(/, message: "new Date reads the wall clock; use ctx.t" },
  { pattern: /\bMath\.random\s*\(/, message: "Math.random has no seed; use ctx.random(name)" },
  { pattern: /\bcrypto\.(getRandomValues|randomUUID)\b/, message: "crypto random values have no seed" },
  { pattern: /\b(setTimeout|setInterval)\s*\(/, message: "a timer runs on the wall clock" },
];

export interface Finding {
  readonly path: string;
  /** The line number, from 1. */
  readonly line: number;
  readonly message: string;
}

/** The text with each comment and each string literal replaced by spaces, so the line numbers stay. */
export function stripCode(text: string): string {
  return text.replace(
    /\/\*[\s\S]*?\*\/|\/\/[^\n]*|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'|`(?:\\.|[^`\\])*`/g,
    (match) => match.replace(/[^\n]/g, " "),
  );
}

/** The names that have a `Set` or a `Map` value in a text: a type annotation, or `new Set` / `new Map`. */
export function collectionNames(code: string): Set<string> {
  const names = new Set<string>();
  const declared = /([#$\w]+)\s*(?:\?\s*)?(?::\s*(?:Readonly)?(?:Weak)?(?:Set|Map)\s*<|=\s*new\s+(?:Set|Map)\b)/g;
  for (const match of code.matchAll(declared)) if (match[1] !== undefined) names.add(match[1]);
  return names;
}

/** True for a name that holds a `Set` or a `Map`. */
function isCollection(expression: string, names: ReadonlySet<string>): boolean {
  const base = expression.replace(/\.(keys|values|entries)\(\)$/, "");
  const last = base.split(".").at(-1) ?? base;
  return names.has(last) || /(Set|Map)$/.test(last) || /^(set|map)$/i.test(last);
}

/** The places in one line of code where the order of a `Set` or a `Map` decides the order of the work. */
function iterations(line: string, names: ReadonlySet<string>): string[] {
  const out: string[] = [];
  const forOf = /\bfor\s*\(\s*(?:const|let|var)\s+[^;]*?\bof\s+([#$\w.]+(?:\(\))?)/g;
  for (const match of line.matchAll(forOf)) {
    const expression = match[1] ?? "";
    if (isCollection(expression, names)) out.push(`a for … of loop over "${expression}" depends on insertion order`);
  }
  for (const match of line.matchAll(/([#$\w.]+)\.forEach\s*\(/g)) {
    const expression = match[1] ?? "";
    if (isCollection(expression, names)) out.push(`"${expression}.forEach" depends on insertion order`);
  }
  return out;
}

/** The findings of one file. `path` is only for the report. */
export function checkText(text: string, path: string): Finding[] {
  const raw = text.split("\n");
  const code = stripCode(text);
  const names = collectionNames(code);
  const findings: Finding[] = [];
  code.split("\n").forEach((line, index) => {
    const accepted = [raw[index], raw[index - 1]].some((item) => item?.includes(ACCEPT_MARK) === true);
    if (accepted) return;
    for (const rule of FORBIDDEN) {
      if (rule.pattern.test(line)) findings.push({ path, line: index + 1, message: rule.message });
    }
    for (const message of iterations(line, names)) findings.push({ path, line: index + 1, message });
  });
  return findings;
}

/** The files that the lint reads, relative to the root, in sort order. */
export function determinismFiles(root = ROOT): string[] {
  const files = new Set<string>();
  for (const pattern of DETERMINISM_GLOBS) {
    for (const path of new Bun.Glob(pattern).scanSync({ cwd: root, onlyFiles: true })) {
      const normal = path.split("\\").join("/");
      if (!normal.split("/").includes("node_modules")) files.add(normal);
    }
  }
  return [...files].sort();
}

/** The findings of all the files under a root. */
export function scan(root = ROOT): Finding[] {
  return determinismFiles(root).flatMap((path) => checkText(readFileSync(resolve(root, path), "utf8"), path));
}

function main(args: readonly string[]): number {
  const at = args.indexOf("--root");
  const root = at >= 0 && args[at + 1] !== undefined ? resolve(args[at + 1] ?? ".") : ROOT;
  const files = determinismFiles(root);
  const findings = scan(root);
  for (const finding of findings) console.error(`${finding.path}:${String(finding.line)}: ${finding.message}`);
  if (findings.length > 0) {
    console.error(`determinism: ${String(findings.length)} finding(s). Accept a line with "// ${ACCEPT_MARK}".`);
    return 1;
  }
  console.log(`determinism: ${String(files.length)} file(s), no finding`);
  return 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
