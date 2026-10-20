// SPDX-License-Identifier: Apache-2.0
/**
 * The prefabs of the scene page. Before the first load, the page reads each prefab file that the instances of its
 * document name (with the nested prefabs) through the scene file port. The "load" message carries them (`prefabs` of
 * the documents). The core draws and picks the expanded document, so the entities of each prefab are real entities of
 * the view. A page with no instance reads no prefab file and sends no prefabs.
 *
 * The prefab set is a channel of the one history of the page editor (sceneEditor.ts). The files of the prefabs are
 * attached files of the save: Save writes each changed prefab through the canonical writer after the scene.
 *
 * The prefab mode: a page with `scene=<path>.prefab.json` opens the prefab document itself, with the same editor
 * tools. `prefabUrl` gives the URL of the prefab mode of a prefab, with `from` (the scene to return to).
 */
import {
  hasInstances,
  loadPrefabSet,
  PREFAB_SUFFIX,
  PrefabExpander,
  SceneFile,
  type PrefabPaths,
  type PrefabSet,
} from "@scenity/editor-core";
import { builtinRegistry, readDocument, type ComponentRegistry } from "@scenity/scene";
import type { PrefabDocument, SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneLoad, ScenePrefabs } from "@scenity/runtime/protocol";
import { defaultSequencePath } from "../clock";
import { editRegistry } from "../pageRegistry";
import { parseScene } from "../project";
import type { AttachedFile, PageSaveResult, ScenePageEditor } from "../sceneEditor";
import type { SceneFilePort } from "../sceneFiles";
import { t } from "../../texts";

/** The prefabs of the page at the load. */
export interface PagePrefabs {
  readonly expander: PrefabExpander;
  readonly set: PrefabSet;
  /** The file state of each prefab file (the text and the hash at the load or the last save). */
  readonly files: ReadonlyMap<string, SceneFile>;
  /** The prefabs of a "load" message for a set, or undefined when the document has no instance. */
  load(set: PrefabSet): ScenePrefabs | undefined;
  /** The `prefabs` part of the documents of the first "load" (empty when the document has no instance). */
  readonly documents: { readonly prefabs?: ScenePrefabs };
  /** Read a prefab file that the page did not load yet (a new instance); undefined when it does not read. */
  read(path: string): Promise<PrefabDocument | undefined>;
  /** Keep the file state of a prefab file that the page wrote (a new prefab). */
  keep(path: string, doc: PrefabDocument, text: string): void;
}

/** True when the path is the path of a prefab file: the page opens it in the prefab mode. */
export function isPrefabPath(path: string): boolean {
  return path.endsWith(PREFAB_SUFFIX);
}

/** The project path of the source file of each asset (the asset index of the project, scripts/projects.ts). */
async function assetPaths(base: string): Promise<ReadonlyMap<string, string>> {
  const response = await fetch(`${base}assets.index.json`).catch(() => null);
  if (response?.ok !== true) return new Map();
  const index = (await response.json()) as Readonly<Record<string, { readonly path?: unknown }>>;
  const out = new Map<string, string>();
  for (const [id, entry] of Object.entries(index)) if (typeof entry.path === "string") out.set(id, entry.path);
  return out;
}

/**
 * Read the prefabs of a document. A missing file or a prefab that does not read gives a warning, and its instances
 * show no prefab entities (the report of the expansion names them).
 */
export async function loadPagePrefabs(parts: {
  readonly base: string;
  readonly path: string;
  readonly doc: SceneDocument;
  readonly files: SceneFilePort;
  readonly registry?: ComponentRegistry | undefined;
}): Promise<PagePrefabs> {
  const registry = parts.registry ?? builtinRegistry();
  const assets = hasInstances(parts.doc) ? await assetPaths(parts.base) : new Map<string, string>();
  const paths: PrefabPaths = { docPath: parts.path, assetPath: (id) => assets.get(id) };
  const files = new Map<string, SceneFile>();
  const read = async (path: string): Promise<PrefabDocument | undefined> => {
    const file = await parts.files.read(path).catch(() => null);
    if (file === null) {
      console.warn(`no prefab file ${path}`);
      return undefined;
    }
    const result = readDocument(file.text, "prefab", { registry });
    if (!result.ok) {
      console.warn(`the prefab ${path} does not read: ${result.errors[0]?.message ?? ""}`);
      return undefined;
    }
    files.set(path, new SceneFile(path, result.doc, file.text));
    return result.doc;
  };
  const set = await loadPrefabSet(parts.doc, paths, read);
  const known = Object.fromEntries(assets);
  // A page with no instance at the load sends prefabs after its first prefab.
  const active = hasInstances(parts.doc);
  const load = (value: PrefabSet): ScenePrefabs | undefined =>
    active || Object.keys(value).length > 0 ? { path: parts.path, set: value, assets: known } : undefined;
  const first = load(set);
  const documents = first === undefined ? {} : { prefabs: first };
  const keep = (path: string, doc: PrefabDocument, text: string): void => {
    files.set(path, new SceneFile(path, doc, text));
  };
  return { expander: new PrefabExpander(paths, registry), set, files, load, documents, read, keep };
}

