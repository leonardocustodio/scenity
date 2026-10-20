// SPDX-License-Identifier: Apache-2.0
/**
 * The reader of the documents. It parses the JSON and upcasts an older format through the migrations. It checks the
 * shell with zod, upcasts and checks the components with the registry, and checks the tree. Each error names the JSON
 * Pointer of the bad value.
 */
import { builtinRegistry } from "./components/index";
import type { ComponentRegistry } from "./components/registry";
import { checkEntityDocument, upcastComponents } from "./check";
import { zodErrors, type DocError } from "./errors";
import { isObject, jsonEqual } from "./json";
import { formatString, parseFormat, upcastDocument, type DocumentKind } from "./migrations";
import {
  overridesSchema,
  prefabSchema,
  sceneSchema,
  type OverridesDocument,
  type PrefabDocument,
  type SceneDocument,
} from "./schema/documents";
import { materialDocumentSchema, type MaterialDocument } from "./schema/material";
import { projectSchema, type ProjectDocument } from "./schema/project";
import { rulesDocumentSchema, type RulesDocument } from "./schema/rules";
import { sequenceSchema, type SequenceDocument } from "./schema/sequence";

/** The document type of each kind. */
export interface DocumentOfKind {
  project: ProjectDocument;
  scene: SceneDocument;
  prefab: PrefabDocument;
  overrides: OverridesDocument;
  sequence: SequenceDocument;
  material: MaterialDocument;
  rules: RulesDocument;
}
export type AnyDocument = DocumentOfKind[DocumentKind];

export type ReadResult<D> =
  | {
      readonly ok: true;
      readonly doc: D;
      /** The format of the file before the upcast (`scenity.scene/0` for a migrated v0 file). */
      readonly format: string;
      /** True when an upcaster changed the document: a write gives other bytes than the file. */
      readonly migrated: boolean;
      readonly warnings: readonly DocError[];
    }
  | { readonly ok: false; readonly errors: readonly DocError[] };

export interface ReadOptions {
  /** The component registry. The default is a registry of the built-in components. */
  readonly registry?: ComponentRegistry;
}

const SCHEMAS = {
  project: projectSchema,
  scene: sceneSchema,
  prefab: prefabSchema,
  overrides: overridesSchema,
  sequence: sequenceSchema,
  material: materialDocumentSchema,
  rules: rulesDocumentSchema,
};
let defaultRegistry: ComponentRegistry | undefined;

/** Read a document from its text. With `expectedKind`, a document of another kind is an error. */
export function readDocument<K extends DocumentKind>(
  text: string,
  expectedKind: K,
  options?: ReadOptions,
): ReadResult<DocumentOfKind[K]>;
export function readDocument(text: string, expectedKind?: DocumentKind, options?: ReadOptions): ReadResult<AnyDocument>;
export function readDocument(
  text: string,
  expectedKind?: DocumentKind,
  options: ReadOptions = {},
): ReadResult<AnyDocument> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return fail("", `the file is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  return readValue(raw, expectedKind, options);
}

/** Read a document from a parsed JSON value (the same steps as `readDocument`). */
export function readValue(
  raw: unknown,
  expectedKind?: DocumentKind,
  options: ReadOptions = {},
): ReadResult<AnyDocument> {
  if (!isObject(raw)) return fail("", "a document is a JSON object");
  const format = parseFormat(raw.format);
  if (format === undefined) return fail("/format", 'the format is "scenity.<kind>/<version>"');
  const original = formatString(format.kind, format.version);
  if (expectedKind !== undefined && format.kind !== expectedKind) {
    return fail("/format", `this file has format ${original}; a ${expectedKind} document is expected`);
  }
  const upcast = upcastDocument(raw, format);
  if (!upcast.ok) return fail("/format", upcast.message);
  const kind = format.kind as DocumentKind;
  const registry = options.registry ?? (defaultRegistry ??= builtinRegistry());
  let doc = upcast.doc;
  const errors: DocError[] = [];
  if (kind === "scene" || kind === "prefab") {
    const components = upcastComponents(doc, registry);
    doc = components.doc;
    errors.push(...components.errors);
  }
  if (errors.length > 0) return { ok: false, errors };
  const parsed = SCHEMAS[kind].safeParse(doc);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  let warnings: DocError[] = [];
  if (kind === "scene" || kind === "prefab") {
    const check = checkEntityDocument(doc as unknown as SceneDocument | PrefabDocument, registry);
    if (check.errors.length > 0) return { ok: false, errors: check.errors };
    warnings = check.warnings;
  }
  const migrated = upcast.steps > 0 || !jsonEqual(doc.versions, raw.versions);
  // The reader gives the input values, not the zod output: zod gives the same data, but the input keeps the
  // values of unknown components exactly.
  return { ok: true, doc: doc as unknown as AnyDocument, format: original, migrated, warnings };
}

function fail(path: string, message: string): { ok: false; errors: DocError[] } {
  return { ok: false, errors: [{ path, message }] };
}
