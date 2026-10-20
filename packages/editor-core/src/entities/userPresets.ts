// SPDX-License-Identifier: Apache-2.0
/**
 * The presets of the person. "Save as a preset" keeps the components of an entity (with no transform) or the value of
 * one component under a name. The presets of the person are the same for each project, because the browser storage
 * keeps them. Each entity preset is a create command `entity.create.user.<id>` in the Create menu. Each preset is
 * also an apply command `preset.apply.<id>`. It puts its values on the entities of a run as one step: a set of a
 * component that the entity has, and an add of a component that it does not have. No DOM, no Vue.
 */
import type { EntityDocument } from "@scenity/scene/schema/documents";
import type { Entity } from "@scenity/scene/schema/entity";
import { CommandError, defineCommands, type Args, type CommandHost } from "../command";
import type { HierarchyState } from "../hierarchy/commands";
import { componentValueOps, type ComponentCommandState } from "../inspector/commands";
import type { SceneEditOp } from "../ops";
import type { DraftStorage } from "../sceneFile";
import { presetCommand } from "./presets";

/** The storage key of the presets of the person. */
export const USER_PRESETS_KEY = "scenity.presets.user";

/** A preset of the person: an entity preset (no `component`) or the value of one component. */
export interface UserPreset {
  /** A camelCase ID, unique in the list. */
  readonly id: string;
  readonly name: string;
  /** The component of a component preset. An entity preset has none. */
  readonly component?: string;
  readonly components: Readonly<Entity["components"]>;
}

type Storage = Pick<DraftStorage, "getItem" | "setItem"> | null;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** A preset of the storage, or null when the value is not a preset. */
function presetOf(value: unknown): UserPreset | null {
  if (!isRecord(value) || typeof value.id !== "string" || typeof value.name !== "string") return null;
  if (!/^[a-z][A-Za-z0-9]*$/.test(value.id) || !isRecord(value.components)) return null;
  if (value.component !== undefined && typeof value.component !== "string") return null;
  return {
    id: value.id,
    name: value.name,
    ...(value.component === undefined ? {} : { component: value.component }),
    components: value.components,
  };
}

/** The presets of the person (none: no storage, no value, or a value that does not read). */
export function readUserPresets(storage: Storage): UserPreset[] {
  try {
    const parsed = JSON.parse(storage?.getItem(USER_PRESETS_KEY) ?? "[]") as unknown;
    return Array.isArray(parsed) ? parsed.flatMap((item) => presetOf(item) ?? []) : [];
  } catch {
    return [];
  }
}

/** Keep the presets of the person. False when the storage refuses them. */
export function writeUserPresets(storage: Storage, presets: readonly UserPreset[]): boolean {
  try {
    if (storage === null) return false;
    storage.setItem(USER_PRESETS_KEY, JSON.stringify(presets));
    return true;
  } catch {
    return false;
  }
}

/** A camelCase ID of a name that no preset of the list uses ("Warm lamp" gives `warmLamp`, then `warmLamp2`). */
export function userPresetId(name: string, presets: readonly UserPreset[]): string {
  const words = name.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const joined = words
    .map((word, index) => (index === 0 ? word : `${word.charAt(0).toUpperCase()}${word.slice(1)}`))
    .join("");
  const base = /^[a-z]/.test(joined) ? joined : `preset${joined[0]?.toUpperCase() ?? ""}${joined.slice(1)}`;
  const used = new Set(presets.map((preset) => preset.id));
  let id = base;
  for (let count = 2; used.has(id); count += 1) id = `${base}${String(count)}`;
  return id;
}

/** A new preset of the components of an entity (no transform), or of one component of it. */
export function makeUserPreset(
  doc: EntityDocument,
  entity: string,
  name: string,
  presets: readonly UserPreset[],
  component?: string,
): UserPreset {
  const found = doc.entities[entity];
  if (found === undefined) throw new CommandError(`No entity "${entity}" in the scene.`);
  const label = name.trim();
  if (label === "") throw new CommandError("A preset needs a name.");
  const id = userPresetId(label, presets);
  if (component === undefined) {
    const components = Object.fromEntries(Object.entries(found.components).filter(([key]) => key !== "transform"));
    return { id, name: label, components };
  }
  const value = found.components[component];
  if (value === undefined) throw new CommandError(`The entity "${entity}" has no ${component} component.`);
  return { id, name: label, component, components: { [component]: value } };
}

/** The create commands of the entity presets and the apply commands of each preset. */
export function userPresetCommands(presets: readonly UserPreset[]) {
  const create = presets
    .filter((preset) => preset.component === undefined)
    .map((preset) =>
      presetCommand({ id: `user.${preset.id}`, name: preset.name, icon: "bookmark", components: preset.components }),
    );
  const apply = presets.map((preset) => ({
    id: `preset.apply.${preset.id}`,
    icon: "bookmark-check",
    category: "component",
    title: `Apply the preset ${preset.name}`,
    key: null,
    kind: "edit" as const,
    args: {
      entity: { type: "string", description: "The entity ID (default: each selected entity).", optional: true },
    } as const,
    selection: { kinds: ["entity"], orArg: "entity" } as const,
    build: (args: Args, state: ComponentCommandState) => {
      const ops = componentValueOps(args, state, preset.components);
      if (ops.length === 0) throw new CommandError("The values are the same.");
      return {
        kind: "edit" as const,
        title: `Apply ${preset.name}`,
        ops: ops.map((op): SceneEditOp => ({ kind: "scene", op })),
      };
    },
  }));
  return {
    create: defineCommands<HierarchyState, CommandHost, SceneEditOp>(create),
    apply: defineCommands<ComponentCommandState, CommandHost, SceneEditOp>(apply),
  };
}
