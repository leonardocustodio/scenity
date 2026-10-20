// SPDX-License-Identifier: Apache-2.0
/**
 * The formats of the documents and the chains of upcasters. A document has
 * `format: "scenity.<kind>/<major>"`. The reader upcasts an older major, one step at a time, and refuses a newer one.
 */
import { isObject } from "./json";
import { quatFromEulerRadians } from "./math";

export const DOCUMENT_KINDS = ["project", "scene", "prefab", "overrides", "sequence", "material", "rules"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** The kind and the major version of a format string. */
export interface Format {
  readonly kind: string;
  readonly version: number;
}

/** The format of a text such as `scenity.scene/1`, or undefined when the text is not a format. */
export function parseFormat(format: unknown): Format | undefined {
  if (typeof format !== "string") return undefined;
  const match = /^scenity\.([a-z][a-z-]*)\/(0|[1-9][0-9]*)$/.exec(format);
  if (match === null) return undefined;
  return { kind: match[1] ?? "", version: Number(match[2]) };
}

export function formatString(kind: string, version: number): string {
  return `scenity.${kind}/${String(version)}`;
}

/** One upcaster: it changes a document of a version into a document of the next version. */
export type DocumentUpcaster = (doc: Record<string, unknown>) => Record<string, unknown>;

export interface FormatChain {
  /** The current major version: the reader gives documents of this version. */
  readonly current: number;
  /** The upcasters by the version that they read. */
  readonly upcasters: Readonly<Record<number, DocumentUpcaster>>;
}

/** v0 → v1 of a scene, as an example of a format step (a v0 scene did not ship; the fixture is invented). */
export function upcastScene0(doc: Record<string, unknown>): Record<string, unknown> {
  const list = Array.isArray(doc.entities) ? (doc.entities as unknown[]) : [];
  const entities: Record<string, unknown> = {};
  const counts = new Map<string | null, number>();
  for (const item of list) {
    if (!isObject(item) || typeof item.id !== "string") continue;
    const { id, parent, components, ...rest } = item;
    const parentId = typeof parent === "string" ? parent : null;
    const index = counts.get(parentId) ?? 0;
    counts.set(parentId, index + 1);
    entities[id] = { ...rest, parent: parentId, index, components: upcastComponents0(components) };
  }
  const out: Record<string, unknown> = { ...doc, format: "scenity.scene/1", entities };
  delete out.background;
  if (typeof doc.background === "string") out.environment = { background: doc.background };
  return out;
}

/** In v0, `transform.rotation` was Euler angles in radians, order XYZ. v1 has a quaternion. */
function upcastComponents0(components: unknown): unknown {
  if (!isObject(components)) return components;
  const transform = components.transform;
  if (!isObject(transform) || !Array.isArray(transform.rotation) || transform.rotation.length !== 3) return components;
  const [x, y, z] = transform.rotation as unknown[];
  if (typeof x !== "number" || typeof y !== "number" || typeof z !== "number") return components;
  return { ...components, transform: { ...transform, rotation: quatFromEulerRadians([x, y, z]) } };
}

/** The format chains of the documents. A new major adds an upcaster here and a test of it. */
export const FORMAT_CHAINS: Readonly<Record<DocumentKind, FormatChain>> = {
  project: { current: 1, upcasters: {} },
  scene: { current: 1, upcasters: { 0: upcastScene0 } },
  prefab: { current: 1, upcasters: {} },
  overrides: { current: 1, upcasters: {} },
  // The sequence document starts at version 1.
  sequence: { current: 1, upcasters: {} },
  // The material document starts at version 1.
  material: { current: 1, upcasters: {} },
  // The rules document starts at version 1.
  rules: { current: 1, upcasters: {} },
};

export function isDocumentKind(kind: string): kind is DocumentKind {
  return (DOCUMENT_KINDS as readonly string[]).includes(kind);
}

/**
 * Upcast a document to the current version of its kind. The result is the new document, or a message for a newer
 * version, an unknown kind or a gap in the chain.
 */
export function upcastDocument(
  doc: Record<string, unknown>,
  format: Format,
): { ok: true; doc: Record<string, unknown>; steps: number } | { ok: false; message: string } {
  if (!isDocumentKind(format.kind)) return { ok: false, message: `unknown document kind "${format.kind}"` };
  const chain = FORMAT_CHAINS[format.kind];
  if (format.version > chain.current) {
    const message = `this file has format ${formatString(format.kind, format.version)}; this Scenity reads up to /${String(chain.current)}`;
    return { ok: false, message };
  }
  let out = doc;
  for (let version = format.version; version < chain.current; version += 1) {
    const step = chain.upcasters[version];
    if (step === undefined) {
      return { ok: false, message: `no migration from ${formatString(format.kind, version)}` };
    }
    out = step(out);
  }
  return { ok: true, doc: out, steps: chain.current - format.version };
}
