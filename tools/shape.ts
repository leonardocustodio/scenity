// SPDX-License-Identifier: Apache-2.0
/**
 * The code shape of the 3D room and its lab: at most 500 lines in a file and 80 lines in a function.
 * shape-exceptions.json holds the limits, the files and the exceptions. eslint.config.js reads it and makes the two
 * limits lint errors. The exception files are larger than their limit, so the lint does not check them for that limit.
 *
 * This report lints the exception files with the two limits only and shows each large unit with its size. An entry
 * whose file is in its limit is stale: the report fails, and `--prune` removes the stale entries. Thus a split of a
 * large unit also makes the list shorter.
 *
 * A plugin keeps the files and the exceptions of its own code in plugins/<plugin>/shape-exceptions.json, with
 * paths relative to the plugin folder. The limits come from the file of the engine. eslint.config.js reads the same
 * files.
 *
 *   bun tools/shape.ts [--prune]     (from the repo root)
 */
import { ESLint, type Linter } from "eslint";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

export type ShapeRule = "max-lines" | "max-lines-per-function";

export interface ShapeException {
  readonly path: string;
  readonly rule: ShapeRule;
}

/** shape-exceptions.json: the limits (lint rule → maximum), the files they apply to and the exceptions. */
export interface ShapeConfig {
  readonly limits: Readonly<Record<ShapeRule, number>>;
  readonly files: readonly string[];
  readonly exceptions: readonly ShapeException[];
}

const WEB = join(import.meta.dir, "..");
/** The name of the shape file of a plugin (plugins/<plugin>/shape-exceptions.json). */
export const PLUGIN_LIST = "shape-exceptions.json";

/** A shape file: its path and the prefix that makes its paths relative to the repo root. */
export interface ShapeSource {
  readonly file: string;
  readonly prefix: string;
}

/** The shape file of the engine, then the shape file of each plugin that has one. */
export function shapeSources(root: string = WEB): ShapeSource[] {
  const plugins = join(root, "plugins");
  const found = existsSync(plugins)
    ? readdirSync(plugins, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && existsSync(join(plugins, entry.name, PLUGIN_LIST)))
        .map((entry) => ({ file: join(plugins, entry.name, PLUGIN_LIST), prefix: `plugins/${entry.name}/` }))
        .sort((a, b) => a.file.localeCompare(b.file))
    : [];
  return [{ file: join(root, "tools", "shape-exceptions.json"), prefix: "" }, ...found];
}

function readSource(source: ShapeSource): Partial<ShapeConfig> {
  return JSON.parse(readFileSync(source.file, "utf8")) as Partial<ShapeConfig>;
}

/** The limits of the engine file, and the files and exceptions of all shape files, with paths from the repo root. */
export function shapeConfig(root: string = WEB): ShapeConfig {
  const all = shapeSources(root).map((source) => ({ source, config: readSource(source) }));
  return {
    limits: all[0]?.config.limits ?? { "max-lines": 500, "max-lines-per-function": 80 },
    files: all.flatMap(({ source, config }) => (config.files ?? []).map((path) => source.prefix + path)),
    exceptions: all.flatMap(({ source, config }) =>
      (config.exceptions ?? []).map((item) => ({ ...item, path: source.prefix + item.path })),
    ),
  };
}

/** Remove the stale exceptions (paths from the repo root) from each shape file. */
function prune(stale: readonly ShapeException[], root: string = WEB): void {
  for (const source of shapeSources(root)) {
    const config = readSource(source);
    const before = config.exceptions ?? [];
    const kept = before.filter(
      (item) => !stale.some((entry) => entry.rule === item.rule && entry.path === source.prefix + item.path),
    );
    if (kept.length === before.length) continue;
    writeFileSync(source.file, `${JSON.stringify({ ...config, exceptions: kept }, null, 2)}\n`);
    console.log(
      `shape: removed ${String(before.length - kept.length)} stale entries from ${relative(root, source.file)}`,
    );
  }
}

async function main(): Promise<number> {
  const config = shapeConfig();
  const exceptions = config.exceptions;
  const rules: Linter.RulesRecord = Object.fromEntries(
    Object.entries(config.limits).map(([rule, max]) => [rule, ["error", max] as Linter.RuleEntry]),
  );
  const eslint = new ESLint({ cwd: WEB, overrideConfig: { rules } });
  const paths = [...new Set(exceptions.map((item) => item.path))];
  const results = await eslint.lintFiles(paths);
  const found = new Map<string, string[]>();
  for (const result of results) {
    const path = result.filePath.slice(WEB.length + 1);
    for (const message of result.messages) {
      if (message.ruleId === null || !(message.ruleId in config.limits)) continue;
      const key = `${path} ${message.ruleId}`;
      found.set(key, [...(found.get(key) ?? []), `line ${String(message.line)}: ${message.message}`]);
    }
  }
  const stale = exceptions.filter((item) => !found.has(`${item.path} ${item.rule}`));
  for (const item of exceptions) {
    for (const line of found.get(`${item.path} ${item.rule}`) ?? []) console.log(`${item.path}  ${line}`);
  }
  console.log(`shape: ${String(exceptions.length - stale.length)} exceptions, ${String(stale.length)} stale`);
  if (stale.length === 0) return 0;
  if (process.argv.includes("--prune")) {
    prune(stale);
    return 0;
  }
  for (const item of stale) console.error(`stale: ${item.path} (${item.rule}) is in its limit now; run with --prune`);
  return 1;
}

if (import.meta.main) process.exit(await main());
