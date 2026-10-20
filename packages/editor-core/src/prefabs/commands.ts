// SPDX-License-Identifier: Apache-2.0
/**
 * The prefab commands of the editor. Each command is one edit, and thus one step of the one history:
 *
 * - `prefab.apply`: the overrides of an instance (or a part of them) go into its prefab document and leave the
 *   instance. The other instances of the prefab show the change.
 * - `prefab.revert`: the overrides of an instance (or a part of them) go. The instance shows the prefab values.
 *
 * The target is the `instance` argument, else the selected entity. A selected prefab entity (`<instance>/<entity>`)
 * names its instance, and the scope is then that entity. `entity`, `component` and `field` give a smaller scope.
 * No Vue import.
 */
import type { ComponentRegistry } from "@scenity/scene/components";
import { CommandError, defineCommands, textArg, type Args, type CommandHost } from "../command";
import type { EntityState } from "../entities/commands";
import type { HierarchyOp } from "../hierarchy/commands";
import { entityLabel } from "../hierarchy/tree";
import { EditError } from "../ops";
import { instancePrefabPath, type PrefabPaths, type PrefabSet } from "./library";
import { applyOverrideOps, revertOverrideOps, type OverrideScope, type PrefabEditOp } from "./overrides";

/** What the prefab commands read: the entity state, the prefab set and the paths of the prefabs. */
export interface PrefabState extends EntityState {
  readonly prefabs: PrefabSet;
  readonly prefabPaths: PrefabPaths;
  readonly registry: ComponentRegistry;
}

/** The ops of the commands of a page with prefabs: scene ops, view ops and prefab ops. */
export type PrefabPageOp = HierarchyOp | PrefabEditOp;

const SCOPE_ARGS = {
  instance: {
    type: "string",
    description: "The ID of the instance entity (default: the selected entity; a prefab entity names its instance).",
    optional: true,
  },
  entity: { type: "string", description: "Only the overrides of this entity of the prefab.", optional: true },
  component: { type: "string", description: "Only the overrides of this component (needs entity).", optional: true },
  field: {
    type: "string",
    description: "Only the overrides of this field, its parts with '/' between them (needs component).",
    optional: true,
  },
} as const;

/** The instance and the scope of the arguments, else of the selected entity. */
export function prefabTarget(args: Args, state: PrefabState): { instance: string; scope: OverrideScope } {
  const given = textArg(args, "instance").trim();
  const selected = state.selection?.kind === "entity" ? state.selection.id : "";
  const target = given === "" ? selected : given;
  if (target === "") throw new CommandError("The command needs a prefab instance.");
  const cut = target.indexOf("/");
  const instance = cut < 0 ? target : target.slice(0, cut);
  const entity = textArg(args, "entity").trim() || (cut < 0 ? "" : target.slice(cut + 1));
  if (!Object.hasOwn(state.doc.entities, instance)) throw new CommandError(`No entity "${instance}" in the scene.`);
  if (instancePrefabPath(state.doc, instance, state.prefabPaths) === undefined) {
    throw new CommandError(`"${instance}" is not a prefab instance.`);
  }
  const component = textArg(args, "component").trim();
  const field = textArg(args, "field").trim();
  if (component !== "" && entity === "") throw new CommandError("A component scope needs an entity of the prefab.");
  if (field !== "" && component === "") throw new CommandError("A field scope needs a component.");
  const scope: OverrideScope = {
    ...(entity === "" ? {} : { entity }),
    ...(component === "" ? {} : { component }),
    ...(field === "" ? {} : { field: field.split("/") }),
  };
  return { instance, scope };
}

/** The words of a scope in a title: "Front door", "Front door / leaf", "Front door / leaf: model". */
function scopeWords(state: PrefabState, instance: string, scope: OverrideScope): string {
  const parts = [entityLabel(state.doc, instance)];
  if (scope.entity !== undefined) parts.push(` / ${scope.entity}`);
  if (scope.component !== undefined) parts.push(`: ${scope.component}`);
  if (scope.field !== undefined) parts.push(`.${scope.field.join(".")}`);
  return parts.join("");
}

/** The prefab commands. */
export const PREFAB_COMMANDS = defineCommands<PrefabState, CommandHost, PrefabPageOp>([
  {
    id: "prefab.apply",
    icon: "upload",
    title: "Apply the overrides of an instance to its prefab",
    key: null,
    kind: "edit",
    args: SCOPE_ARGS,
    selection: { kinds: ["entity"], orArg: "instance" },
    build: (args, state) => {
      const { instance, scope } = prefabTarget(args, state);
      let applied;
      try {
        applied = applyOverrideOps(
          state.doc,
          instance,
          state.prefabs,
          {
            paths: state.prefabPaths,
            registry: state.registry,
          },
          scope,
        );
      } catch (error) {
        if (error instanceof EditError) throw new CommandError(error.message);
        throw error;
      }
      const count = `${String(applied.count)} override${applied.count === 1 ? "" : "s"}`;
      return {
        kind: "edit",
        title: `Apply ${count} of ${scopeWords(state, instance, scope)} to ${applied.path}`,
        ops: applied.ops,
      };
    },
  },
  {
    id: "prefab.revert",
    icon: "undo-2",
    title: "Revert the overrides of an instance to the prefab values",
    key: null,
    kind: "edit",
    args: SCOPE_ARGS,
    selection: { kinds: ["entity"], orArg: "instance" },
    build: (args, state) => {
      const { instance, scope } = prefabTarget(args, state);
      const ops = revertOverrideOps(state.doc, instance, scope);
      if (ops.length === 0) throw new CommandError("No override to revert.");
      return {
        kind: "edit",
        title: `Revert ${scopeWords(state, instance, scope)}`,
        ops: ops.map((op) => ({ kind: "scene" as const, op })),
      };
    },
  },
]);
