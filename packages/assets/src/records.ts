// SPDX-License-Identifier: Apache-2.0
/**
 * The read of one record file into the state of the index: the record, its source, the hash and the
 * dependencies. A record that does not read keeps its errors.
 */
import { resolveFrom, type DocError } from "@scenity/scene";
import { join } from "node:path";
import { readTextOrUndefined } from "./files";
import { hashSource } from "./hash";
import { readAssetRecord, recordDependencies } from "./record";
import type { AssetEntry } from "./types";

/** The state of one record file. */
export type RecordState =
  | {
      readonly ok: true;
      readonly recordPath: string;
      readonly entry: AssetEntry;
      /** The files that the source names and that do not exist. */
      readonly missingFiles: readonly string[];
    }
  | { readonly ok: false; readonly recordPath: string; readonly errors: readonly DocError[] };

/** The state of a record file, or undefined when the file does not exist. */
export function readRecordState(dir: string, recordPath: string): RecordState | undefined {
  const text = readTextOrUndefined(join(dir, recordPath));
  if (text === undefined) return undefined;
  const read = readAssetRecord(text);
  if (!read.ok) return { ok: false, recordPath, errors: read.errors };
  const { record } = read;
  const sourcePath = resolveFrom(recordPath, record.source);
  const source = hashSource(dir, sourcePath);
  const entry: AssetEntry = {
    id: record.id,
    kind: record.kind,
    importer: record.importer,
    tags: record.tags,
    recordPath,
    sourcePath,
    hash: source.hash ?? null,
    files: source.files,
    dependencies: recordDependencies(record),
    outputs: [],
    record,
  };
  const missingFiles = source.missing.filter((path) => path !== sourcePath);
  return { ok: true, recordPath, entry, missingFiles };
}

/** A text that changes when the state changes. The watcher compares these keys. */
export function recordStateKey(state: RecordState | undefined): string {
  if (state === undefined) return "";
  return JSON.stringify(state.ok ? [state.entry, state.missingFiles] : state.errors);
}

/** The asset ID of a state, or undefined for a record that does not read. */
export function recordStateId(state: RecordState | undefined): string | undefined {
  return state?.ok === true ? state.entry.id : undefined;
}
