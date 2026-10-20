// SPDX-License-Identifier: Apache-2.0
/**
 * The asset database. `AssetDatabase.open` reads the project file, finds the records
 * (`*.meta.json`) under the asset roots and the documents of the project, and keeps an index from the asset ID to
 * the paths, the kind, the tags, the hash, the dependencies and the outputs. The database gives the uses of an asset
 * ("used by"), the broken references and the problems. `update` reads the changed files again. `watch` calls
 * `update` for the changes on the disk. The outputs of an asset are the files `<id>.*` in the output folder of the
 * build. The watcher does not see that folder: after a build, call `update` with the output folder.
 */
import { existsSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadProject, formatErrors, PROJECT_FILE, type ProjectDocument } from "@scenity/scene";
import { resolveBuildSettings } from "./build/settings";
import { deriveIndex, type Derived } from "./derive";
import {
  documentKind,
  documentScanKey,
  documentSuffix,
  listedDocuments,
  scanDocument,
  type DocumentScan,
} from "./documents";
import { isFolder, isUnder, listFiles, nodeProjectFs } from "./files";
import { RECORD_SUFFIX } from "./record";
import { readRecordState, recordStateId, recordStateKey, type RecordState } from "./records";
import type { AssetChange, AssetEntry, AssetProblem, AssetUse } from "./types";
import { watchProject, type AssetWatcher, type WatchOptions } from "./watch";

/** The error of `AssetDatabase.open` when the project file does not read. */
export class ProjectReadError extends Error {
  override readonly name = "ProjectReadError";
}

/** The asset database of one project folder. */
export class AssetDatabase {
  /** The absolute path of the project folder. */
  readonly dir: string;
  private projectDoc: ProjectDocument;
  private readonly records = new Map<string, RecordState>();
  private readonly documents = new Map<string, DocumentScan>();
  private readonly assetFiles = new Set<string>();
  /** The files in the output folder of the build, as project paths in sorted order. */
  private outputFiles: readonly string[] = [];
  private derived: Derived;

  private constructor(dir: string, project: ProjectDocument) {
    this.dir = dir;
    this.projectDoc = project;
    this.derived = this.derive();
  }

  /** Open the database of a project folder: read the project file and scan the asset roots and the documents. */
  static async open(projectDir: string): Promise<AssetDatabase> {
    const dir = resolve(projectDir);
    const db = new AssetDatabase(dir, await readProject(dir));
    db.scanAll();
    return db;
  }

  /** The project document. */
  get project(): ProjectDocument {
    return this.projectDoc;
  }

  /** The asset roots of the project, relative to the project folder. A project with no `assets` list has no roots. */
  get roots(): readonly string[] {
    return (this.projectDoc.assets ?? []).map(cleanPath);
  }

  /** The output folder of the build, relative to the project folder. */
  get outputDir(): string {
    return cleanPath(resolveBuildSettings(this.projectDoc).output);
  }

