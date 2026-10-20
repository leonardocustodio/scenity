// SPDX-License-Identifier: Apache-2.0
/**
 * The content of a player: the scene, the sequence and the asset manifest of a project, read and checked
 * with the reader of `@scenity/scene` on the page. The core gets them in one "load" message and does not parse them
 * again.
 *
 * The asset manifest comes from, in this order:
 *
 * 1. `manifestUrl`: a built manifest (Manifest 2), checked with `parseAssetManifest` and the budgets of the project;
 * 2. the build of the project: `<build.assets.output>/manifest.json` (default "build");
 * 3. the asset index of a dev server (`assets.index.json`, apps/editor/scripts/projects.ts): one record per asset with
 *    its source file and no size and hash checks;
 * 4. else an empty manifest: the scene draws with no model.
 */
import { builtinRegistry } from "@scenity/scene/components";
import { readDocument } from "@scenity/scene/read";
import type { ProjectDocument } from "@scenity/scene";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument } from "@scenity/scene/sequence";
import {
  ASSET_MANIFEST_FORMAT,
  parseAssetManifest,
  type AssetBudgets,
  type AssetManifest,
} from "@scenity/runtime/manifest";
import type { PlayerOptions } from "./types";

/** A fetch function: the one of the page, or a fake of a test. */
export type PlayerFetch = (url: string) => Promise<Response>;

/** Where the asset files come from. */
export type AssetOrigin = "build" | "source" | "none";

export interface PlayerContent {
  readonly scene: SceneDocument;
  readonly sequence: SequenceDocument | null;
  readonly manifest: AssetManifest;
  /** The URL of each file of the records, by the file name of the record. */
  readonly files: Readonly<Record<string, string>>;
  readonly origin: AssetOrigin;
  readonly warnings: readonly string[];
  /** The project document (its quality tiers), or null with no project. */
  readonly project: ProjectDocument | null;
  /** The URL of the scene file (the base of its `poster`), or null for a scene document of the options. */
  readonly sceneUrl: string | null;
}

/** True for a JSON answer: a static server can answer a missing file with a page (an HTML 200). */
function isJson(response: Response): boolean {
  return response.ok && (response.headers.get("Content-Type") ?? "").includes("json");
}

async function readText(fetch: PlayerFetch, url: URL): Promise<string> {
  const response = await fetch(url.href);
  if (!response.ok) throw new Error(`no file at ${url.href} (${String(response.status)})`);
  return response.text();
}

/** Read and check a document of a kind; it throws with each error and its JSON Pointer. */
function parse<K extends "project" | "scene" | "sequence">(text: string, kind: K, url: string) {
  const result = readDocument(text, kind, { registry: builtinRegistry() });
  if (!result.ok) {
    const errors = result.errors.map((error) => `${error.path}: ${error.message}`).join("; ");
    throw new Error(`the ${kind} at ${url} is not valid: ${errors}`);
  }
  return result.doc;
}

/** The checked output folder of a project build. */
function outputOf(project: ProjectDocument): string {
  const output = project.build?.assets?.output ?? "build";
  if (!/^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/.test(output) || output.split("/").includes("..")) {
    throw new Error(`"${output}" is not an output folder of the project`);
  }
  return output;
}

/** A built manifest at `url` and the URL of each of its files, or null when the URL has no JSON. */
async function readBuilt(
  fetch: PlayerFetch,
  url: URL,
  budgets: AssetBudgets | undefined,
): Promise<{ manifest: AssetManifest; files: Record<string, string> } | null> {
  const response = await fetch(url.href);
  if (!isJson(response)) return null;
  const manifest = parseAssetManifest(await response.json(), budgets);
  const files: Record<string, string> = {};
  for (const record of manifest.records) {
    for (const file of record.files) files[file.file] = new URL(encodeURIComponent(file.file), url).href;
  }
  return { manifest, files };
}

/** One entry of the asset index of a dev server. */
interface AssetIndexEntry {
  readonly path: string;
  readonly kind: string;
}

/** The dev manifest from the asset index at `base`, or null when the server gives none. */
async function readIndex(
  fetch: PlayerFetch,
  base: URL,
): Promise<{ manifest: AssetManifest; files: Record<string, string> } | null> {
  const response = await fetch(new URL("assets.index.json", base).href);
  if (!isJson(response)) return null;
  const index = (await response.json()) as Readonly<Record<string, AssetIndexEntry>>;
  const files: Record<string, string> = {};
  const records = Object.keys(index)
    .sort()
    .map((id) => {
      const entry = index[id] ?? { path: "", kind: "model" };
      files[entry.path] = new URL(entry.path, base).href;
      const file = { file: entry.path, bytes: 0, sha256: "" };
      return { id, kind: entry.kind, lods: [], files: [file], bytes: 0, sha256: "", stats: {}, tags: [] };
    });
  return { manifest: { format: ASSET_MANIFEST_FORMAT, tiers: [], records }, files };
}

