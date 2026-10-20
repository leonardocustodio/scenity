// SPDX-License-Identifier: Apache-2.0
/**
 * `scenity build`: a static build of a project that a plain server can serve.
 *
 *     <out>/index.html                the page: one <scenity-player> of the project
 *     <out>/player/                   the player entries, the generic scene worker and the plugin bundle (player.ts)
 *     <out>/project/                  the canonical documents (documents.ts)
 *     <out>/project/build/            the asset build and its manifest (assets.ts)
 *     <out>/build-report.json         the report (report.ts)
 *
 * The build then runs the release checks on the player files: the marker gate (markers.ts: the markers of the engine
 * and of the plugins of the project, in the scripts and the source maps) and the size budgets of the entries
 * (`build.budgets` of the project, sizes.ts). The source maps are only for the gate: the build removes them after it.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { builtinRegistry, PROJECT_FILE, readDocument, type ProjectDocument } from "@scenity/scene";
import { canonicalJson } from "@scenity/scene/canonical";
import { isInside, resolvePluginEntries } from "../vite/resolve";
import { assetStep } from "./assets";
import { BUILD_ASSETS, documentStep } from "./documents";
import { engineMarkers, gateFails, joinMarkerSets, markerGate, type MarkerGate, type MarkerSet } from "./markers";
import { packageDir } from "../vite/resolve";
import { buildPlayerEntries, PLAYER_ENTRIES, playerGroups } from "./player";
import { pluginMarkers } from "./plugins";
import { REPORT_FILE, REPORT_FORMAT, reportMarkers, type BuildReport, type ReportEntry } from "./report";
import { KB, measureEntries, readBuild, type EntryBudget } from "./sizes";

/** A setup problem: no project, a bad project document, a bad output folder. */
export class BuildSetupError extends Error {}

export interface BuildOptions {
  /** The project folder. */
  readonly dir: string;
  /** The output folder (default `<project>/dist`). The build empties it first. */
  readonly out?: string;
  /** True: the asset build of the project must be current; the step does not write it. */
  readonly check?: boolean;
  /** Gets a line at the start of each step (the player entries take about a minute). */
  readonly progress?: (line: string) => void;
}

export interface BuildResult {
  readonly out: string;
  readonly report: BuildReport;
}

/** Read the project document of a folder. */
export function readBuildProject(dir: string): ProjectDocument {
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file)) throw new BuildSetupError(`${dir} has no ${PROJECT_FILE}.`);
  const read = readDocument(readFileSync(file, "utf8"), "project", { registry: builtinRegistry() });
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    throw new BuildSetupError(`${PROJECT_FILE} does not read: ${first.join("; ")}`);
  }
  return read.doc;
}

/** The budgets of the player entries from `build.budgets`; a budget of an unknown entry is a problem. */
export function entryBudgets(project: ProjectDocument, problems: string[]): EntryBudget[] {
  const budgets = project.build?.budgets ?? {};
  for (const id of Object.keys(budgets).sort()) {
    if (!PLAYER_ENTRIES.some((entry) => entry.id === id)) {
      problems.push(`build.budgets names "${id}", but the build has no such entry`);
    }
  }
  return PLAYER_ENTRIES.map((entry) => {
    const limit = budgets[entry.id]?.gzipKB;
    return { id: entry.id, label: entry.label, limitBytes: limit === undefined ? Infinity : limit * KB };
  });
}

/** The result of the release checks of a player folder. */
export interface PlayerCheck {
  readonly entries: readonly ReportEntry[];
  readonly gate: MarkerGate;
  readonly problems: readonly string[];
}

/**
 * Check a player folder of a build: the marker gate and the budgets of the entries. `pluginDirs` are the folders of
 * the plugins of the project. The file paths of the result start with `prefix`.
 */
