// SPDX-License-Identifier: Apache-2.0
/**
 * References: `asset:<id>`, `entity:<id>`, `entity:<id>#<socket or bone>` and `scene:<id>`. The
 * functions parse and format a reference, find all references in a document and report broken entity references.
 */
import { ASSET_ID_PATTERN, ID_PATTERN, SUB_PATTERN } from "./schema/common";
import type { EntityDocument } from "./schema/documents";
import { isObject } from "./json";
import { formatPointer } from "./pointer";

export type Ref =
  | { readonly kind: "asset"; readonly id: string }
  | { readonly kind: "entity"; readonly id: string; readonly sub?: string }
  | { readonly kind: "scene"; readonly id: string };

/** The reference of a text, or undefined when the text is not a reference. */
export function parseRef(text: string): Ref | undefined {
  const colon = text.indexOf(":");
  if (colon < 0) return undefined;
  const prefix = text.slice(0, colon);
  const rest = text.slice(colon + 1);
  if (prefix === "asset") return ASSET_ID_PATTERN.test(rest) ? { kind: "asset", id: rest } : undefined;
  if (prefix === "scene") return ID_PATTERN.test(rest) ? { kind: "scene", id: rest } : undefined;
  if (prefix !== "entity") return undefined;
  const hash = rest.indexOf("#");
  const id = hash < 0 ? rest : rest.slice(0, hash);
  if (!ID_PATTERN.test(id)) return undefined;
  if (hash < 0) return { kind: "entity", id };
  const sub = rest.slice(hash + 1);
  return SUB_PATTERN.test(sub) ? { kind: "entity", id, sub } : undefined;
}

export function formatRef(ref: Ref): string {
  if (ref.kind === "entity" && ref.sub !== undefined) return `entity:${ref.id}#${ref.sub}`;
  return `${ref.kind}:${ref.id}`;
}

export function assetRef(id: string): string {
  return formatRef({ kind: "asset", id });
}

export function entityRef(id: string, sub?: string): string {
  return formatRef(sub === undefined ? { kind: "entity", id } : { kind: "entity", id, sub });
}

export function sceneRef(id: string): string {
  return formatRef({ kind: "scene", id });
}

/** One reference in a document, with the JSON Pointer of its string. */
export interface FoundRef {
  readonly path: string;
  readonly ref: Ref;
}

/** All references in a JSON value, in the order of the canonical writer (sorted keys, array order). */
export function findReferences(value: unknown): FoundRef[] {
  const out: FoundRef[] = [];
  const walk = (node: unknown, tokens: string[]) => {
    if (typeof node === "string") {
      const ref = parseRef(node);
      if (ref !== undefined) out.push({ path: formatPointer(tokens), ref });
    } else if (Array.isArray(node)) {
      node.forEach((item, index) => walk(item, [...tokens, String(index)]));
    } else if (isObject(node)) {
      for (const key of Object.keys(node).sort()) walk(node[key], [...tokens, key]);
    }
  };
  walk(value, []);
  return out;
}

/**
 * The entity references of a document to an entity that the document does not hold. The function does not check a
 * socket or bone name: a bone comes from the model asset.
 */
export function brokenReferences(doc: EntityDocument): FoundRef[] {
  return findReferences(doc).filter(({ ref }) => ref.kind === "entity" && !Object.hasOwn(doc.entities, ref.id));
}
