// SPDX-License-Identifier: Apache-2.0
/**
 * The characters of a scene at a time: the IK goals of the hands and the look of the `character` component
 * on the posed models, and the variants of the look as material overrides of the model.
 *
 * - The IK runs after the animator. The hands go to their targets by the weights of the goals (`solveLimb` of
 *   `@scenity/character/ik`), and the head turns to the look target (`aimAt`). The targets are the world places of
 *   entities and sockets in the scene of the time, with no attach. A target that an attach key moves is at its place
 *   in the scene. Thus the pose at a time is a function of the documents and the time.
 * - Before the animator, the IK nodes return to their rest turns: a model with no animator does not keep the turns
 *   of an earlier frame.
 * - A variant merges its material overrides over the overrides of the `model` component (`withVariants`).
 */
import { Quaternion, Vector3, type Object3D } from "three";
import { boneNode, characterBones } from "@scenity/character/characterRig";
import { aimAt, solveLimb } from "@scenity/character/ik";
import type { BoneMap } from "@scenity/character/profiles";
import type { CharacterValue, HandGoalValue, ModelValue } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { Entity } from "@scenity/scene/schema/entity";
import { socketWorld, worldTransform } from "@scenity/scene/world";
import { entityModel } from "./animate";

/** The default turn limit of the look in radians (70°). */
export const LOOK_MAX_ANGLE = (70 * Math.PI) / 180;
/** The default pole of a right elbow in the frame of the character (+Z forward): out, down and a little back. */
const RIGHT_POLE: readonly [number, number, number] = [-0.55, -1, -0.25];

interface Rig {
  readonly key: string;
  readonly map: BoneMap;
}

/** The character value of an entity, or undefined. */
function characterOf(entity: Entity | undefined): CharacterValue | undefined {
  return entity?.components.character as CharacterValue | undefined;
}

/** The world point of an IK target (`entity:<id>` or `entity:<id>#<socket>`) in a scene, or undefined. */
export function targetWorld(scene: SceneDocument, ref: string): Vector3 | undefined {
  const socket = socketWorld(scene, ref);
  if (socket !== undefined) return new Vector3(...socket.position);
  const hash = ref.indexOf("#");
  const world = worldTransform(scene, ref.slice(7, hash < 0 ? undefined : hash));
  return world === undefined ? undefined : new Vector3(...world.position);
}

export class CharacterPoser {
  /** The rest turn of each node of a character model, from the first frame that has the model. */
  readonly #rest = new WeakMap<Object3D, Map<Object3D, Quaternion>>();
  readonly #rigs = new WeakMap<Object3D, Rig>();
  readonly #warn: (message: string) => void;

  constructor(warn: (message: string) => void = () => undefined) {
    this.#warn = warn;
  }