const NO_MANIFEST: AssetManifest = { format: ASSET_MANIFEST_FORMAT, tiers: [], records: [] };

/** The asset manifest of the player: `manifestUrl`, the project build, the dev asset index, else none. */
async function readAssets(
  fetch: PlayerFetch,
  manifestUrl: URL | null,
  project: { readonly doc: ProjectDocument; readonly base: URL } | null,
) {
  const budgets = project?.doc.quality?.budgets as AssetBudgets | undefined;
  if (manifestUrl !== null) {
    const built = await readBuilt(fetch, manifestUrl, budgets);
    if (built === null) throw new Error(`no asset manifest at ${manifestUrl.href}`);
    return { ...built, origin: "build" as const };
  }
  if (project === null) return { manifest: NO_MANIFEST, files: {}, origin: "none" as const };
  const built = await readBuilt(fetch, new URL(`${outputOf(project.doc)}/manifest.json`, project.base), budgets);
  if (built !== null) return { ...built, origin: "build" as const };
  const index = await readIndex(fetch, project.base);
  if (index !== null) return { ...index, origin: "source" as const };
  return { manifest: NO_MANIFEST, files: {}, origin: "none" as const };
}

/** The scene document of the options: a document, a path, or the first scene of the project. */
async function readScene(
  fetch: PlayerFetch,
  options: PlayerOptions,
  base: URL,
  project: ProjectDocument | null,
): Promise<SceneDocument> {
  if (typeof options.scene === "object") return options.scene;
  const path = options.scene ?? project?.scenes[0];
  if (path === undefined) throw new Error("the player has no scene: give `scene` or a project with a scene");
  const url = new URL(path, base);
  return parse(await readText(fetch, url), "scene", url.href);
}

/**
 * The sequence of the options: a document, a path, null for none, or the first sequence of the project for the
 * scene. A project sequence for another scene is not the default.
 */
async function readSequence(
  fetch: PlayerFetch,
  options: PlayerOptions,
  base: URL,
  project: ProjectDocument | null,
  scene: SceneDocument,
): Promise<SequenceDocument | null> {
  if (options.sequence === null) return null;
  if (typeof options.sequence === "object") return options.sequence;
  if (options.sequence !== undefined) {
    const url = new URL(options.sequence, base);
    return parse(await readText(fetch, url), "sequence", url.href);
  }
  for (const path of project?.sequences ?? []) {
    const url = new URL(path, base);
    const sequence = parse(await readText(fetch, url), "sequence", url.href);
    if (sequence.scene === scene.id) return sequence;
  }
  return null;
}

/** Read the content of a player. `page` is the URL that relative option URLs resolve against. */
export async function loadContent(options: PlayerOptions, fetch: PlayerFetch, page: string): Promise<PlayerContent> {
  if (options.project === undefined && options.manifestUrl === undefined && typeof options.scene !== "object") {
    throw new Error("the player needs `project`, `manifestUrl` or a scene document");
  }
  const projectUrl = options.project === undefined ? null : new URL(options.project, page);
  const doc = projectUrl === null ? null : parse(await readText(fetch, projectUrl), "project", projectUrl.href);
  const base = projectUrl ?? new URL(page);
  const project = doc === null || projectUrl === null ? null : { doc, base: projectUrl };
  const manifestUrl = options.manifestUrl === undefined ? null : new URL(options.manifestUrl, page);
  const [scene, assets] = await Promise.all([
    readScene(fetch, options, base, doc),
    readAssets(fetch, manifestUrl, project),
  ]);
  const raw = await readSequence(fetch, options, base, doc, scene);
  // The `loop` option replaces the loop of the sequence, so the clock, the evaluator and the core agree.
  const sequence = raw === null || options.loop === undefined ? raw : { ...raw, loop: options.loop };
  const scenePath = typeof options.scene === "object" ? undefined : (options.scene ?? doc?.scenes[0]);
  const sceneUrl = scenePath === undefined ? null : new URL(scenePath, base).href;
  // The document core runs the project plugins (the plugin module of the build), so a plugin gives no warning.
  return { scene, sequence, ...assets, warnings: [], project: doc, sceneUrl };
}