/**
 * The prefab files as an attached file of the save: dirty when a prefab document differs from its file, and a save
 * that writes each changed prefab. The first refusal stops the save and is its result.
 */
export function prefabFiles(editor: ScenePageEditor, loaded: PagePrefabs, port: SceneFilePort): AttachedFile {
  const changed = (): [string, SceneFile, PrefabDocument][] =>
    [...loaded.files].flatMap(([path, file]) => {
      const doc = editor.prefabs[path];
      return doc !== undefined && file.dirty(doc) ? [[path, file, doc] as [string, SceneFile, PrefabDocument]] : [];
    });
  return {
    dirty: () => changed().length > 0,
    async save(force, reason): Promise<PageSaveResult> {
      let last: PageSaveResult | null = null;
      for (const [, file, doc] of changed()) {
        const result = await port.save({ ...file.saveRequest(doc, force), ...(reason === "" ? {} : { reason }) });
        if (!result.ok) return result;
        file.saved(result.text, result.hash);
        last = result;
      }
      return last ?? { ok: false, conflict: false, reason: t("prefab-no-file") };
    },
  };
}

/** The URL of the prefab mode of a prefab file; `from` is the path of the scene to return to. */
export function prefabUrl(location: Location | URL, path: string, from: string): string {
  const url = new URL(location.href);
  for (const key of ["camera", "view", "sel", "sequence", "t", "paused"]) url.searchParams.delete(key);
  url.searchParams.set("scene", path);
  url.searchParams.set("from", from);
  url.searchParams.set("edit", "1");
  return url.toString();
}

/** The document of a scene file text: a scene, or in the prefab mode a prefab that the page edits as its scene. */
export function parseDocument(path: string, text: string): SceneDocument | null {
  if (!isPrefabPath(path)) return null;
  const result = readDocument(text, "prefab", { registry: builtinRegistry() });
  if (!result.ok) throw new Error(result.errors.map((error) => `${error.path}: ${error.message}`).join("; "));
  // The ops, the runtime and the writer read only the entity map and the format: a prefab goes where a scene goes.
  return result.doc as unknown as SceneDocument;
}

/**
 * The document of the page, its component registry and its prefabs. The path of a prefab file opens the prefab mode:
 * the page edits the prefab document as its scene.
 */
export async function pageDocument(
  params: URLSearchParams,
  path: string,
  text: string,
  files: SceneFilePort,
): Promise<{ readonly scene: SceneDocument; readonly registry: ComponentRegistry | undefined; prefabs: PagePrefabs }> {
  const project = params.get("project") ?? "showroom";
  const scene = parseDocument(path, text) ?? parseScene(text);
  const registry = await editRegistry(params, project);
  const prefabs = await loadPagePrefabs({ base: `/projects/${project}/`, path, doc: scene, files, registry });
  return { scene, registry, prefabs };
}

/** The sequence of the page: the `sequence` parameter, else the first sequence of the project; none for a prefab. */
export async function sequencePathOf(params: URLSearchParams, base: string, path: string): Promise<string | null> {
  return params.get("sequence") ?? (isPrefabPath(path) ? null : await defaultSequencePath(base));
}

/** The send of a new prefab set to a core: a "load" with only `prefabs`. */
export function prefabLoad(client: { load(load: SceneLoad): Promise<unknown> }) {
  return (prefabs: ScenePrefabs): Promise<unknown> => client.load({ prefabs });
}
