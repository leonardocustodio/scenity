// SPDX-License-Identifier: Apache-2.0
/**
 * The module size report of a runtime build.
 *
 * A Vite plugin of the runtime build calls `writeModuleReport` with the rendered length of each module in each chunk
 * at each build (the app and each worker). It writes one report for each output folder into REPORT_FOLDER. The
 * folder is outside `dist`, so a release never has it. `bun run check:size --why` reads the report of the build that
 * it measures and gives the modules of the chunks of each entry by size.
 *
 * The end-to-end setup, the pseudo-locale run and the perf harness build into other folders with other settings. One
 * shared file would hold the chunk names of another build, and `--why` would refuse `dist`. Thus each output folder
 * has its own report. The plugin writes it in `writeBundle`, when the chunk names are final.
 *
 * The rendered length is the length of the module code before the minifier. The report gives each module a share of
 * the real gzip size of its chunk, in proportion to its rendered length. That is an estimate: gzip compresses some
 * code better than other code. It is good to find the large parts, not to count bytes.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const WEB_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** The folder of the module reports: one file for each output folder of a runtime build. */
export const REPORT_FOLDER = join(WEB_ROOT, "node_modules", ".cache", "module-report");

/** chunk file name (for example `assets/room3dWorker-AbC.js`) → module name → rendered length. */
export type ModuleReport = Record<string, Record<string, number>>;

/** The file of a report: the output folder of the build and its chunks. */
export interface ModuleReportFile {
  readonly dist: string;
  readonly chunks: ModuleReport;
}

/** The real path of a folder (macOS gives /tmp and /private/tmp for one folder), else the resolved path. */
function realFolder(folder: string): string {
  const path = resolve(folder);
  return existsSync(path) ? realpathSync(path) : path;
}

/** The report file of the build in `dist`: the name of the folder and a hash of its real path. */
export function reportFileFor(dist: string, folder = REPORT_FOLDER): string {
  const path = realFolder(dist);
  const hash = createHash("sha256").update(path).digest("hex").slice(0, 12);
  return join(folder, `${basename(path)}-${hash}.json`);
}

/** The chunk of a bundle, as the plugin sees it: its file name and the rendered length of each module. */
export interface BundleChunk {
  readonly type: string;
  readonly fileName: string;
  readonly modules?: Readonly<Record<string, { readonly renderedLength: number }>>;
}

/** Add the chunks of a bundle to a report: module names and their rendered lengths. */
export function recordChunks(report: ModuleReport, bundle: Readonly<Record<string, BundleChunk>>): void {
  for (const item of Object.values(bundle)) {
    if (item.type !== "chunk" || item.modules === undefined) continue;
    const modules: Record<string, number> = {};
    for (const [id, module] of Object.entries(item.modules)) {
      const name = moduleName(id);
      modules[name] = (modules[name] ?? 0) + module.renderedLength;
    }
    report[item.fileName] = modules;
  }
}

/** Write the report of the build in `dist`. Returns the path of the file. */
export function writeModuleReport(dist: string, chunks: ModuleReport, folder = REPORT_FOLDER): string {
  const file = reportFileFor(dist, folder);
  mkdirSync(dirname(file), { recursive: true });
  const content: ModuleReportFile = { dist: realFolder(dist), chunks };
  writeFileSync(file, `${JSON.stringify(content)}\n`);
  return file;
}

/** A short, stable name of a module: a package name and path for node_modules, else the path from the repo root. */
export function moduleName(id: string): string {
  const clean = id.replace(/\?.*$/, "").replace(/^\0/, "");
  const inModules = /node_modules\/(?:\.bun\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)\/(.*)$/.exec(clean);
  if (inModules !== null) return `${inModules[1] ?? ""}/${inModules[2] ?? ""}`;
  return clean.startsWith("/") ? relative(WEB_ROOT, clean) : clean;
}

/** The group of a module in the text of the report. */
export function moduleGroup(name: string): string {
  if (name.startsWith("three/")) return "three.js";
  const room3d = /^packages\/room3d\/src\/([^/]+)\//.exec(name);
  if (room3d !== null) return `room3d ${room3d[1] ?? ""}`;
  if (name.startsWith("packages/") || name.startsWith("apps/")) return name.split("/").slice(0, 2).join("/");
  return name.split("/")[0] ?? name;
}

