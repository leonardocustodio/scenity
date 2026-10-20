// SPDX-License-Identifier: Apache-2.0
/**
 * The entity commands of the editor. Each edit command is one edit, and thus one step of the one history. The copy is
 * a view command (it changes no input).
 *
 * - `entity.add`: a new entity from an asset (a `model` component) or an empty entity, at a place in the frame of its
 *   parent. A drop of an asset into the viewport runs it with the point of the surface under the pointer.
 * - `entity.duplicate` (⌘D): a copy of each entity with its subtree, right after it. The copies get new IDs, and a
 *   reference inside the copies to a copied entity names the copy.
 * - `entity.delete` (Delete, Backspace): the entities with their subtrees. A reference of another entity to a deleted
 *   entity goes into the title. The rule `references` tells what occurs to it (refs.ts). "clear" (default) clears it
 *   in the same edit, and "refuse" refuses the delete. A component that needs the reference refuses the delete.
 * - `entity.copy` (⌘C): the entities with their subtrees go to the clipboard of the host. The clipboard of the
 *   scene page holds the copy for each scene of the project.
 * - `entity.paste` (⌘V): the clipboard as `add` ops with new IDs, at the roots or under a parent. The asset references
 *   stay. The paste clears a reference to an entity that is not in the scene (a copy from another scene). The title
 *   names it.
 *
 * The editor selects the new roots of an add, a duplicate or a paste (`addedRoots` of edits.ts). No Vue import.
 */
