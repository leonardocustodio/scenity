// SPDX-License-Identifier: Apache-2.0
/**
 * The create presets of the editor (the "Create ▸" submenu of the Entity menu). A preset is an entity with the
 * components of a kind: a shape, a light of each type, a camera, an audio source, a socket, a path, a stand point, an
 * obstacle, a note, a prefab instance or a character. Each preset is a command `entity.create.<preset>`. The person
 * runs it from the Entity menu, the + menu of the hierarchy and the search box. An agent runs it as a tool. One run
 * adds one entity as one step of the history. `yaw` and `pitch` turn the new entity (the camera "from the view" of the
 * page uses them). A preset with an input (the prefab source, the model of a character) refuses a run with no input.
 * The page asks the person for the input. No Vue import.
 */
import { qfromAxisAngle, qmul, type Quat } from "@scenity/scene/math";
import { prefabSourceSchema } from "@scenity/scene/components";
import type { Entity } from "@scenity/scene/schema/entity";
import { CommandError, defineCommands, NO_RULE, numberArg, textArg, type Args, type CommandHost } from "../command";
import type { HierarchyState } from "../hierarchy/commands";
import type { SceneEditOp } from "../ops";
import { addEntityOps, assetRefOf } from "./edits";

/** The input of a preset: the argument, its words for a person and an agent, and the components that it gives. */
export interface PresetInput {
  readonly arg: string;
  readonly description: string;
  /** The components of the input, or the reason why the input is not valid. */
  components(value: string): Readonly<Entity["components"]> | string;
}

/** A preset: its ID, its name (the name of a new entity), its icon and its components. */
export interface EntityPreset {
  readonly id: string;
  readonly name: string;
  readonly icon: string;
  readonly components: Readonly<Entity["components"]>;
  /** The value that the preset needs (a prefab source, a model asset). */
  readonly input?: PresetInput;
}

/** The prefab source of a prefab instance. */
const PREFAB_INPUT: PresetInput = {
  arg: "source",
  description: "The prefab: a path that ends in .prefab.json, relative to the scene file, or asset:<id>.",
  components: (value) =>
    prefabSourceSchema.safeParse(value).success
      ? { prefab: { source: value } }
      : `"${value}" is no prefab source: give a .prefab.json path or asset:<id>.`,
};

/** The model asset of a character. */
const CHARACTER_INPUT: PresetInput = {
  arg: "asset",
  description: "The model asset of the character: asset:<id> or the asset ID.",
  components: (value) => {
    const asset = assetRefOf(value);
    return asset === null ? `"${value}" is no asset reference.` : { model: { asset }, character: {} };
  },
};

/** The presets of the editor, in the order of the Create menu. */
export const ENTITY_PRESETS: readonly EntityPreset[] = [
  { id: "empty", name: "Empty", icon: "box-select", components: {} },
  { id: "box", name: "Box", icon: "box", components: { shape: { kind: "box" } } },
  { id: "sphere", name: "Sphere", icon: "circle", components: { shape: { kind: "sphere" } } },
  { id: "cylinder", name: "Cylinder", icon: "cylinder", components: { shape: { kind: "cylinder" } } },
  { id: "plane", name: "Plane", icon: "square", components: { shape: { kind: "plane" } } },
  { id: "pointLight", name: "Point light", icon: "lightbulb", components: { light: { type: "point" } } },
  { id: "spotLight", name: "Spot light", icon: "flashlight", components: { light: { type: "spot" } } },
  { id: "directionalLight", name: "Directional light", icon: "sun", components: { light: { type: "directional" } } },
  { id: "ambientLight", name: "Ambient light", icon: "sun-dim", components: { light: { type: "ambient" } } },
  {
    id: "hemisphereLight",
    name: "Hemisphere light",
    icon: "cloud-sun",
    components: { light: { type: "hemisphere" } },
  },
  { id: "camera", name: "Camera", icon: "video", components: { camera: { fov: 50 } } },
  { id: "audioSource", name: "Audio source", icon: "volume-2", components: { audioSource: {} } },
  { id: "socket", name: "Socket", icon: "plug", components: { socket: { points: { main: { position: [0, 0, 0] } } } } },
  {
    id: "path",
    name: "Path",
    icon: "route",
    components: {
      path: {
        points: [
          [0, 0, 0],
          [1, 0, 0],
        ],
      },
    },
  },
  { id: "standPoint", name: "Stand point", icon: "footprints", components: { standPoint: {} } },
  { id: "obstacle", name: "Obstacle", icon: "octagon", components: { obstacle: { footprint: "bounds" } } },
  { id: "note", name: "Note", icon: "sticky-note", components: { annotation: { text: "Note" } } },
  { id: "prefab", name: "Prefab instance", icon: "package", components: {}, input: PREFAB_INPUT },
  { id: "character", name: "Character", icon: "person-standing", components: {}, input: CHARACTER_INPUT },
];

