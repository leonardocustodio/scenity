// SPDX-License-Identifier: Apache-2.0
/**
 * The semantic diff of two scene documents: one line for each change, in the words of the editor: a new entity, a
 * removed entity, a new parent, a new name or value of a field (the old and the new value), a new or a removed
 * component. The conflict dialog shows the lines between the scene of the editor and the file on the disk.
 */
import { markRaw } from "vue";
import type { DialogDetails } from "../studio/shell/dialogs";
import SemanticDiff from "./diff/SemanticDiff.vue";
import { entityDiff } from "./diff/semanticDiff";
import { docOps } from "@scenity/editor-core";
import { parsePointer, readDocument, type ComponentRegistry } from "@scenity/scene";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { t } from "../texts";
import { valueText } from "./review/reviewModel";

/** The most lines of a diff; the rest is one line with its count. */
export const DIFF_LINES_MAX = 40;

/** The value at the tokens of a pointer in a value, or undefined. */
function valueAt(value: unknown, tokens: readonly string[]): unknown {
  let at = value;
  for (const token of tokens) {
    if (typeof at !== "object" || at === null) return undefined;
    at = (at as Record<string, unknown>)[token];
  }
  return at;
}

/** The lines of one op from `from` toward `to`. */
function opLines(op: SceneOp, from: EntityDocument, to: EntityDocument): string[] {
  const name = (id: string): string => to.entities[id]?.name ?? from.entities[id]?.name ?? id;
  switch (op.op) {
    case "add":
      return [t("diff-add", { name: op.entity.name ?? op.id })];
    case "remove":
      return [t("diff-remove", { name: name(op.id) })];
    case "move":
      return [
        op.parent === null
          ? t("diff-move-root", { name: name(op.id) })
          : t("diff-move", { name: name(op.id), parent: name(op.parent) }),
      ];
    case "addComponent":
      return [t("diff-add-component", { name: name(op.id), component: op.component })];
    case "removeComponent":
      return [t("diff-remove-component", { name: name(op.id), component: op.component })];
    case "set":
      return setLines(op.path, op.value, from, name);
  }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** The lines of a `set` op: one line for each field that changes (a set of a whole component gives its fields). */
function setLines(path: string, value: unknown, from: EntityDocument, name: (id: string) => string): string[] {
  const tokens = parsePointer(path) ?? [];
  const old = valueAt(from, tokens);
  if (isRecord(old) && isRecord(value)) {
    const keys = [...new Set([...Object.keys(old), ...Object.keys(value)])];
    const changed = keys.filter((key) => JSON.stringify(old[key]) !== JSON.stringify(value[key]));
    return changed.flatMap((key) => fieldLine([...tokens, key], old[key], value[key], name));
  }
  return [fieldLine(tokens, old, value, name)];
}

/** The line of a new value of one field. */
function fieldLine(tokens: readonly string[], old: unknown, value: unknown, name: (id: string) => string): string {
  const before = valueText(old);
  const after = valueText(value);
  if (tokens[0] !== "entities" || tokens[1] === undefined) {
    return t("diff-set-scene", { field: tokens.join("."), before, after });
  }
  const field = (tokens[2] === "components" ? tokens.slice(3) : tokens.slice(2)).join(".");
  return t("diff-set", { name: name(tokens[1]), field, before, after });
}

/** The lines of the changes from one document to another (at most `DIFF_LINES_MAX`). */
export function diffLines(from: EntityDocument, to: EntityDocument, registry: ComponentRegistry): string[] {
  const ops = docOps(from, to, registry);
  if (ops === null) return [t("diff-unknown")];
  const all = ops.flatMap((op) => opLines(op, from, to));
  const lines = all.slice(0, DIFF_LINES_MAX);
  if (all.length > DIFF_LINES_MAX) lines.push(t("diff-more", { count: all.length - DIFF_LINES_MAX }));
  return lines;
}

/**
 * The details of a dialog for the changes from one document to another: the lines, and the semantic diff
 * view of the same changes (the view of the Version control panel). Null when no line changed.
 */
export function diffDetails(
  label: string,
  from: EntityDocument,
  to: EntityDocument,
  registry: ComponentRegistry,
): DialogDetails | null {
  const lines = diffLines(from, to, registry);
  if (lines.length === 0) return null;
  return { label, lines, view: { component: markRaw(SemanticDiff), props: { diff: entityDiff(from, to) } } };
}

/** The details of the conflict dialog from the scene of the editor to a text of its file on the disk. */
export function diskDetails(
  label: string,
  text: string,
  path: string,
  doc: EntityDocument,
  registry: ComponentRegistry,
): DialogDetails | null {
  const read = readDocument(text, path.endsWith(".prefab.json") ? "prefab" : "scene", { registry });
  if (!read.ok) return null;
  return diffDetails(label, doc, read.doc, registry) ?? { label, lines: [t("scene-conflict-diff-none")] };
}
