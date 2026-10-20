// SPDX-License-Identifier: Apache-2.0
/**
 * The documents of a project for `scenity check`: the project document, its scenes and sequences, the rules of the
 * project (inline and in `*.rules.json` files, as the writer of the scene files reads them) and the runtime faces of
 * its plugins.
 *
 * The check measures the rules of a scene and of each sequence of the project that animates that scene. The project
 * rules apply to each scene, as the writer gate applies them to each save.
 */
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { builtinRegistry, readDocument, type ProjectDocument, type Rule, type SceneDocument } from "@scenity/scene";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { MetricPlugin, RuleVerdict } from "@scenity/rules";
import { PluginHost, type RuntimePlugin } from "@scenity/runtime/plugins";
import { PROJECT_FILE, projectRules } from "../sceneFile/ruleGate";
import { resolvePluginEntries } from "../vite/resolve";
import { CheckSetupError } from "./assets";
import type { HeadlessRegistries } from "./headless";

/** A scene file of the project: its path (relative to the project folder, with "/"), its document and its hash. */
export interface CheckScene {
  readonly path: string;
  readonly doc: SceneDocument;
  /** The SHA-256 of the bytes of the file (the hash of the override log). */
  readonly hash: string;
}

/** A sequence file of the project. */
export interface CheckSequence {
  readonly path: string;
  readonly doc: SequenceDocument;
}

/** The documents and rules of a project folder. */
export interface CheckProject {
  /** The project folder (absolute). */
  readonly dir: string;
  readonly project: ProjectDocument;
  readonly scenes: readonly CheckScene[];
  readonly sequences: readonly CheckSequence[];
  /** The rules of the project document and of its rules files. */
  readonly rules: readonly Rule[];
  /** An error verdict for each rules file that does not read. */
  readonly problems: readonly RuleVerdict[];
}

/** The text of a file of the project; a setup error when the file is missing. */
function projectText(dir: string, path: string): Buffer {
  const file = join(dir, ...path.split("/"));
  if (!existsSync(file)) throw new CheckSetupError(`The project names ${path}, but the file does not exist.`);
  return readFileSync(file);
}

/** The words of the first problems of a document that does not read. */
function readProblem(path: string, errors: readonly { path: string; message: string }[]): CheckSetupError {
  const first = errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
  return new CheckSetupError(`${path} does not read: ${first.join("; ")}`);
}

/** A project document with no scene, for a folder with no project file (the writer gate of a bare folder). */
const EMPTY_PROJECT = JSON.stringify({ format: "scenity.project/1", id: "project", name: "Project", scenes: [] });

/**
 * Read the project document, the scenes and the sequences of a project folder. A folder with no project file is a
 * setup error, or an empty project with `optional`.
 */
export function readCheckProject(folder: string, options: { readonly optional?: boolean } = {}): CheckProject {
  const dir = resolve(folder);
  const file = join(dir, PROJECT_FILE);
  if (!existsSync(file) && options.optional !== true) throw new CheckSetupError(`${folder} has no ${PROJECT_FILE}.`);
  const registry = builtinRegistry();
  const text = existsSync(file) ? readFileSync(file, "utf8") : EMPTY_PROJECT;
  const read = readDocument(text, "project", { registry });
  if (!read.ok) throw readProblem(PROJECT_FILE, read.errors);
  const scenes = read.doc.scenes.map((path) => {
    const bytes = projectText(dir, path);
    const doc = readDocument(bytes.toString("utf8"), "scene", { registry });
    if (!doc.ok) throw readProblem(path, doc.errors);
    return { path, doc: doc.doc, hash: createHash("sha256").update(bytes).digest("hex") };
  });
  const sequences = (read.doc.sequences ?? []).map((path) => {
    const doc = readDocument(projectText(dir, path).toString("utf8"), "sequence", { registry });
    if (!doc.ok) throw readProblem(path, doc.errors);
    return { path, doc: doc.doc };
  });
  const rules = projectRules(dir);
  return { dir, project: read.doc, scenes, sequences, rules: rules.rules, problems: rules.problems };
}

/** The path of a file in the project folder (relative, with "/") from a path of the project or of the work folder. */
export function projectPath(project: CheckProject, path: string): string {
  const own = project.scenes.some((scene) => scene.path === path) || project.sequences.some((s) => s.path === path);
  if (own) return path;
  const near = relative(project.dir, resolve(path));
  if (near.startsWith("..") || isAbsolute(near)) throw new CheckSetupError(`${path} is not in the project folder.`);
  return near.split(sep).join("/");
}

/** Import the default export of a face file of a plugin; a setup error when it does not load in Bun. */
async function faceExport<Face>(entry: string, file: string, face: string): Promise<Face> {
  try {
    const module = (await import(pathToFileURL(file).href)) as { default: Face };
    return module.default;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new CheckSetupError(`The ${face} face of the plugin ${entry} does not load in Bun: ${reason}`);
  }
}

/**
 * The registries of the runtime faces of the project plugins: the component and presenter registries of a plugin
 * host. A project with no runtime face gets the built-in registries. The metric faces (`scenity.dev`) of the plugins
 * give their metric libraries to the rule check. The runtime faces also go to the core, so the check runs their
 * simulations and systems.
 */
export async function pluginRegistries(project: CheckProject): Promise<HeadlessRegistries> {
  const plugins = resolvePluginEntries(project.project.plugins ?? [], project.dir);
  const runtimes: RuntimePlugin[] = [];
  for (const plugin of plugins) {
    if (plugin.runtime !== undefined) {
      runtimes.push(await faceExport<RuntimePlugin>(plugin.entry, plugin.runtime, "runtime"));
    }
  }
  const metrics: MetricPlugin[] = [];
  for (const plugin of plugins) {
    if (plugin.dev !== undefined) metrics.push(await faceExport<MetricPlugin>(plugin.entry, plugin.dev, "metric"));
  }
  const withMetrics = metrics.length === 0 ? {} : { metrics };
  if (runtimes.length === 0) return withMetrics;
  const host = new PluginHost(runtimes);
  return { registry: host.components, presenters: host.presenters, plugins: runtimes, ...withMetrics };
}
