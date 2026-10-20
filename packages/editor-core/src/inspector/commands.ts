// SPDX-License-Identifier: Apache-2.0
/**
 * The inspector edits as commands: `component.set`, `component.add`, `component.remove` and `component.reset`. The ops
 * are the ops of the inspector (edits.ts). Thus a run of the person, a script or an agent gives the same change as the
 * panel. The title of the step names the component and the field ("Light: intensity"), so Undo names the field. The
 * target is the entity of the argument (`scene` for the scene values), else each selected entity. A value comes as
 * JSON text, because an argument of a command is a number, a text or a true/false value. No Vue import.
 */
import { prefabPath, type ComponentRegistry, type PrefabSet } from "@scenity/scene";
import type { ComponentDefinition } from "@scenity/scene/components";
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import { CommandError, defineCommands, textArg, type Args, type CommandHost, type SelectionItem } from "../command";
import type { SceneEditOp } from "../ops";
import type { PrefabPaths } from "../prefabs/library";
import type { RuleState } from "../registry";
import { initialComponent } from "./choices";
import { addComponentOps, fieldOps, removeComponentOps, resetToDefaultOps } from "./edits";
import { SCENE_SUBJECT, subjectsOf, type InspectorSource, type Subject } from "./subjects";

/** What the component commands read: the document, the components and the prefabs of the instances. */
export interface ComponentCommandState extends RuleState {
  readonly doc: EntityDocument;
  readonly registry: ComponentRegistry;
  /** Every selected item, the primary item first. */
  readonly selected?: readonly SelectionItem[];
  readonly prefabs?: PrefabSet;
  readonly prefabPaths?: PrefabPaths;
}

/** The name of the target of the scene values (the `scene` site of a component). */
export const SCENE_TARGET = "scene";

const ENTITY_ARG = {
  type: "string",
  description: "The entity ID, or `scene` for a value of the scene (default: each selected entity).",
  optional: true,
} as const;
const COMPONENT_ARG = { type: "string", description: "The component ID, for example `light` or `transform`." } as const;
const FIELD_ARG = {
  type: "string",
  description: "The field of the value with dots, for example `intensity` or `color.0` (default: the whole value).",
  optional: true,
} as const;

/** The inspector source of a state. */
function sourceOf(state: ComponentCommandState): InspectorSource {
  const { prefabs, prefabPaths } = state;
  if (prefabs === undefined || prefabPaths === undefined) return { doc: state.doc, registry: state.registry };
  return {
    doc: state.doc,
    registry: state.registry,
    prefab: (source) => {
      const path = prefabPath(source, prefabPaths.docPath, prefabPaths.assetPath);
      return path === undefined ? undefined : prefabs[path];
    },
  };
}

/** The definition of the component argument. */
function definitionOf(args: Args, state: ComponentCommandState): ComponentDefinition {
  const id = textArg(args, "component");
  const definition = state.registry.get(id);
  if (definition === undefined) {
    const known = state.registry.list().map((item) => item.id);
    throw new CommandError(`No component "${id}". Components: ${known.join(", ")}.`);
  }
  return definition;
}

/** The subjects of a run: the entity argument (or the scene), else each selected entity. */
function subjectsOfRun(args: Args, state: ComponentCommandState): Subject[] {
  const named = textArg(args, "entity");
  if (named === SCENE_TARGET) return [SCENE_SUBJECT];
  const ids =
    named !== ""
      ? [named]
      : (state.selected ?? (state.selection === null ? [] : [state.selection]))
          .filter((item) => item.kind === "entity")
          .map((item) => item.id);
  const subjects = subjectsOf(sourceOf(state), ids);
  if (subjects.length === 0) throw new CommandError(`No entity "${ids.join(", ") || "(none)"}" in the document.`);
  return subjects;
}

/** The value of a JSON text argument. */
function jsonArg(args: Args, name: string): unknown {
  const text = textArg(args, name);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CommandError(`"${name}" is no JSON value: ${text}`);
  }
}

/** The tokens of a field argument: the parts between the dots ("" is the whole value). */
function fieldTokens(field: string): string[] {
  return field === "" ? [] : field.split(".");
}