  /** Put the IK nodes of each character back to their rest turns (before the animator poses the models). */
  restore(scene: SceneDocument, objectOf: (id: string) => Object3D | undefined): void {
    this.#each(scene, objectOf, (_id, _value, model) => {
      for (const [node, turn] of this.#restOf(model)) node.quaternion.copy(turn);
    });
  }

  /** Apply the IK goals of each character of the scene to its posed model (after the animator). */
  solve(scene: SceneDocument, objectOf: (id: string) => Object3D | undefined): void {
    this.#each(scene, objectOf, (id, value, model, entity) => {
      const ik = value.ik;
      if (ik === undefined) return;
      const map = this.#rigOf(id, model, value);
      entity.updateWorldMatrix(true, true);
      const turn = entity.getWorldQuaternion(new Quaternion());
      this.#hand(scene, model, map, "left", ik.leftHand, turn);
      this.#hand(scene, model, map, "right", ik.rightHand, turn);
      const look = ik.look;
      const target = look?.target ?? null;
      const head = boneNode(model, map, "head") ?? boneNode(model, map, "neck");
      const point = target === null ? undefined : targetWorld(scene, target);
      if (look === undefined || head === undefined || point === undefined) return;
      const forward = new Vector3(0, 0, 1).applyQuaternion(turn);
      aimAt(head, forward, point, look.weight ?? 1, look.maxAngle ?? LOOK_MAX_ANGLE);
    });
  }

  #hand(
    scene: SceneDocument,
    model: Object3D,
    map: BoneMap,
    side: "left" | "right",
    goal: HandGoalValue | undefined,
    turn: Quaternion,
  ): void {
    const target = goal?.target ?? null;
    if (goal === undefined || target === null || (goal.weight ?? 1) <= 0) return;
    const upper = boneNode(model, map, `${side}UpperArm`);
    const lower = boneNode(model, map, `${side}LowerArm`);
    const end = boneNode(model, map, `${side}Hand`);
    const point = targetWorld(scene, target);
    if (upper === undefined || lower === undefined || end === undefined || point === undefined) return;
    // The left pole is the mirror of the right pole (the character looks along +Z, so its right is -X).
    const [x, y, z] = goal.pole ?? RIGHT_POLE;
    const pole = new Vector3(goal.pole === undefined && side === "left" ? -x : x, y, z);
    solveLimb(upper, lower, end, point, pole.applyQuaternion(turn), goal.weight ?? 1);
  }

  /** Call `act` for each entity with a `character` component and a loaded model, in the order of the IDs. */
  #each(
    scene: SceneDocument,
    objectOf: (id: string) => Object3D | undefined,
    act: (id: string, value: CharacterValue, model: Object3D, entity: Object3D) => void,
  ): void {
    for (const id of Object.keys(scene.entities).sort()) {
      const value = characterOf(scene.entities[id]);
      const entity = value === undefined ? undefined : objectOf(id);
      const model = entity === undefined ? undefined : entityModel(entity);
      if (value !== undefined && entity !== undefined && model !== undefined) act(id, value, model, entity);
    }
  }

  #restOf(model: Object3D): Map<Object3D, Quaternion> {
    let rest = this.#rest.get(model);
    if (rest === undefined) {
      rest = new Map();
      const turns = rest;
      model.traverse((node) => turns.set(node, node.quaternion.clone()));
      this.#rest.set(model, rest);
    }
    return rest;
  }

  #rigOf(id: string, model: Object3D, value: CharacterValue): BoneMap {
    const key = JSON.stringify([value.rig ?? null, value.bones ?? null]);
    const known = this.#rigs.get(model);
    if (known?.key === key) return known.map;
    const problems: string[] = [];
    const map = characterBones(model, value, problems);
    for (const problem of problems) this.#warn(`${id}: ${problem}`);
    this.#rigs.set(model, { key, map });
    return map;
  }

  /** The bone map of the model of a character entity (the attach keys resolve the bones with it). */
  bonesOf(id: string, model: Object3D, value: CharacterValue | undefined): BoneMap {
    return this.#rigOf(id, model, value ?? {});
  }
}

/** The merged model values of the variants: by the model value, the variant name and its overrides. */
const merged = new WeakMap<object, { readonly variant: object; readonly value: ModelValue }>();

/**
 * The scene with the active variant of each character merged into its model value. An entity with no variant keeps
 * its object, and a merged value keeps its object over frames, so the builder sees no change from frame to frame.
 */
export function withVariants(scene: SceneDocument): SceneDocument {
  let entities: Record<string, Entity> | undefined;
  for (const [id, entity] of Object.entries(scene.entities)) {
    const value = characterOf(entity);
    const variant = value?.variant === undefined ? undefined : value.variants?.[value.variant];
    const model = entity.components.model as ModelValue | undefined;
    if (variant === undefined || model === undefined) continue;
    let known = merged.get(model);
    if (known?.variant !== variant) {
      known = { variant, value: { ...model, materials: { ...model.materials, ...variant } } };
      merged.set(model, known);
    }
    entities ??= { ...scene.entities };
    entities[id] = { ...entity, components: { ...entity.components, model: known.value } };
  }
  return entities === undefined ? scene : { ...scene, entities };
}
