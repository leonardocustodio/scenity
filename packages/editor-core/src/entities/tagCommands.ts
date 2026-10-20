// SPDX-License-Identifier: Apache-2.0
/**
 * The tags and the pick layers of a scene: the list of each tag and each pick layer with the entities that have it,
 * and a rename across the scene. `tag.rename` changes the tag on each entity that has it. `pickLayer.rename` changes
 * the layer in the `pickable` component of each entity that has it. Each rename is one step of the history. A new
 * name that an entity has already merges into it (the entity keeps it once). No Vue import.
 */
import { formatPointer } from "@scenity/scene";
import { TAG_PATTERN } from "@scenity/scene/schema/common";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { CommandError, defineCommands, NO_RULE, textArg, type Args, type CommandHost } from "../command";
import type { HierarchyState } from "../hierarchy/commands";
import type { SceneEditOp } from "../ops";

/** A tag or a pick layer with the entities that have it, in ID order. */
export interface NameUse {
  readonly name: string;
  readonly entities: readonly string[];
}

/** The pick layers of an entity: its `pickable` layers, or none. */
function layersOf(doc: EntityDocument, id: string): readonly string[] {
  const pickable = doc.entities[id]?.components.pickable as { layers?: unknown } | undefined;
  return Array.isArray(pickable?.layers)
    ? pickable.layers.filter((item): item is string => typeof item === "string")
    : [];
}

/** The names of a kind of each entity, as a list of names with their entities (the names in order). */
function usesOf(doc: EntityDocument, names: (id: string) => readonly string[]): NameUse[] {
  const map = new Map<string, string[]>();
  for (const id of Object.keys(doc.entities).sort()) {
    for (const name of names(id)) map.set(name, [...(map.get(name) ?? []), id]);
  }
  return [...map].sort(([a], [b]) => a.localeCompare(b)).map(([name, entities]) => ({ name, entities }));
}

/** The tags of a scene with the entities that have each one. */
export function tagUses(doc: EntityDocument): NameUse[] {
  return usesOf(doc, (id) => doc.entities[id]?.tags ?? []);
}

/** The pick layers of a scene (the `layers` of `pickable`) with the entities that have each one. */
export function layerUses(doc: EntityDocument): NameUse[] {
  return usesOf(doc, (id) => layersOf(doc, id));
}

/** A list with `from` renamed to `to`. The list keeps `to` once. */
function renamed(list: readonly string[], from: string, to: string): string[] {
  return [...new Set(list.map((item) => (item === from ? to : item)))];
}

/** The ops of a rename of a tag across the scene. */
export function tagRenameOps(doc: EntityDocument, from: string, to: string): SceneOp[] {
  return Object.entries(doc.entities)
    .filter(([, entity]) => entity.tags?.includes(from) === true)
    .map(([id, entity]) => ({
      op: "set",
      path: formatPointer(["entities", id, "tags"]),
      value: renamed(entity.tags ?? [], from, to),
    }));
}

/** The ops of a rename of a pick layer across the scene. */
export function layerRenameOps(doc: EntityDocument, from: string, to: string): SceneOp[] {
  return Object.keys(doc.entities)
    .filter((id) => layersOf(doc, id).includes(from))
    .map((id) => ({
      op: "set",
      path: formatPointer(["entities", id, "components", "pickable", "layers"]),
      value: renamed(layersOf(doc, id), from, to),
    }));
}

/** The names of a rename: the old and the new name, checked. */
function renameArgs(args: Args, what: string): { from: string; to: string } {
  const from = textArg(args, "from").trim();
  const to = textArg(args, "to").trim();
  if (from === "" || to === "") throw new CommandError(`A rename of a ${what} needs "from" and "to".`);
  if (!TAG_PATTERN.test(to)) throw new CommandError(`"${to}" is no ${what}: 1 to 64 letters, digits, _ . : or -.`);
  return { from, to };
}

const RENAME_ARGS = (what: string) =>
  ({
    from: { type: "string", description: `The ${what} now.` },
    to: { type: "string", description: `The new ${what} (1 to 64 letters, digits, _ . : or -).` },
  }) as const;

/** The rename commands of the tags and the pick layers. */
export const TAG_COMMANDS = defineCommands<HierarchyState, CommandHost, SceneEditOp>([
  {
    id: "tag.rename",
    icon: "tag",
    category: "entity",
    title: "Rename a tag on each entity of the scene",
    key: null,
    kind: "edit",
    args: RENAME_ARGS("tag"),
    selection: NO_RULE,
    build: (args, state) => {
      const { from, to } = renameArgs(args, "tag");
      const ops = tagRenameOps(state.doc, from, to);
      if (ops.length === 0) throw new CommandError(`No entity has the tag "${from}".`);
      return { kind: "edit", title: `Rename the tag ${from} to ${to}`, ops: ops.map((op) => ({ kind: "scene", op })) };
    },
  },
  {
    id: "pickLayer.rename",
    icon: "layers",
    category: "entity",
    title: "Rename a pick layer on each entity of the scene",
    key: null,
    kind: "edit",
    args: RENAME_ARGS("pick layer"),
    selection: NO_RULE,
    build: (args, state) => {
      const { from, to } = renameArgs(args, "pick layer");
      const ops = layerRenameOps(state.doc, from, to);
      if (ops.length === 0) throw new CommandError(`No entity has the pick layer "${from}".`);
      return {
        kind: "edit",
        title: `Rename the pick layer ${from} to ${to}`,
        ops: ops.map((op) => ({ kind: "scene", op })),
      };
    },
  },
]);
