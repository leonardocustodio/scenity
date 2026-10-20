// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of the hierarchy panel. Each action of the panel is one of these commands, and each command is one
 * edit: one step of the one history.
 *
 * - `entity.reparent`: scene `move` ops. Each entity keeps its world transform (reparent.ts).
 * - `entity.rename`: a `set` op of the entity name.
 * - `entity.hide`: the document value `visibility.visible` (a scene op). The saved file keeps it, and the player
 *   obeys it.
 * - `entity.solo`, `entity.lock` and `view.showAll`: ops of the view channel (view.ts). The saved file never keeps
 *   them.
 *
 * A command acts on the entities of its `entity` argument (one ID, or IDs separated by commas), else on the selected
 * entities. No Vue import.
 */
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { isObject } from "@scenity/scene";
import {
  CommandError,
  defineCommands,
  NO_RULE,
  numberArg,
  textArg,
  type Args,
  type CommandHost,
  type SelectionItem,
  type SelectionRule,
} from "../command";
import type { SceneEditOp } from "../ops";
import type { RuleState } from "../registry";
import { reparentOps } from "./reparent";
import { canParent, entityLabel, topEntities } from "./tree";
import type { SceneView, ViewFlag, ViewOp } from "./view";

/** What the hierarchy commands read. */
export interface HierarchyState extends RuleState {
  readonly selection: SelectionItem | null;
  /** Every selected item, the primary item first. */
  readonly selected?: readonly SelectionItem[];
  readonly doc: EntityDocument;
  readonly view: SceneView;
}

/** The ops of the hierarchy commands: scene ops and view ops. */
export type HierarchyOp = SceneEditOp | ViewOp;

const ENTITY_RULE: SelectionRule = { kinds: ["entity"], orArg: "entity" };

const ENTITY_ARG = {
  type: "string",
  description: "An entity ID, or entity IDs separated by commas (default: the selected entities).",
  optional: true,
} as const;

/** The target entities: the IDs of the `entity` argument, else the selected entities. Each one must exist. */
export function targetEntities(args: Args, state: HierarchyState): string[] {
  const given = textArg(args, "entity");
  const ids =
    given === ""
      ? (state.selected ?? (state.selection === null ? [] : [state.selection]))
          .filter((item) => item.kind === "entity")
          .map((item) => item.id)
      : given.split(",").map((id) => id.trim());
  const unique = [...new Set(ids.filter((id) => id !== ""))];
  const missing = unique.filter((id) => !Object.hasOwn(state.doc.entities, id));
  if (missing.length > 0) throw new CommandError(`No entity "${missing.join('", "')}" in the scene.`);
  if (unique.length === 0) throw new CommandError("The command needs an entity.");
  return unique;
}

/** The words of a list of entities in a title. */
function names(state: HierarchyState, ids: readonly string[]): string {
  if (ids.length === 1) return entityLabel(state.doc, ids[0] ?? "");
  return `${String(ids.length)} entities`;
}

function sceneOps(ops: readonly SceneOp[]): SceneEditOp[] {
  return ops.map((op) => ({ kind: "scene", op }));
}

/** True when the document shows the entity: no `visibility` component, or `visible` is not false. */
export function isShown(doc: EntityDocument, id: string): boolean {
  const value = doc.entities[id]?.components.visibility;
  return !isObject(value) || value.visible !== false;
}

/** The scene ops that show or hide an entity. A shown entity keeps no `visibility` value of its own default. */
export function visibilityOps(doc: EntityDocument, id: string, visible: boolean): SceneOp[] {
  const value = doc.entities[id]?.components.visibility;
  if (isShown(doc, id) === visible) return [];
  if (!isObject(value)) return [{ op: "addComponent", id, component: "visibility", value: { visible: false } }];
  const others = Object.keys(value).filter((key) => key !== "visible");
  if (visible && others.length === 0) return [{ op: "removeComponent", id, component: "visibility" }];
  const path = `/entities/${id}/components/visibility/visible`;
  return [visible ? { op: "set", path } : { op: "set", path, value: false }];
}

/** The words of a solo or lock command. */
interface FlagWords {
  readonly title: string;
  readonly on: string;
  readonly off: string;
  /** The place in the menu bar and the icon. */
  readonly menu: string;
  readonly icon: string;
  /** The default keys. */
  readonly keys?: readonly string[];
}