  /** The entries of the index, in the order of their IDs. */
  entries(): AssetEntry[] {
    return [...this.derived.index.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /** The entry of an asset ID. */
  get(id: string): AssetEntry | undefined {
    return this.derived.index.get(id);
  }

  /** The entry whose source or record has this project path. */
  findByPath(path: string): AssetEntry | undefined {
    return this.entries().find((entry) => entry.sourcePath === path || entry.recordPath === path);
  }

  /** All problems: bad records, duplicate IDs, missing sources and files, broken references and bad documents. */
  problems(): readonly AssetProblem[] {
    return this.derived.problems;
  }

  /** The references to an asset ID that no record has, with the document and the JSON Pointer of each. */
  missing(): readonly AssetUse[] {
    return this.derived.broken;
  }

  /** The documents and the entities that refer to an asset ("used by"). Record dependencies are not in the list. */
  usedBy(id: string): AssetUse[] {
    return (this.derived.uses.get(id) ?? []).filter((use) => !use.document.endsWith(RECORD_SUFFIX));
  }

  /** The IDs of the assets whose records list this asset in `dependencies`. */
  dependents(id: string): string[] {
    const records = (this.derived.uses.get(id) ?? []).filter((use) => use.document.endsWith(RECORD_SUFFIX));
    const ids = records.map((use) => this.findByPath(use.document)?.id).filter((item) => item !== undefined);
    return [...new Set(ids)].sort();
  }

  /** The IDs of the assets that an asset needs, from its record. */
  dependencies(id: string): readonly string[] {
    return this.get(id)?.dependencies ?? [];
  }

  /** Read the project file again and scan all files again. */
  async rescan(): Promise<void> {
    this.projectDoc = await readProject(this.dir);
    this.scanAll();
  }

  /**
   * Read the changed paths again (project paths of files or folders) and update the index. The result names the
   * asset IDs whose entries changed and the documents whose references changed. A change of the project file
   * scans all files again and names all IDs.
   */
  async update(paths: Iterable<string>): Promise<AssetChange> {
    const list = [...paths].map(cleanPath);
    if (list.includes(PROJECT_FILE)) return this.updateAll();
    const { recordPaths, documentPaths } = this.affected(list);
    const ids = new Set<string>(this.updateOutputs(list));
    for (const path of recordPaths) {
      const before = this.records.get(path);
      const after = readRecordState(this.dir, path);
      if (recordStateKey(before) === recordStateKey(after)) continue;
      for (const id of [recordStateId(before), recordStateId(after)]) if (id !== undefined) ids.add(id);
      if (after === undefined) this.records.delete(path);
      else this.records.set(path, after);
    }
    const documents: string[] = [];
    for (const path of documentPaths) {
      const before = this.documents.get(path);
      const after = scanDocument(this.dir, path, this.kindOf(path));
      if (documentScanKey(before) === documentScanKey(after)) continue;
      documents.push(path);
      if (after === undefined) this.documents.delete(path);
      else this.documents.set(path, after);
    }
    this.derived = this.derive();
    return { ids: [...ids].sort(), documents: documents.sort() };
  }

  /**
   * Watch the project folder (`fs.watch`, recursive) and update the index after each change. The callback gets the
   * changed asset IDs and the changed documents, after a quiet time of `debounceMs`.
   */
  watch(
    onChange: (ids: readonly string[], documents: readonly string[]) => void,
    options: WatchOptions = {},
  ): AssetWatcher {
    return watchProject(this.dir, (paths) => this.update(paths), onChange, options);
  }

  private async updateAll(): Promise<AssetChange> {
    const beforeIds = entryKeys(this.derived.index);
    const beforeDocs = documentKeys(this.documents);
    await this.rescan();
    return {
      ids: changedKeys(beforeIds, entryKeys(this.derived.index)),
      documents: changedKeys(beforeDocs, documentKeys(this.documents)),
    };
  }

  /** The record paths and the document paths that a list of changed paths can change. */
  private affected(paths: readonly string[]): { recordPaths: Set<string>; documentPaths: Set<string> } {
    const recordPaths = new Set<string>();
    const documentPaths = new Set<string>();
    const touch = (file: string, exists: boolean) => {
      if (this.isAssetPath(file)) {
        if (exists) this.assetFiles.add(file);
        else this.assetFiles.delete(file);
        if (file.endsWith(RECORD_SUFFIX)) recordPaths.add(file);
      }
      if (this.isDocumentPath(file)) documentPaths.add(file);
      for (const state of this.records.values()) {
        if (state.ok && state.entry.files.includes(file)) recordPaths.add(state.recordPath);
      }
    };
    for (const path of paths) {
      const absolute = join(this.dir, path);
      if (isFolder(absolute)) for (const file of listFiles(this.dir, path)) touch(file, true);
      else touch(path, existsSync(absolute));
      // A folder that moved or that the user removed gives one event for the folder.
      // Thus each known file under that folder changes.
      for (const file of [...this.assetFiles])
        if (isUnder(file, path) && !existsSync(join(this.dir, file))) touch(file, false);
      for (const record of this.records.keys()) if (isUnder(record, path)) recordPaths.add(record);
      for (const document of this.documents.keys()) if (isUnder(document, path)) documentPaths.add(document);
    }
    return { recordPaths, documentPaths };
  }

  /** List the output folder again when a path is in it. The result has the IDs of the changed output files. */
  private updateOutputs(paths: readonly string[]): string[] {
    const output = this.outputDir;
    if (!paths.some((path) => isUnder(path, output) || isUnder(output, path))) return [];
    const before = new Set(this.outputFiles);
    this.outputFiles = this.listOutputs();
    const after = new Set(this.outputFiles);
    const changed = [...before].filter((file) => !after.has(file));
    changed.push(...[...after].filter((file) => !before.has(file)));
    const ids = changed.map((file) => outputId(file)).filter((id) => this.derived.index.has(id));
    return [...new Set(ids)];
  }

  /** The files directly in the output folder, as project paths in sorted order. */
  private listOutputs(): string[] {
    const output = this.outputDir;
    try {
      const names = readdirSync(join(this.dir, output), { withFileTypes: true });
      return names
        .filter((item) => item.isFile())
        .map((item) => `${output}/${item.name}`)
        .sort();
    } catch {
      return [];
    }
  }

  private scanAll(): void {
    this.outputFiles = this.listOutputs();
    this.records.clear();
    this.documents.clear();
    this.assetFiles.clear();
    const listed = new Set(this.listed());
    for (const file of listFiles(this.dir, "")) {
      if (this.isAssetPath(file)) this.assetFiles.add(file);
      if (this.isAssetPath(file) && file.endsWith(RECORD_SUFFIX)) {
        const state = readRecordState(this.dir, file);
        if (state !== undefined) this.records.set(file, state);
      }
      if (this.isDocumentPath(file)) listed.add(file);
    }
    for (const path of listed) {
      const scan = scanDocument(this.dir, path, this.kindOf(path));
      if (scan !== undefined) this.documents.set(path, scan);
    }
    this.derived = this.derive();
  }

  private derive(): Derived {
    return deriveIndex({
      records: this.records.values(),
      documents: this.documents.values(),
      listed: this.listed(),
      assetFiles: this.assetFiles,
      outputFiles: this.outputFiles,
    });
  }

  private listed(): string[] {
    return listedDocuments(this.projectDoc).map(cleanPath);
  }

  private kindOf(path: string): "scene" | "prefab" | undefined {
    return this.projectDoc.scenes.map(cleanPath).includes(path) ? "scene" : documentKind(path);
  }

  private isAssetPath(path: string): boolean {
    return this.roots.some((root) => isUnder(path, root));
  }

  private isDocumentPath(path: string): boolean {
    return documentSuffix(path) !== undefined || this.listed().includes(path);
  }
}

async function readProject(dir: string): Promise<ProjectDocument> {
  const loaded = await loadProject(dir, nodeProjectFs);
  if (!loaded.ok) throw new ProjectReadError(`${loaded.file}:\n${formatErrors(loaded.errors)}`);
  return loaded.project;
}

function entryKeys(index: ReadonlyMap<string, AssetEntry>): Map<string, string> {
  return new Map([...index].map(([id, entry]) => [id, JSON.stringify(entry)]));
}

function documentKeys(documents: ReadonlyMap<string, DocumentScan>): Map<string, string> {
  return new Map([...documents].map(([path, scan]) => [path, documentScanKey(scan)]));
}

/** The keys of two maps whose values differ, in sorted order. */
function changedKeys(before: ReadonlyMap<string, string>, after: ReadonlyMap<string, string>): string[] {
  const keys = new Set([...before.keys(), ...after.keys()]);
  return [...keys].filter((key) => before.get(key) !== after.get(key)).sort();
}

/** The asset ID of an output file: the file name before the first dot. */
function outputId(file: string): string {
  const name = file.slice(file.lastIndexOf("/") + 1);
  return name.slice(0, name.indexOf("."));
}

/** A project path with no `./` at the start and no `/` at the end. */
function cleanPath(path: string): string {
  return path.replace(/^(\.\/)+/, "").replace(/\/+$/, "");
}
