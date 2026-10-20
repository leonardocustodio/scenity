// SPDX-License-Identifier: Apache-2.0
/**
 * The scene files of a project on the disk. The workbench host and the dev server of the scene page use the same
 * functions:
 *
 * - a read gives the text of a `*.scene.json` file and the SHA-256 of the text;
 * - a save checks the path (in the project folder, a `*.scene.json` name, not on the denylist of the caller), reads
 *   the document with the reader of `@scenity/scene` and writes its canonical form (`writeDocument`);
 * - a save refuses a file that changed on the disk after the load (another hash than `baseHash`), unless `force`;
 * - a save refuses a scene with a failed `block` rule, unless the owner gives a reason (ruleGate.ts);
 * - the write is atomic: a temp file in the same folder, then a rename over the file.
 *
 * The same read and save take a `*.sequence.json` file (the sequencer of the scene page): the writer reads it
 * as a sequence document, and the rule gate knows the rules of the sequence and of the project.
 *
 * The same read and save take a `*.material.json` file (the material editor of the scene page): the writer
 * reads it as a material document. A material has no rules, so the rule gate has nothing to check.
 *
 * The same read and save take a `*.prefab.json` file (the prefab mode of the scene page and an apply of
 * overrides): the writer reads it as a prefab document. The rules are for scenes, so a prefab has no rule to check.
 *
 * The same read and save take `scenity.editor.json` at the project root (the editor settings of a project): the
 * writer reads it as an editor settings document, with no rule to check.
 *
 * The same read and save also take a notes document and an override layer (a variant of a scene), with no rule to
 * check.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, realpathSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import {
  builtinRegistry,
  readDocument,
  writeDocument,
  type ComponentRegistry,
  type SceneDocument,
  type SequenceDocument,
} from "@scenity/scene";
import { readEditorDocument } from "@scenity/scene/schema/editor";
import { readNotesDocument } from "@scenity/scene/schema/notes";
import {
  isSceneCreateParams,
  savedFileKind,
  sceneFilePathProblem,
  type SceneCreateParams,
  type SceneCreateResult,
  type SceneFileText,
  type SceneSaveParams,
  type SceneSaveResult,
} from "./contract";
import { logOverride, sceneRuleGate, sequenceWriterRules, writerRules, type WriterRules } from "./ruleGate";

export * from "./contract";

/** The checks of the caller. */
export interface SceneFileOptions {
  /** True for a path that the caller never reads or writes (the denylist of the workbench host). */
  readonly denied?: (path: string) => boolean;
  /** The component registry of the reader (default: the built-in components; unknown components stay as they are). */
  readonly registry?: ComponentRegistry;
}

/**
 * The SHA-256 of a scene text (hex): the hash of a read, of a save and of the base of a save. The page computes the
 * same hash of the UTF-8 bytes (`sceneTextHash` of `@scenity/editor-core`).
 */
export function sceneTextHash(text: string | Uint8Array): string {
  return createHash("sha256").update(text).digest("hex");
}

/** True when `path` is the folder `root` or a path in it. */
function inside(root: string, path: string): boolean {
  const near = relative(root, path);
  return near === "" || (!near.startsWith("..") && !isAbsolute(near));
}

/**
 * The absolute file of a scene path in the project folder. It throws an error for a bad path, a path of the denylist,
 * or a path that a link takes out of the folder.
 */
export function sceneFilePath(root: string, path: string, options: SceneFileOptions = {}): string {
  const problem = sceneFilePathProblem(path);
  if (problem !== null) throw new Error(problem);
  if (options.denied?.(path) === true) throw new Error(`The project does not let the editor write ${path}.`);
  const base = realpathSync(resolve(root));
  const file = resolve(base, ...path.split("/"));
  // A link in the folder can point out of the project: the real folder of the file must be in the real root.
  let folder = dirname(file);
  while (!existsSync(folder) && inside(base, folder)) folder = dirname(folder);
  if (!inside(base, file) || !inside(base, realpathSync(folder))) {
    throw new Error(`The scene file ${path} is not in the project folder.`);
  }
  if (existsSync(file) && !inside(base, realpathSync(file))) {
    throw new Error(`The scene file ${path} is a link out of the project folder.`);
  }
  return file;
}

/** Read a scene file of the project. It throws an error for a bad path or a missing file. */
export function readSceneFile(root: string, path: string, options: SceneFileOptions = {}): SceneFileText {
  const file = sceneFilePath(root, path, options);
  if (!existsSync(file)) throw new Error(`The project has no scene file ${path}.`);
  const bytes = readFileSync(file);
  return { path, text: bytes.toString("utf8"), hash: sceneTextHash(bytes) };
}

