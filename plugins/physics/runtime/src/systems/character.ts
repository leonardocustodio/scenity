// SPDX-License-Identifier: Apache-2.0
/**
 * The character controller of the physics plugin: the Rapier `KinematicCharacterController` moves the capsule of
 * each `physics.character` entity one fixed step at a time. The intent comes from the `physics.walk`, `physics.stop`
 * and `physics.jump` keys of the sequence (the plugin input). It can also come from the input actions of the play mode
 * (`ctx.inputs`) that the component names. input.ts gives the default actions their keys. Gravity pulls a character
 * that is not on the ground.
 *
 * The facing is a unit direction in the XZ plane, not an angle: the rotation comes from square roots only, so it has
 * the same bits on each JavaScript engine.
 */
import type { Collider, KinematicCharacterController, World } from "@dimforge/rapier3d-deterministic-compat";
import type { StepInputs } from "@scenity/scene/input";
import type { Quat } from "@scenity/scene/math";
import { DEFAULT_ACTIONS, type CharacterMove } from "../components";
import { RAPIER } from "../rapier";
import type { PhysicsInput } from "../sim/simulation";
import { CONTROLLER_OFFSET } from "./shapes";
import { GRAVITY, STEP_SECONDS, type CharacterSettings } from "./world";

/** The distance in metres at which a character snaps to the ground (on a step or a downward slope). */
const SNAP_DISTANCE = 0.1;
const DEG = Math.PI / 180;

/** The memory of one character: plain JSON. */
export interface CharacterMemory {
  /** The vertical speed in m/s. */
  readonly vy: number;
  /** The walk direction of the last move (a unit vector [x, z]), or null before the first move. */
  readonly facing: readonly [number, number] | null;
  /** The time of the last jump key that the controller used, in ms; -1 before the first. */
  readonly jump: number;
  readonly grounded: boolean;
}

export const INITIAL_CHARACTER: CharacterMemory = { vy: 0, facing: null, jump: -1, grounded: false };

/** The walk intent of a character: a direction in the XZ plane (length 0 or 1), a speed and a jump key press. */
export interface Intent {
  readonly x: number;
  readonly z: number;
  readonly speed: number;
  readonly jumpKey: boolean;
}

/** The unit vector of (x, z), or (0, 0) for a zero vector. */
function unit(x: number, z: number): [number, number] {
  const length = Math.sqrt(x * x + z * z);
  return length > 1e-9 ? [x / length, z / length] : [0, 0];
}

/**
 * The intent of a character from the plugin input and the input actions of the play mode (the actions that its
 * component names). The actions win over a walk key of the sequence. A character with `keyboard: false` does not read
 * the actions.
 */
export function intentOf(
  input: PhysicsInput | undefined,
  inputs: StepInputs | undefined,
  id: string,
  settings: CharacterSettings,
): Intent {
  const events = settings.keyboard ? inputs : undefined;
  const action = (move: CharacterMove) => settings.actions[move] ?? DEFAULT_ACTIONS[move];
  const held = (move: CharacterMove) => events?.held(action(move)) === true;
  const kx = (held("right") ? 1 : 0) - (held("left") ? 1 : 0);
  const kz = (held("back") ? 1 : 0) - (held("forward") ? 1 : 0);
  // A jump is a press in the step: an action that stays down does not jump again.
  const jumpKey = (events?.pressed(action("jump")).length ?? 0) > 0;
  if (kx !== 0 || kz !== 0) {
    const [x, z] = unit(kx, kz);
    return { x, z, speed: settings.speed, jumpKey };
  }
  const walk = input?.walks?.[id];
  const [x, z] = walk === undefined ? [0, 0] : unit(walk.direction[0], walk.direction[1]);
  return { x, z, speed: walk?.speed ?? settings.speed, jumpKey };
}

/** The rotation about Y that turns +Z to the unit direction (x, z): half-angle forms, with no trigonometry. */
export function facingRotation(facing: readonly [number, number]): Quat {
  const [x, z] = facing;
  const w = Math.sqrt(Math.max(0, (1 + z) / 2));
  const y = Math.sqrt(Math.max(0, (1 - z) / 2));
  return [0, x < 0 ? -y : y, 0, w];
}

/** A new controller with the settings of a character. The world owns it until `world.removeCharacterController`. */
export function createController(world: World, settings: CharacterSettings): KinematicCharacterController {
  const controller = world.createCharacterController(CONTROLLER_OFFSET);
  controller.setUp({ x: 0, y: 1, z: 0 });
  controller.setMaxSlopeClimbAngle(settings.maxSlope * DEG);
  controller.setMinSlopeSlideAngle(settings.maxSlope * DEG);
  if (settings.stepHeight > 0) controller.enableAutostep(settings.stepHeight, settings.radius / 2, false);
  controller.enableSnapToGround(SNAP_DISTANCE);
  controller.setApplyImpulsesToDynamicBodies(true);
  return controller;
}

/** The input of one step of one character. */
export interface CharacterStep {
  readonly world: World;
  readonly controller: KinematicCharacterController;
  readonly collider: Collider;
  readonly id: string;
  readonly settings: CharacterSettings;
  readonly input: PhysicsInput | undefined;
  readonly inputs: StepInputs | undefined;
  readonly memory: CharacterMemory;
}

/** Move one character for one fixed step: set the next place of its body, and give its new memory. */
export function stepCharacter(step: CharacterStep): CharacterMemory {
  const { controller, collider, id, settings, input, inputs, memory } = step;
  const body = collider.parent();
  if (body === null) return memory;
  const intent = intentOf(input, inputs, id, settings);
  // On the ground, the snap to the ground keeps the character down: no gravity pushes the capsule into the floor.
  let vy = memory.grounded && memory.vy <= 0 ? 0 : memory.vy + GRAVITY[1] * STEP_SECONDS;
  let jump = memory.jump;
  const jumpAt = input?.jumps?.[id];
  // A jump key counts one time. A character in the air does not jump.
  if (jumpAt !== undefined && jumpAt > jump) {
    jump = jumpAt;
    if (memory.grounded) vy = settings.jumpSpeed;
  }
  if (intent.jumpKey && memory.grounded) vy = settings.jumpSpeed;
  const desired = {
    x: intent.x * intent.speed * STEP_SECONDS,
    y: vy * STEP_SECONDS,
    z: intent.z * intent.speed * STEP_SECONDS,
  };
  controller.computeColliderMovement(collider, desired, RAPIER.QueryFilterFlags.EXCLUDE_SENSORS);
  const move = controller.computedMovement();
  const grounded = controller.computedGrounded();
  if (grounded && vy < 0) vy = 0;
  const at = body.translation();
  body.setNextKinematicTranslation({ x: at.x + move.x, y: at.y + move.y, z: at.z + move.z });
  const moving = intent.x !== 0 || intent.z !== 0;
  return { vy, facing: moving ? [intent.x, intent.z] : memory.facing, jump, grounded };
}