import type { ComponentRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import type { SceneOp } from "@scenity/scene/schema/entity";
import {
  CommandError,
  defineCommands,
  grid,
  NO_RULE,
  numberArg,
  textArg,
  type Args,
  type CommandHost,
  type SelectionRule,
} from "../command";
import { copyEntities, type ClipboardData } from "../clipboard";
import { targetEntities, type HierarchyOp, type HierarchyState } from "../hierarchy/commands";
import { entityLabel, topEntities } from "../hierarchy/tree";
import type { SceneEditOp } from "../ops";
import { addEntityOps, deleteOps, duplicateOps, pasteEdit } from "./edits";
import { refWords, type LostRef, type RefRule } from "./refs";

/** What the entity commands read: the hierarchy state, the clipboard and the components (for a check of a delete). */
export interface EntityState extends HierarchyState {
  /** The copy of the clipboard, or null when it is empty. */
  readonly clipboard: ClipboardData | null;
  /** The components of the scene. With them, a delete that a component schema refuses gives a clear reason. */
  readonly registry?: ComponentRegistry;
}

/** The host of the entity commands: the hierarchy host and the clipboard. */
export interface EntityHost extends CommandHost {
  /** Keep a copy in the clipboard. */
  copy(data: ClipboardData): void;
}

const ENTITY_RULE: SelectionRule = { kinds: ["entity"], orArg: "entity" };

const ENTITY_ARG = {
  type: "string",
  description: "An entity ID, or entity IDs separated by commas (default: the selected entities).",
  optional: true,
} as const;

const PARENT_ARG = {
  type: "string",
  description: "The ID of the parent (default: the scene root).",
  optional: true,
} as const;

function sceneOps(ops: readonly SceneOp[]): SceneEditOp[] {
  return ops.map((op) => ({ kind: "scene", op }));
}

/** The words of a list of entities in a title. */
function names(state: HierarchyState, ids: readonly string[]): string {
  return ids.length === 1 ? entityLabel(state.doc, ids[0] ?? "") : `${String(ids.length)} entities`;
}

/** The parent of an argument: null for the root. An unknown parent is an error. */
function parentArg(args: Args, state: HierarchyState): string | null {
  const parent = textArg(args, "parent").trim();
  if (parent === "") return null;
  if (!Object.hasOwn(state.doc.entities, parent)) throw new CommandError(`No entity "${parent}" in the scene.`);
  return parent;
}

/** The end of a title that reports cleared references. */
function clearedWords(refs: readonly LostRef[]): string {
  if (refs.length === 0) return "";
  return `; cleared ${String(refs.length)} reference${refs.length === 1 ? "" : "s"}: ${refWords(refs)}`;
}

/** The position of the x, y and z arguments (0 for a missing axis). */
function positionArg(args: Args): [number, number, number] {
  return [numberArg(args, "x") ?? 0, numberArg(args, "y") ?? 0, numberArg(args, "z") ?? 0];
}

const AXIS = (axis: string) =>
  ({
    type: "number",
    description: `The ${axis} position in the frame of the parent (metres; default 0).`,
    optional: true,
  }) as const;

const OFFSET = (axis: string) =>
  ({
    type: "number",
    description: `The ${axis} offset of the copies in the frame of their parent (metres; default 0).`,
    optional: true,
  }) as const;

/** The add ops of a duplicate with the roots of the copies moved by an offset. */
function offsetCopies(ops: readonly SceneOp[], roots: readonly string[], offset: readonly number[]): SceneOp[] {
  if (offset.every((value) => value === 0)) return [...ops];
  return ops.map((op) => {
    if (op.op !== "add" || !roots.includes(op.id)) return op;
    const transform = (op.entity.components.transform ?? {}) as { position?: readonly number[] };
    const position = [0, 1, 2].map((axis) => grid((transform.position?.[axis] ?? 0) + (offset[axis] ?? 0)));
    const components = { ...op.entity.components, transform: { ...transform, position } };
    return { ...op, entity: { ...op.entity, components } };
  });
}

/** The build of `entity.delete`: the ops, or a refusal with the references. */
function buildDelete(args: Args, state: EntityState) {
  const ids = topEntities(state.doc, targetEntities(args, state));
  const rule = (textArg(args, "references") || "clear") as RefRule;
  const edit = deleteOps(state.doc, ids);
  if (rule === "refuse" && edit.refs.length > 0) {
    throw new CommandError(`Not deleted: other entities name the entities: ${refWords(edit.refs)}.`);
  }
  if (state.registry !== undefined && edit.refs.length > 0) {
    const check = applyOps(state.doc, edit.ops, state.registry);
    if (!check.ok) {
      throw new CommandError(`Not deleted: a component needs its reference (${refWords(edit.refs)}): ${check.reason}`);
    }
  }
  return {
    kind: "edit" as const,
    title: `Delete ${names(state, ids)}${clearedWords(edit.refs)}`,
    ops: sceneOps(edit.ops),
  };
}

/** The entity commands. */
export const ENTITY_COMMANDS = defineCommands<EntityState, EntityHost, HierarchyOp>([
  {
    id: "entity.add",
    icon: "box",
    menu: "entity",
    title: "Add an entity (from an asset, or an empty entity)",
    key: null,
    kind: "edit",
    args: {
      asset: { type: "string", description: "An asset `asset:<id>` for a model (default: none).", optional: true },
      name: { type: "string", description: "The name of the entity (default: none).", optional: true },
      id: { type: "string", description: "The base of the new ID (default: from the name).", optional: true },
      parent: PARENT_ARG,
      x: AXIS("x"),
      y: AXIS("y"),
      z: AXIS("z"),
    },
    selection: NO_RULE,
    build: (args, state) => {
      const asset = textArg(args, "asset");
      const name = textArg(args, "name");
      const base = textArg(args, "id");
      let edit;
      try {
        edit = addEntityOps(state.doc, {
          parent: parentArg(args, state),
          position: positionArg(args),
          ...(asset === "" ? {} : { asset }),
          ...(name === "" ? {} : { name }),
          ...(base === "" ? {} : { id: base }),
        });
      } catch (error) {
        if (error instanceof CommandError) throw error;
        throw new CommandError(error instanceof Error ? error.message : String(error));
      }
      const what = name !== "" ? name : asset !== "" ? asset : "an empty entity";
      return { kind: "edit", title: `Add ${what}`, ops: sceneOps(edit.ops) };
    },
  },
  {
    id: "entity.duplicate",
    icon: "copy-plus",
    menu: "edit",
    title: "Duplicate the entities",
    key: "⌘D",
    keys: ["Mod+D"],
    keyContext: "scene",
    kind: "edit",
    // An offset of the copies (metres in the frame of their parent).
    args: { entity: ENTITY_ARG, x: OFFSET("x"), y: OFFSET("y"), z: OFFSET("z") },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = targetEntities(args, state);
      const edit = duplicateOps(state.doc, ids);
      const ops = offsetCopies(edit.ops, edit.roots, positionArg(args));
      return { kind: "edit", title: `Duplicate ${names(state, topEntities(state.doc, ids))}`, ops: sceneOps(ops) };
    },
  },
  {
    id: "entity.delete",
    icon: "trash-2",
    menu: "edit",
    title: "Delete the entities (with their children)",
    key: "Delete",
    keys: ["Delete", "Backspace"],
    keyContext: "scene",
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      references: {
        type: "string",
        values: ["clear", "refuse"],
        description: "A reference of another entity to a deleted entity: clear it (default), or refuse the delete.",
        optional: true,
      },
    },
    selection: ENTITY_RULE,
    build: buildDelete,
  },
  {
    id: "entity.copy",
    icon: "copy",
    menu: "edit",
    title: "Copy the entities (with their children)",
    key: "⌘C",
    keys: ["Mod+C"],
    keyContext: "scene",
    kind: "view",
    args: { entity: ENTITY_ARG },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = targetEntities(args, state);
      return {
        kind: "view",
        title: `Copy ${names(state, topEntities(state.doc, ids))}`,
        run: (host: EntityHost) => {
          const data = copyEntities(state.doc, ids);
          host.copy(data);
          return Object.keys(data.entities).length;
        },
      };
    },
  },
  {
    id: "entity.paste",
    icon: "clipboard-paste",
    menu: "edit",
    title: "Paste the entities of the clipboard",
    key: "⌘V",
    keys: ["Mod+V"],
    keyContext: "scene",
    kind: "edit",
    args: { parent: PARENT_ARG },
    selection: NO_RULE,
    when: (state) => (state.clipboard === null ? "The clipboard is empty." : null),
    build: (args, state) => {
      if (state.clipboard === null) throw new CommandError("The clipboard is empty.");
      const edit = pasteEdit(state.doc, state.clipboard, { parent: parentArg(args, state) });
      const count = edit.ops.length;
      const title = `Paste ${String(count)} entit${count === 1 ? "y" : "ies"}${clearedWords(edit.cleared)}`;
      return { kind: "edit", title, ops: sceneOps(edit.ops) };
    },
  },
]);