export function checkPlayer(
  dir: string,
  project: ProjectDocument,
  markers: MarkerSet,
  pluginDirs: readonly string[],
  prefix = "player/",
): PlayerCheck {
  const problems: string[] = [];
  // The worker bundle of Vite names its sources from the output folder of the player package.
  const sourceBases = [join(packageDir("@scenity/player", import.meta.dir), "dist", "assets")];
  const gate = markerGate(dir, markers, { pluginDirs, sourceBases });
  const build = readBuild(dir);
  const groups = playerGroups(dir, build, problems);
  const budgets = entryBudgets(project, problems);
  const measures = measureEntries(groups, build, budgets, [], problems);
  const entries = measures.map((measure) => ({
    id: measure.id,
    label: measure.label,
    gzip: measure.gzip9,
    raw: measure.raw,
    limitKB: Number.isFinite(measure.limitBytes) ? measure.limitBytes / KB : null,
    result: Number.isFinite(measure.limitBytes) ? measure.result : ("no budget" as const),
    files: measure.files.map((path) => prefix + path),
  }));
  for (const entry of entries) {
    if (entry.result === "exceeded" && entry.limitKB !== null) {
      problems.push(
        `the entry "${entry.id}" is ${(entry.gzip / KB).toFixed(1)} KB, over its budget of ${String(entry.limitKB)} KB`,
      );
    }
  }
  return { entries, gate, problems };
}

/** Escape a text for HTML. */
function html(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** The page of the build: the web component with the project document. */
export function pageHtml(project: ProjectDocument): string {
  return [
    "<!doctype html>",
    "<!-- The page of `scenity build`. It plays the project with the web component of @scenity/player. -->",
    '<html lang="en">',
    "  <head>",
    '    <meta charset="UTF-8" />',
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0" />',
    `    <title>${html(project.name)}</title>`,
    "    <style>",
    "      html, body { margin: 0; height: 100%; background: #000000; overflow: hidden; }",
    "      scenity-player { width: 100vw; height: 100vh; }",
    "    </style>",
    "  </head>",
    "  <body>",
    `    <scenity-player src="project/${PROJECT_FILE}" autoplay></scenity-player>`,
    '    <script type="module" src="player/element.js"></script>',
    "  </body>",
    "</html>",
    "",
  ].join("\n");
}

/** Remove the source maps of a folder. */
function removeMaps(dir: string): void {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) removeMaps(path);
    else if (name.endsWith(".map")) rmSync(path);
  }
}

/** The output folder; it must not hold the project folder. */
function outputFolder(dir: string, out: string | undefined): string {
  const folder = resolve(out ?? join(dir, "dist"));
  if (isInside(dir, folder)) throw new BuildSetupError(`the output folder ${folder} holds the project folder`);
  return folder;
}

/** Run `scenity build`. */
export async function runBuild(options: BuildOptions): Promise<BuildResult> {
  const dir = resolve(options.dir);
  const project = readBuildProject(dir);
  const out = outputFolder(dir, options.out);
  const plugins = resolvePluginEntries(project.plugins ?? [], dir);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });
  const say = (step: string): void => options.progress?.(`scenity build: ${project.id}: ${step}`);
  say("the assets");
  const assets = await assetStep(dir, project, join(out, "project", BUILD_ASSETS), options.check === true);
  const documents = documentStep(dir, project, join(out, "project"));
  say("the player entries (about a minute)");
  await buildPlayerEntries(dir, join(out, "player"));
  writeFileSync(join(out, "index.html"), pageHtml(project));
  say("the checks of the player");
  const markers = joinMarkerSets(engineMarkers(), await pluginMarkers(plugins));
  const checked = checkPlayer(
    join(out, "player"),
    project,
    markers,
    plugins.map((plugin) => plugin.dir),
  );
  removeMaps(join(out, "player"));
  const problems = [...assets.problems, ...documents.problems, ...checked.problems];
  const files = [...readBuild(out).values()].map((file) => ({ path: file.path, bytes: file.bytes, gzip: file.gzip9 }));
  const report: BuildReport = {
    format: REPORT_FORMAT,
    project: project.id,
    passed: problems.length === 0 && !gateFails(checked.gate),
    entries: checked.entries,
    markers: reportMarkers(checked.gate),
    assets: { mode: assets.mode, files: assets.files.length, bytes: assets.bytes },
    documents: documents.files.map((path) => `project/${path}`),
    files,
    problems,
  };
  writeFileSync(join(out, REPORT_FILE), canonicalJson(report));
  return { out, report };
}

/** The output folder as the command shows it: relative to the work folder when it is inside it. */
export function shownPath(path: string): string {
  const rel = relative(process.cwd(), path);
  return rel === "" || rel.startsWith("..") ? path : rel;
}
