// SPDX-License-Identifier: Apache-2.0
/**
 * The types of the asset database: an index entry, a problem, a use of an asset in a document and a broken
 * reference. Each path is relative to the project folder and has `/` between the parts.
 */
import type { AssetRecord } from "./record";

/** One asset of the index. */
export interface AssetEntry {
  readonly id: string;
  readonly kind: string;
  readonly importer: string;
  readonly tags: readonly string[];
  /** The path of the record file (`<source>.meta.json`). */
  readonly recordPath: string;
  /** The path of the source file. */
  readonly sourcePath: string;
  /** The SHA-256 of the source and of the files that it names (see `hash.ts`), or null when the source is missing. */
  readonly hash: string | null;
  /** The source and the files that it names (the buffers and images of a glTF file), in sorted order. */
  readonly files: readonly string[];
  /** The IDs of the assets that this asset needs, from the `dependencies` of the record. */
  readonly dependencies: readonly string[];
  /** The files of the build for this asset: the files `<id>.*` of the output folder, in sorted order. */
  readonly outputs: readonly string[];
  readonly record: AssetRecord;
}

/** The kinds of problems. */
export type AssetProblemCode =
  /** A record does not read: bad JSON, a bad format or a bad field. */
  | "bad-record"
  /** Two records have the same ID. */
  | "duplicate-id"
  /** The source file of a record does not exist (for example, the source moved and the record stayed). */
  | "missing-source"
  /** A file that the source names (a glTF buffer or image) does not exist. */
  | "missing-file"
  /** A reference to an asset ID that no record has. */
  | "broken-reference"
  /** A document does not read. */
  | "bad-document"
  /** The project lists a document that does not exist. */
  | "missing-document";

export interface AssetProblem {
  readonly code: AssetProblemCode;
  /** The file of the problem: a record, a source or a document. */
  readonly file: string;
  /** The JSON Pointer of the bad value in the file, when the problem has one. */
  readonly pointer?: string;
  /** The asset ID of the problem, when the problem has one. */
  readonly id?: string;
  readonly message: string;
}

/** One `asset:` reference in a document or a record. */
export interface AssetUse {
  /** The asset ID of the reference. */
  readonly id: string;
  /** The path of the document or the record that holds the reference. */
  readonly document: string;
  /** The JSON Pointer of the reference in the document. */
  readonly pointer: string;
  /** The entity that holds the reference, for a reference under `/entities/<id>`. */
  readonly entity?: string;
}

/** A change that the watcher found: the changed asset IDs and the changed documents. */
export interface AssetChange {
  readonly ids: readonly string[];
  readonly documents: readonly string[];
}
