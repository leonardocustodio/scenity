// SPDX-License-Identifier: Apache-2.0
/**
 * The index and the problems of the asset database from the state of the records and the documents. The functions
 * are pure: the database calls them again after each change.
 */
import { basename } from "node:path";
import type { DocumentScan } from "./documents";
import { RECORD_SUFFIX } from "./record";
import type { RecordState } from "./records";
import type { AssetEntry, AssetProblem, AssetUse } from "./types";

/** The input of `deriveIndex`. */
export interface DeriveInput {
  readonly records: Iterable<RecordState>;
  readonly documents: Iterable<DocumentScan>;
  /** The documents that the project lists. A listed document with no scan is missing. */
  readonly listed: readonly string[];
  /** The files under the asset roots. A missing source gets a hint from a file with the same name. */
  readonly assetFiles: ReadonlySet<string>;
  /** The files in the output folder of the build. The outputs of an asset are the files `<id>.*`. */
  readonly outputFiles?: readonly string[];
}

export interface Derived {
  readonly index: ReadonlyMap<string, AssetEntry>;
  /** The uses of each asset ID: the document references and the record dependencies. */
  readonly uses: ReadonlyMap<string, readonly AssetUse[]>;
  /** The references to an asset ID that no record has. */
  readonly broken: readonly AssetUse[];
  readonly problems: readonly AssetProblem[];
}

/** The index, the uses, the broken references and the problems. */
export function deriveIndex(input: DeriveInput): Derived {
  const problems: AssetProblem[] = [];
  const index = indexRecords(input, problems);
  const allUses: AssetUse[] = [];
  for (const entry of index.values()) {
    entry.dependencies.forEach((id, at) => {
      allUses.push({ id, document: entry.recordPath, pointer: `/dependencies/${String(at)}` });
    });
  }
  const documents = [...input.documents].sort((a, b) => compare(a.path, b.path));
  for (const scan of documents) {
    allUses.push(...scan.uses);
    for (const error of scan.errors) problems.push(documentProblem(scan.path, error.path, error.message));
  }
  const scanned = new Set(documents.map((scan) => scan.path));
  for (const path of input.listed) {
    if (!scanned.has(path)) {
      problems.push({
        code: "missing-document",
        file: path,
        message: "the project lists this document; it does not exist",
      });
    }
  }
  const uses = new Map<string, AssetUse[]>();
  const broken: AssetUse[] = [];
  for (const use of allUses) {
    if (!index.has(use.id)) broken.push(use);
    const list = uses.get(use.id);
    if (list === undefined) uses.set(use.id, [use]);
    else list.push(use);
  }
  for (const use of broken) problems.push(brokenProblem(use));
  return { index, uses, broken, problems };
}

function indexRecords(input: DeriveInput, problems: AssetProblem[]): Map<string, AssetEntry> {
  const index = new Map<string, AssetEntry>();
  const states = [...input.records].sort((a, b) => compare(a.recordPath, b.recordPath));
  const recorded = new Set<string>();
  for (const state of states) if (state.ok) recorded.add(state.entry.sourcePath);
  for (const state of states) {
    if (!state.ok) {
      for (const error of state.errors) {
        const at = error.path || "/";
        problems.push({
          code: "bad-record",
          file: state.recordPath,
          pointer: error.path,
          message: `${at}: ${error.message}`,
        });
      }
      continue;
    }
    const { entry } = state;
    const first = index.get(entry.id);
    if (first !== undefined) {
      const message = `the ID ${entry.id} is also the ID of ${first.recordPath}; give one of the records a new ID`;
      problems.push({ code: "duplicate-id", file: entry.recordPath, pointer: "/id", id: entry.id, message });
      continue;
    }
    const outputs = (input.outputFiles ?? []).filter((file) => basename(file).startsWith(`${entry.id}.`));
    index.set(entry.id, outputs.length === 0 ? entry : { ...entry, outputs });
    if (entry.hash === null) problems.push(missingSource(entry, input.assetFiles, recorded));
    for (const file of state.missingFiles) {
      const message = `the source ${entry.sourcePath} names ${file}; the file does not exist`;
      problems.push({ code: "missing-file", file, id: entry.id, message });
    }
  }
  return index;
}

/**
 * The problem of a record whose source is missing. When a source moves without its record, the record stays at the
 * old location. The message names each file with the same name and no record, so the user can move the record.
 */
function missingSource(
  entry: AssetEntry,
  assetFiles: ReadonlySet<string>,
  recorded: ReadonlySet<string>,
): AssetProblem {
  const name = basename(entry.sourcePath);
  const candidates = [...assetFiles]
    .filter((file) => basename(file) === name && !recorded.has(file) && !file.endsWith(RECORD_SUFFIX))
    .sort();
  const hint =
    candidates.length === 0
      ? ""
      : `; a file with this name and no record is at ${candidates.join(", ")}: move the record beside it`;
  const message = `the source ${entry.sourcePath} does not exist${hint}`;
  return { code: "missing-source", file: entry.recordPath, pointer: "/source", id: entry.id, message };
}

function documentProblem(file: string, pointer: string, message: string): AssetProblem {
  return { code: "bad-document", file, pointer, message: `${pointer || "/"}: ${message}` };
}

function brokenProblem(use: AssetUse): AssetProblem {
  const where = use.entity === undefined ? use.pointer : `${use.pointer} (entity ${use.entity})`;
  const message = `${where}: asset:${use.id} names no asset of the project`;
  return { code: "broken-reference", file: use.document, pointer: use.pointer, id: use.id, message };
}

function compare(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