export interface ModuleShare {
  readonly name: string;
  readonly group: string;
  /** The rendered length (before the minifier). */
  readonly rendered: number;
  /** The estimated share of the gzip-9 size of the chunks. */
  readonly gzip9: number;
}

/**
 * The modules of some chunks with their estimated gzip shares. `gzipOf` gives the real gzip-9 size of a chunk.
 * Returns null when the report has a chunk that is not in the list (the report of another build).
 */
export function moduleShares(
  report: ModuleReport,
  chunks: readonly string[],
  gzipOf: (chunk: string) => number,
): ModuleShare[] | null {
  const totals = new Map<string, ModuleShare>();
  for (const chunk of chunks) {
    const modules = report[chunk];
    if (modules === undefined) return null;
    const rendered = Object.values(modules).reduce((sum, value) => sum + value, 0) || 1;
    const gzip = gzipOf(chunk);
    for (const [name, length] of Object.entries(modules)) {
      const before = totals.get(name);
      totals.set(name, {
        name,
        group: moduleGroup(name),
        rendered: (before?.rendered ?? 0) + length,
        gzip9: (before?.gzip9 ?? 0) + (gzip * length) / rendered,
      });
    }
  }
  return [...totals.values()].sort((a, b) => b.gzip9 - a.gzip9);
}

/** Read the module report of the build in `dist`, or null without one. */
export function readModuleReport(dist: string, folder = REPORT_FOLDER): ModuleReport | null {
  const file = reportFileFor(dist, folder);
  if (!existsSync(file)) return null;
  const content = JSON.parse(readFileSync(file, "utf8")) as Partial<ModuleReportFile>;
  return content.dist === realFolder(dist) && content.chunks !== undefined ? content.chunks : null;
}

/**
 * The text of `bun run check:size --why`, and false when the build in `dist` has no current report. `areas` are the
 * label and the files of each entry (the budgets of the entry spec).
 */
export function whyEntries(
  dist: string,
  areas: readonly (readonly [string, readonly string[]])[],
  folder = REPORT_FOLDER,
): { readonly ok: boolean; readonly text: string } {
  const report = readModuleReport(dist, folder);
  if (report === null) {
    return { ok: false, text: `size --why: no module report of ${dist}; run "bun run build" first` };
  }
  const gzipOf = (chunk: string): number => gzipSync(readFileSync(join(dist, chunk)), { level: 9 }).length;
  const lines: string[] = [];
  const kb = (bytes: number): string => `${(bytes / 1024).toFixed(1)} KB`;
  for (const [label, chunks] of areas) {
    const scripts = chunks.filter((chunk) => chunk.endsWith(".js"));
    const shares = moduleShares(report, scripts, gzipOf);
    if (shares === null) {
      const missing = scripts.filter((chunk) => report[chunk] === undefined).join(", ");
      return {
        ok: false,
        text: `size --why: the module report of ${dist} has no ${missing} (an older report); run "bun run build" again`,
      };
    }
    const total = scripts.reduce((sum, chunk) => sum + gzipOf(chunk), 0);
    lines.push(`${label}: ${kb(total)} gzip-9 in ${String(scripts.length)} files (${scripts.join(", ")})`);
    const groups = new Map<string, number>();
    for (const share of shares) groups.set(share.group, (groups.get(share.group) ?? 0) + share.gzip9);
    for (const [group, bytes] of [...groups].sort((a, b) => b[1] - a[1])) {
      lines.push(`  ${kb(bytes).padStart(9)}  ${group}`);
    }
    lines.push("  largest modules (estimated gzip-9 share):");
    for (const share of shares.slice(0, 25)) lines.push(`  ${kb(share.gzip9).padStart(9)}  ${share.name}`);
    lines.push("");
  }
  lines.push("The shares are estimates: each module gets the part of the gzip size of its chunk that its code has.");
  return { ok: true, text: lines.join("\n") };
}