const DEGREES = Math.PI / 180;

/** The turn of a new entity: `yaw` about Y, then `pitch` about X (degrees). Null when neither is given. */
function turnOf(args: Args): Quat | null {
  const yaw = numberArg(args, "yaw");
  const pitch = numberArg(args, "pitch");
  if (yaw === undefined && pitch === undefined) return null;
  const turn = qmul(qfromAxisAngle([0, 1, 0], (yaw ?? 0) * DEGREES), qfromAxisAngle([1, 0, 0], (pitch ?? 0) * DEGREES));
  return turn.map((value) => Math.round(value * 1e6) / 1e6) as unknown as Quat;
}

/** The components of a preset for a run: its own, and those of its input. */
function presetComponents(preset: EntityPreset, args: Args): Readonly<Entity["components"]> {
  const input = preset.input;
  if (input === undefined) return preset.components;
  const value = textArg(args, input.arg).trim();
  if (value === "") throw new CommandError(`${preset.name} needs "${input.arg}": ${input.description}`);
  const made = input.components(value);
  if (typeof made === "string") throw new CommandError(made);
  return { ...preset.components, ...made };
}

const AXIS = (axis: string) =>
  ({
    type: "number",
    description: `The ${axis} position in the frame of the parent (metres; default 0).`,
    optional: true,
  }) as const;

/** The parent argument of a run: an entity of the document, or null (the scene root). */
function parentOf(args: Args, state: HierarchyState): string | null {
  const parent = textArg(args, "parent").trim();
  if (parent === "") return null;
  if (!Object.hasOwn(state.doc.entities, parent)) throw new CommandError(`No entity "${parent}" in the scene.`);
  return parent;
}

/** The article of a name: "an" before a vowel. */
function article(name: string): string {
  return /^[aeiou]/i.test(name) ? "an" : "a";
}

/** The command of a preset (also of a preset of the person). */
export function presetCommand(preset: EntityPreset) {
  return {
    id: `entity.create.${preset.id}`,
    icon: preset.icon,
    category: "create",
    menu: "entity/create",
    title: `Create ${preset.id === "empty" ? "an empty entity" : `${article(preset.name)} ${preset.name.toLowerCase()}`}`,
    key: null,
    kind: "edit" as const,
    args: {
      name: { type: "string", description: `The name of the entity (default: "${preset.name}").`, optional: true },
      parent: { type: "string", description: "The ID of the parent (default: the scene root).", optional: true },
      x: AXIS("x"),
      y: AXIS("y"),
      z: AXIS("z"),
      yaw: { type: "number", description: "The turn about the up axis (degrees; default 0).", optional: true },
      pitch: {
        type: "number",
        description: "The tilt up or down after the turn (degrees; default 0).",
        optional: true,
      },
      ...(preset.input === undefined
        ? {}
        : { [preset.input.arg]: { type: "string", description: preset.input.description, optional: true } }),
    } as const,
    selection: NO_RULE,
    build: (args: Args, state: HierarchyState) => {
      const name = textArg(args, "name").trim() || preset.name;
      const position: [number, number, number] = [
        numberArg(args, "x") ?? 0,
        numberArg(args, "y") ?? 0,
        numberArg(args, "z") ?? 0,
      ];
      const components = presetComponents(preset, args);
      const turn = turnOf(args);
      const edit = addEntityOps(state.doc, { name, parent: parentOf(args, state), position });
      const ops = edit.ops.map((op): SceneEditOp => {
        if (op.op !== "add") return { kind: "scene", op };
        const placed = op.entity.components.transform as Readonly<Record<string, unknown>>;
        const transform = { ...placed, ...(turn === null ? {} : { rotation: turn }) };
        const entity: Entity = { ...op.entity, components: { ...op.entity.components, transform, ...components } };
        return { kind: "scene", op: { ...op, entity } };
      });
      return { kind: "edit" as const, title: `Create ${name}`, ops };
    },
  };
}

/** The create commands of the presets. */
export const PRESET_COMMANDS = defineCommands<HierarchyState, CommandHost, SceneEditOp>(
  ENTITY_PRESETS.map(presetCommand),
);
