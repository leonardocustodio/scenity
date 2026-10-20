// SPDX-License-Identifier: Apache-2.0
/**
 * The scan of the documents of a project for `asset:` references: the scenes, the prefabs, the sequences
 * and the materials. The scan uses `findReferences` of `@scenity/scene`. A scene and a prefab also go through the
 * reader, so a bad document is a problem.
 */
import {
  findReferences,
  formatErrors,
  parsePointer,
  readDocument,
  type DocError,
  type ProjectDocument,
} from "@scenity/scene";
import { join } from "node:path";
import { readTextOrUndefined } from "./files";
import type { AssetUse } from "./types";

/** The file suffixes of the documents that the scan reads, with the reader kind of each (none: JSON only). */
export const DOCUMENT_SUFFIXES: Readonly<Record<string, "scene" | "prefab" | undefined>> = {
  ".scene.json": "scene",
  ".prefab.json": "prefab",
  ".sequence.json": undefined,
  ".material.json": undefined,
};

/** The result of the scan of one document. */
export interface DocumentScan {
  readonly path: string;
  readonly uses: readonly AssetUse[];
  /** The errors of the reader. A document with errors can still give uses when its JSON parses. */
  readonly errors: readonly DocError[];
}

/** The suffix of a document path, or undefined when the path is not a document. */
export function documentSuffix(path: string): string | undefined {
  return Object.keys(DOCUMENT_SUFFIXES).find((suffix) => path.endsWith(suffix));
}

/** The paths of the documents that the project lists: the scenes and the sequences. */
export function listedDocuments(project: ProjectDocument): string[] {
  return [...project.scenes, ...(project.sequences ?? [])].map((path) => path.replace(/^\.\//, ""));
}

/** The entity ID of a JSON Pointer under `/entities/<id>`, or undefined. */
export function entityOfPointer(pointer: string): string | undefined {
  const tokens = parsePointer(pointer);
  return tokens?.[0] === "entities" ? tokens[1] : undefined;
}

/** The `asset:` references of a JSON value, as uses of a document. */
export function assetUses(document: string, value: unknown): AssetUse[] {
  const out: AssetUse[] = [];
  for (const { path, ref } of findReferences(value)) {
    if (ref.kind !== "asset") continue;
    const entity = entityOfPointer(path);
    out.push(
      entity === undefined ? { id: ref.id, document, pointer: path } : { id: ref.id, document, pointer: path, entity },
    );
  }
  return out;
}

/** The reader kind of a document path from its suffix, or undefined for a document with no reader. */
export function documentKind(path: string): "scene" | "prefab" | undefined {
  const suffix = documentSuffix(path);
  return suffix === undefined ? undefined : DOCUMENT_SUFFIXES[suffix];
}

/**
 * The scan of a document, or undefined when the file does not exist. With a kind, the reader checks the document
 * (a scene that the project lists can have any file name).
 */
export function scanDocument(dir: string, path: string, kind = documentKind(path)): DocumentScan | undefined {
  const text = readTextOrUndefined(join(dir, path));
  if (text === undefined) return undefined;
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = `the file is not JSON: ${error instanceof Error ? error.message : String(error)}`;
    return { path, uses: [], errors: [{ path: "", message }] };
  }
  const read = kind === undefined ? undefined : readDocument(text, kind);
  return { path, uses: assetUses(path, raw), errors: read === undefined || read.ok ? [] : read.errors };
}

/** A text that changes when the scan changes. The watcher compares these keys. */
export function documentScanKey(scan: DocumentScan | undefined): string {
  return scan === undefined ? "" : JSON.stringify([scan.uses, formatErrors(scan.errors)]);
}