/** The canonical text of a sequence document text, or the reason why it does not read. */
export function canonicalSequenceText(
  text: string,
): { ok: true; text: string; doc: SequenceDocument } | { ok: false; reason: string } {
  const read = readDocument(text, "sequence", { registry: builtinRegistry() });
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The sequence does not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc), doc: read.doc };
}

/** The canonical text of a note document text, or the reason why it does not read. */
export function canonicalNotesText(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const read = readNotesDocument(text);
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The notes do not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc) };
}

/** The canonical text of an override layer text (a variant of a scene), or the reason why it does not read. */
export function canonicalOverridesText(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const read = readDocument(text, "overrides");
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The override layer does not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc) };
}

/** The canonical text of a material document text, or the reason why it does not read. */
export function canonicalMaterialText(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const read = readDocument(text, "material");
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The material does not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc) };
}

/** The canonical text of a prefab document text, or the reason why it does not read. */
export function canonicalPrefabText(
  text: string,
  registry?: ComponentRegistry,
): { ok: true; text: string } | { ok: false; reason: string } {
  const read = readDocument(text, "prefab", { registry: registry ?? builtinRegistry() });
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The prefab does not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc) };
}

/** The canonical text of an editor settings text (`scenity.editor.json`), or the reason why it does not read. */
export function canonicalEditorText(text: string): { ok: true; text: string } | { ok: false; reason: string } {
  const read = readEditorDocument(text, "editor");
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The editor settings do not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc) };
}

/** The canonical text of a saved file (each kind of `savedFileKind`) and the rules of the writer. */
function canonicalFile(
  root: string,
  path: string,
  text: string,
  registry?: ComponentRegistry,
): { ok: true; text: string; rules: WriterRules } | { ok: false; reason: string } {
  if (savedFileKind(path) === "editor") {
    const editor = canonicalEditorText(text);
    return editor.ok ? { ok: true, text: editor.text, rules: { rules: [], problems: [] } } : editor;
  }
  if (savedFileKind(path) === "notes") {
    const notes = canonicalNotesText(text);
    return notes.ok ? { ok: true, text: notes.text, rules: { rules: [], problems: [] } } : notes;
  }
  if (savedFileKind(path) === "overrides") {
    const layer = canonicalOverridesText(text);
    return layer.ok ? { ok: true, text: layer.text, rules: { rules: [], problems: [] } } : layer;
  }
  if (savedFileKind(path) === "material") {
    const material = canonicalMaterialText(text);
    return material.ok ? { ok: true, text: material.text, rules: { rules: [], problems: [] } } : material;
  }
  if (savedFileKind(path) === "prefab") {
    const prefab = canonicalPrefabText(text, registry);
    return prefab.ok ? { ok: true, text: prefab.text, rules: { rules: [], problems: [] } } : prefab;
  }
  if (savedFileKind(path) === "sequence") {
    const sequence = canonicalSequenceText(text);
    return sequence.ok ? { ok: true, text: sequence.text, rules: sequenceWriterRules(root, sequence.doc) } : sequence;
  }
  const scene = canonicalSceneText(text, registry);
  return scene.ok ? { ok: true, text: scene.text, rules: writerRules(root, scene.doc) } : scene;
}

/** The canonical text of a scene document text, or the reason why it does not read. */
export function canonicalSceneText(
  text: string,
  registry?: ComponentRegistry,
): { ok: true; text: string; doc: SceneDocument } | { ok: false; reason: string } {
  const read = readDocument(text, "scene", { registry: registry ?? builtinRegistry() });
  if (!read.ok) {
    const first = read.errors.slice(0, 3).map((error) => `${error.path || "/"}: ${error.message}`);
    return { ok: false, reason: `The scene does not read: ${first.join("; ")}` };
  }
  return { ok: true, text: writeDocument(read.doc), doc: read.doc };
}

let tempCount = 0;

/** Write a text to a file through a temp file in the same folder and a rename (an atomic replace). */
export function writeAtomic(file: string, text: string): void {
  tempCount += 1;
  const tag = `${String(process.pid)}.${Date.now().toString(36)}.${String(tempCount)}`;
  const temp = join(dirname(file), `.${basename(file)}.${tag}.tmp`);
  try {
    writeFileSync(temp, text);
    renameSync(temp, file);
  } catch (error) {
    rmSync(temp, { force: true });
    throw error;
  }
}