/** The title of a field edit: "Light: intensity", or "Light" for the whole value. */
function fieldTitle(definition: ComponentDefinition, field: string, reset = false): string {
  const name = field === "" ? definition.editor.label : `${definition.editor.label}: ${field}`;
  return reset ? `Reset ${name}` : name;
}

/** An edit result of scene ops. No op is a refusal (nothing changes). */
function edit(
  title: string,
  ops: readonly SceneOp[],
  why: string,
): { kind: "edit"; title: string; ops: SceneEditOp[] } {
  if (ops.length === 0) throw new CommandError(why);
  return { kind: "edit", title, ops: ops.map((op): SceneEditOp => ({ kind: "scene", op })) };
}

/**
 * The ops that put the values of components on the subjects of a run (the entity argument, else the selection). The
 * ops are a set of the whole value on a subject with the component, and an add on a subject without it.
 */
export function componentValueOps(
  args: Args,
  state: ComponentCommandState,
  components: Readonly<Record<string, unknown>>,
): SceneOp[] {
  const subjects = subjectsOfRun(args, state);
  return Object.entries(components).flatMap(([id, value]) => {
    const definition = definitionOf({ component: id }, state);
    return [
      ...fieldOps(sourceOf(state), subjects, definition, [], value),
      ...addComponentOps(subjects, definition, value),
    ];
  });
}

/** The component commands. */
export const COMPONENT_COMMANDS = defineCommands<ComponentCommandState, CommandHost, SceneEditOp>([
  {
    id: "component.set",
    icon: "sliders-horizontal",
    category: "component",
    title: "Set a value of a component (a field, or the whole value)",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      component: COMPONENT_ARG,
      field: FIELD_ARG,
      value: { type: "string", description: "The new value as JSON, for example `2.5`, `true` or `[1, 0.8, 0.6]`." },
    },
    selection: { kinds: ["entity"], orArg: "entity" },
    build: (args, state) => {
      const definition = definitionOf(args, state);
      const field = textArg(args, "field");
      const ops = fieldOps(
        sourceOf(state),
        subjectsOfRun(args, state),
        definition,
        fieldTokens(field),
        jsonArg(args, "value"),
      );
      return edit(fieldTitle(definition, field), ops, "The value is the same, or no target has the component.");
    },
  },
  {
    id: "component.reset",
    icon: "rotate-ccw",
    category: "component",
    title: "Put a value of a component back to its default",
    key: null,
    kind: "edit",
    args: { entity: ENTITY_ARG, component: COMPONENT_ARG, field: FIELD_ARG },
    selection: { kinds: ["entity"], orArg: "entity" },
    build: (args, state) => {
      const definition = definitionOf(args, state);
      const field = textArg(args, "field");
      const ops = resetToDefaultOps(sourceOf(state), subjectsOfRun(args, state), definition, fieldTokens(field));
      return edit(fieldTitle(definition, field, true), ops, "The value is the default already.");
    },
  },
  {
    id: "component.add",
    icon: "plus",
    category: "component",
    menu: "component",
    title: "Add a component to the entities (its default value, or a value)",
    key: null,
    kind: "edit",
    args: {
      entity: ENTITY_ARG,
      component: COMPONENT_ARG,
      value: { type: "string", description: "The value as JSON (default: the default value).", optional: true },
    },
    selection: { kinds: ["entity"], orArg: "entity" },
    build: (args, state) => {
      const definition = definitionOf(args, state);
      const value = textArg(args, "value") === "" ? initialComponent(definition) : jsonArg(args, "value");
      const ops = addComponentOps(subjectsOfRun(args, state), definition, value);
      return edit(`Add ${definition.editor.label}`, ops, "Each target has the component already.");
    },
  },
  {
    id: "component.remove",
    icon: "minus",
    category: "component",
    menu: "component",
    title: "Remove a component from the entities",
    key: null,
    kind: "edit",
    args: { entity: ENTITY_ARG, component: COMPONENT_ARG },
    selection: { kinds: ["entity"], orArg: "entity" },
    build: (args, state) => {
      const definition = definitionOf(args, state);
      const ops = removeComponentOps(subjectsOfRun(args, state), definition);
      return edit(`Remove ${definition.editor.label}`, ops, "No target has the component.");
    },
  },
]);