/** A solo or lock command over the view state. The argument sets or clears the flag, else the command toggles it. */
function flagCommand(flag: ViewFlag, id: string, arg: string, words: FlagWords) {
  return {
    id,
    title: words.title,
    menu: words.menu,
    icon: words.icon,
    ...(words.keys === undefined ? {} : { keys: words.keys, keyContext: "scene" }),
    key: null,
    kind: "edit" as const,
    args: {
      entity: ENTITY_ARG,
      [arg]: { type: "boolean" as const, description: `True: ${words.on}; false: ${words.off}.`, optional: true },
    },
    selection: ENTITY_RULE,
    build: (args: Args, state: HierarchyState) => {
      const ids = targetEntities(args, state);
      const given = args[arg];
      // The toggle sets the flag when one target does not have it, else it clears the flag.
      const on = typeof given === "boolean" ? given : ids.some((item) => !state.view[flag].includes(item));
      const rest = state.view[flag].filter((item) => !ids.includes(item));
      const op: ViewOp = { kind: "view", flag, ids: on ? [...rest, ...ids] : rest };
      return { kind: "edit" as const, title: `${on ? words.on : words.off} ${names(state, ids)}`, ops: [op] };
    },
  };
}

/** The commands of the hierarchy panel. */
export const HIERARCHY_COMMANDS = defineCommands<HierarchyState, CommandHost, HierarchyOp>([
  {
    id: "entity.reparent",
    icon: "list-tree",
    title: "Move the entities under a new parent",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      parent: { type: "string", description: "The ID of the new parent (default: the scene root).", optional: true },
      index: {
        type: "number",
        description: "The place under the parent, without the moved entities (default: the end).",
        optional: true,
        integer: true,
        min: 0,
      },
    },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = topEntities(state.doc, targetEntities(args, state));
      const parent = textArg(args, "parent") === "" ? null : textArg(args, "parent");
      if (!canParent(state.doc, ids, parent)) {
        throw new CommandError(`"${parent ?? ""}" cannot be the parent: it does not exist or the move makes a cycle.`);
      }
      const ops = reparentOps(state.doc, ids, { parent, index: numberArg(args, "index") ?? Number.MAX_SAFE_INTEGER });
      const under = parent === null ? "the scene root" : entityLabel(state.doc, parent);
      return { kind: "edit", title: `Move ${names(state, ids)} under ${under}`, ops: sceneOps(ops) };
    },
  },
  {
    id: "entity.rename",
    icon: "pencil",
    menu: "edit",
    title: "Rename the entity",
    key: "F2",
    kind: "edit",
    args: {
      entity: { type: "string", description: "The entity ID (default: the primary selected entity).", optional: true },
      name: { type: "string", description: "The new name." },
    },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const id = targetEntities(args, state)[0] ?? "";
      const name = textArg(args, "name").trim();
      const now = state.doc.entities[id]?.name;
      const ops: SceneOp[] = now === name ? [] : [{ op: "set", path: `/entities/${id}/name`, value: name }];
      return { kind: "edit", title: `Rename ${entityLabel(state.doc, id)} to ${name}`, ops: sceneOps(ops) };
    },
  },
  {
    id: "entity.hide",
    icon: "eye-off",
    menu: "entity",
    keys: ["H"],
    keyContext: "scene",
    title: "Hide or show the entities",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      visible: { type: "boolean", description: "True: show; false: hide (default: toggle).", optional: true },
    },
    selection: ENTITY_RULE,
    build: (args, state) => {
      const ids = targetEntities(args, state);
      // The toggle hides all targets when one of them shows, else it shows all of them.
      const given = args.visible;
      const visible = typeof given === "boolean" ? given : !ids.some((id) => isShown(state.doc, id));
      const ops = ids.flatMap((id) => visibilityOps(state.doc, id, visible));
      return { kind: "edit", title: `${visible ? "Show" : "Hide"} ${names(state, ids)}`, ops: sceneOps(ops) };
    },
  },
  flagCommand("solo", "entity.solo", "on", {
    title: "Solo the entities",
    on: "Solo",
    off: "Unsolo",
    menu: "entity",
    icon: "crosshair",
    keys: ["Shift+H"],
  }),
  flagCommand("locked", "entity.lock", "locked", {
    title: "Lock the entities",
    on: "Lock",
    off: "Unlock",
    menu: "entity",
    icon: "lock",
  }),
  {
    id: "view.showAll",
    icon: "eye",
    menu: "entity",
    keys: ["Alt+H"],
    keyContext: "scene",
    title: "Show all entities (no solo)",
    key: null,
    kind: "edit",
    args: {},
    selection: NO_RULE,
    when: (state) => (state.view.solo.length === 0 ? "No entity is solo." : null),
    build: () => ({ kind: "edit", title: "Show all entities", ops: [{ kind: "view", flag: "solo", ids: [] }] }),
  },
]);
