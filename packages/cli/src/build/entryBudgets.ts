// SPDX-License-Identifier: Apache-2.0
/**
 * The entry budgets of a runtime build. A plugin gives the entries and their budgets in an entry spec (a module whose
 * default export is an `EntrySpec`). `measureBuild` gives the spec the import graph of the build and the shell of
 * `index.html`, and measures each entry. This part of tools/size-budget.ts is in this package, so a plugin outside the
 * checkout (the room plugin of CodeBlue) tests its spec with `@scenity/cli/entryBudgets`. The command is still
 * tools/size-budget.ts.
 */
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  checkCopies,
  closure,
  edgeReader,
  findChunk,
  formatKB as kb,
  measureEntries,
  readBuild,
  readExceptions as readExceptionFile,
  sumFiles as sum,
  type BudgetException,
  type BuiltFile,
  type Edges,
  type EntryMeasure,
  type MeasureResult,
} from "./sizes";

/** The budget of one entry: a limit of the gzip-9 bytes of its file group. */
export interface Budget {
  readonly id: string;
  readonly label: string;
  readonly limitBytes: number;
}

/** The build as the tool gives it to an entry spec. */
export interface GroupContext {
  /** The shell: the entry script of index.html and its static closure. */
  readonly shell: ReadonlySet<string>;
  /** The file of a named chunk ("assets/<name>-<hash>.js"), or null. */
  readonly chunk: (name: string) => string | null;
  /** The static closure of a named chunk without the shell and the style sheets, or null without the chunk. */
  readonly entry: (name: string) => string[] | null;
  /** The closure of some files: static edges, and lazy edges when `lazy` is true. It stops at the files of `stop`. */
  readonly closure: (starts: readonly string[], lazy: boolean, stop: ReadonlySet<string>) => ReadonlySet<string>;
}

/**
 * The entries of a build and their budgets: a plugin gives them in a module (`--budgets`). `groups` gives
 * the files of each budget, or null for an entry that the build does not have.
 */
export interface EntrySpec {
  readonly budgets: readonly Budget[];
  readonly groups: (context: GroupContext) => Readonly<Record<string, readonly string[] | null>>;
}

/** The spec with no entry: the tool gives only the information lines. */
export const NO_ENTRIES: EntrySpec = { budgets: [], groups: () => ({}) };

/** Read the entry spec of a module (its default export). */
export async function loadSpec(path: string): Promise<EntrySpec> {
  const module = (await import(pathToFileURL(resolve(path)).href)) as { default?: Partial<EntrySpec> };
  const spec = module.default;
  if (spec === undefined || !Array.isArray(spec.budgets) || typeof spec.groups !== "function")
    throw new Error(`${path}: the default export is not an entry spec ({ budgets, groups })`);
  return spec as EntrySpec;
}

/** The entry script and the style sheets of index.html. */
export function parseIndexHtml(html: string): { readonly entry: string | null; readonly css: readonly string[] } {
  const entry = /<script[^>]*type="module"[^>]*src="\/?([^"]+)"/.exec(html)?.[1] ?? null;
  const css = [...html.matchAll(/<link[^>]*rel="stylesheet"[^>]*href="\/?([^"]+)"/g)].map((match) => match[1] ?? "");
  return { entry, css };
}

/**
 * Every file below `assets/` that index.html names: the scripts (the classic browser check too), the module
 * preloads and the style sheets. The browser loads all of them before the first page.
 */
export function indexAssets(html: string): string[] {
  const paths = [...html.matchAll(/(?:src|href)="\/?(assets\/[^"]+)"/g)].map((match) => match[1] ?? "");
  return [...new Set(paths)];
}

/** The measure of one budget. */
export type Measure = EntryMeasure;

/** Read the exception file of the budgets of a spec. A missing file gives no exception. */
export function readExceptions(path: string, spec: EntrySpec): BudgetException[] {
  return readExceptionFile(
    path,
    spec.budgets.map((budget) => budget.id),
  );
}

export interface Report {
  readonly measures: readonly Measure[];
  /** Information only: no budget. `br`: the Brotli copies, a file without a copy at its gzip-9 size. */
  readonly info: Readonly<Record<string, { gzip9: number; gzip1: number; raw: number; files: number; br: number }>>;
  /** The files with precompressed copies (`.br` and `.gz`). */
  readonly precompressed: { readonly br: number; readonly gz: number };
  readonly problems: readonly string[];
  /** The files of each budget of the spec (an entry that the build does not have gives no files). */
  readonly groups?: Readonly<Record<string, readonly string[]>>;
}