/** Save a scene file of the project: see the module comment. A refusal is a result, not an error. */
export function saveSceneFile(root: string, params: SceneSaveParams, options: SceneFileOptions = {}): SceneSaveResult {
  const { path } = params;
  let file: string;
  try {
    file = sceneFilePath(root, path, options);
  } catch (error) {
    return { ok: false, path, conflict: false, reason: error instanceof Error ? error.message : String(error) };
  }
  const canonical = canonicalFile(root, path, params.text, options.registry);
  if (!canonical.ok) return { ok: false, path, conflict: false, reason: canonical.reason };
  const disk = existsSync(file) ? readFileSync(file) : null;
  const diskHash = disk === null ? null : sceneTextHash(disk);
  if (params.force !== true && diskHash !== params.baseHash) return { ok: false, path, conflict: true, hash: diskHash };
  // The one gate of the rules: a failed block rule needs a reason of the owner.
  const gate = sceneRuleGate(canonical.rules, params, sceneTextHash(params.text));
  if (!gate.allowed) return { ok: false, path, conflict: false, reason: gate.message, blocked: gate.blocks };
  const hash = sceneTextHash(canonical.text);
  const extra = {
    ...(gate.override === null ? {} : { override: gate.override }),
    ...(gate.warns.length === 0 ? {} : { warned: gate.warns }),
  };
  const changed = hash !== diskHash;
  // A new file (no file on the disk, no base hash) can make its folder in the project, for example the first
  // prefab in `prefabs/`; the path is in the project folder (sceneFilePath). A change of a file needs its folder.
  if (changed && !existsSync(dirname(file))) {
    if (disk !== null || params.baseHash !== null)
      return { ok: false, path, conflict: false, reason: `No folder for ${path}.` };
    mkdirSync(dirname(file), { recursive: true });
  }
  if (changed) writeAtomic(file, canonical.text);
  if (gate.override !== null) logOverride(file, path, hash, gate);
  return { ok: true, path, hash, text: canonical.text, changed, ...extra };
}

/** The name of the project file in a project folder. */
const PROJECT_FILE = "scenity.project.json";

/**
 * List a new scene path in the project file, when the project file lists its scenes (a list that is not
 * empty). A project file that does not read, or a file of the denylist, stays as it is. True when the file lists it.
 */
function listInProject(root: string, path: string, options: SceneFileOptions): boolean {
  const file = join(realpathSync(resolve(root)), PROJECT_FILE);
  if (!existsSync(file) || options.denied?.(PROJECT_FILE) === true) return false;
  const read = readDocument(readFileSync(file, "utf8"), "project");
  if (!read.ok) return false;
  const scenes = read.doc.scenes;
  if (scenes.includes(path)) return true;
  if (scenes.length === 0) return false;
  const next = { ...read.doc, scenes: [...scenes, path] };
  writeAtomic(file, writeDocument(next));
  return true;
}

/**
 * Create a new scene file of the project: the empty scene document of the ID and the name, in its canonical
 * form. It refuses a bad path, a path of the denylist, a link out of the project and a file that is there already. A
 * refusal is a result, not an error.
 */
export function createSceneFile(
  root: string,
  params: SceneCreateParams,
  options: SceneFileOptions = {},
): SceneCreateResult {
  const path = typeof params.path === "string" ? params.path : "";
  if (!isSceneCreateParams(params)) {
    return { ok: false, path, reason: "A create needs a scene path, an ID and a name of 1 to 200 characters." };
  }
  let file: string;
  try {
    file = sceneFilePath(root, path, options);
  } catch (error) {
    return { ok: false, path, reason: error instanceof Error ? error.message : String(error) };
  }
  if (existsSync(file)) return { ok: false, path, reason: `The project has a file ${path} already.` };
  const doc = { format: "scenity.scene/1", id: params.sceneId, name: params.name.trim(), entities: {} };
  const canonical = canonicalSceneText(JSON.stringify(doc), options.registry);
  if (!canonical.ok) return { ok: false, path, reason: canonical.reason };
  mkdirSync(dirname(file), { recursive: true });
  try {
    // The "wx" flag never replaces a file that another writer made in the meantime.
    writeFileSync(file, canonical.text, { flag: "wx" });
  } catch (error) {
    return { ok: false, path, reason: error instanceof Error ? error.message : String(error) };
  }
  const listed = listInProject(root, path, options);
  return { ok: true, path, hash: sceneTextHash(canonical.text), text: canonical.text, listed };
}