/** The context of the spec: the chunks and closures of a build. A missing file of an entry is a problem. */
function groupContext(
  build: ReadonlyMap<string, BuiltFile>,
  edgesOf: (path: string) => Edges | null,
  shell: ReadonlySet<string>,
  problems: string[],
): GroupContext {
  const chunk = (name: string): string | null => findChunk(build.keys(), name);
  return {
    shell,
    chunk,
    // An entry is optional in a build: no chunk, no measure.
    entry: (name) => {
      const start = chunk(name);
      if (start === null) return null;
      const result = closure([start], edgesOf, false, shell);
      for (const path of result.missing) problems.push(`${start} imports ${path}, but the build has no such file`);
      return [...result.files].filter((path) => !shell.has(path) && !path.endsWith(".css"));
    },
    closure: (starts, lazy, stop) => closure(starts, edgesOf, lazy, stop).files,
  };
}

/** Measure a build folder against the budgets and the exceptions. */
export function measureBuild(
  dist: string,
  spec: EntrySpec = NO_ENTRIES,
  exceptions: readonly BudgetException[] = [],
): Report {
  const problems: string[] = [];
  const indexPath = join(dist, "index.html");
  if (!existsSync(indexPath)) {
    return {
      measures: [],
      info: {},
      precompressed: { br: 0, gz: 0 },
      problems: [`${dist} has no index.html: give the dist folder of a runtime build`],
    };
  }
  const build = readBuild(dist);
  problems.push(...checkCopies(dist));
  const edgesOf = edgeReader(dist, build);
  const html = readFileSync(indexPath, "utf8");
  const index = parseIndexHtml(html);
  if (index.entry === null) problems.push("index.html has no module entry script");
  const shell = closure(index.entry !== null ? [index.entry] : [], edgesOf);
  const shellJs = [...shell.files].filter((path) => !path.endsWith(".css"));
  for (const path of shell.missing) problems.push(`the shell imports ${path}, but the build has no such file`);
  const groups = spec.groups(groupContext(build, edgesOf, shell.files, problems));
  const measures = measureEntries(groups, build, spec.budgets, exceptions, problems);
  const info: Report["info"] = {
    "shell (the entry script of index.html and its static imports)": sum(shellJs, build),
    "initial CSS (index.html)": sum(index.css, build),
    "all JavaScript": sum(
      [...build.keys()].filter((path) => path.startsWith("assets/") && path.endsWith(".js")),
      build,
    ),
  };
  const files = [...build.values()];
  const precompressed = {
    br: files.filter((file) => file.br !== null).length,
    gz: files.filter((file) => file.gz !== null).length,
  };
  return {
    measures,
    info,
    precompressed,
    problems,
    groups: Object.fromEntries(spec.budgets.map((budget) => [budget.id, [...(groups[budget.id] ?? [])]])),
  };
}

/** The report as a text table. */
export function formatReport(report: Report): string {
  const lines = ["Budget                         gzip-9      limit       gzip-1      raw         files  result"];
  const words: Readonly<Record<MeasureResult, string>> = { ok: "ok", exception: "exception", exceeded: "EXCEEDED" };
  for (const item of report.measures) {
    lines.push(
      [
        item.label.padEnd(30),
        kb(item.gzip9).padEnd(11),
        kb(item.limitBytes).padEnd(11),
        kb(item.gzip1).padEnd(11),
        kb(item.raw).padEnd(11),
        String(item.files.length).padEnd(6),
        words[item.result] + (item.allowBytes !== null ? ` (allowance ${kb(item.allowBytes)})` : ""),
      ].join(" "),
    );
  }
  lines.push("", "Information (no budget):");
  // The Brotli bytes only when the build has copies: without them the value is the gzip-9 value again.
  const withCopies = report.precompressed.br > 0;
  for (const [label, value] of Object.entries(report.info)) {
    lines.push(
      `  ${label}: ${kb(value.gzip9)} gzip-9, ${kb(value.gzip1)} gzip-1, ${kb(value.raw)} raw, ${String(value.files)} files` +
        (withCopies ? `, ${kb(value.br)} br` : ""),
    );
  }
  lines.push(
    `  precompressed copies (scripts/precompress.ts): ${String(report.precompressed.br)} files .br, ` +
      `${String(report.precompressed.gz)} files .gz`,
  );
  for (const problem of report.problems) {
    lines.push(`problem: ${problem}`);
  }
  return lines.join("\n");
}
