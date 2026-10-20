// SPDX-License-Identifier: Apache-2.0
/**
 * The system `physics.world`. It builds a Rapier world from the scene at the
 * first step, and then steps the world one fixed step (1/60 s) for each step of the systems (whole ms: 0, 17, 33, 50,
 * ...). Before each step, a kinematic body goes to the transform of its entity in the frame (the document and the
 * sequence), the character controller moves each character, and a dynamic body gets the impulse keys of the sequence.
 * After the step, the system writes the transform of each dynamic body and each character.
 *
 * The memory is the world as a Rapier snapshot (base64 text), the bodies by entity, the memory of each character and
 * the impulse keys that applied. Thus `save` and `restore` give a seek the frame of a play. The system registers the
 * ray casts of its world under its core (queries.ts).
 */
import type { KinematicCharacterController, World } from "@dimforge/rapier3d-deterministic-compat";
import { lastStep } from "@scenity/runtime/systemSteps";
import { defineSystem, type SystemContext, type SystemDefinition } from "@scenity/runtime/systems";
import type { Quat, Vec3 } from "@scenity/scene/math";
import { PHYSICS_ORDER, registerPhysicsQueries, type RayHit, type RayOptions } from "../queries";
import { RAPIER } from "../rapier";
import type { PhysicsInput } from "../sim/simulation";
import { INITIAL_CHARACTER, createController, facingRotation, stepCharacter, type CharacterMemory } from "./character";
import { localPlace, worldPlace } from "./places";
import { decodeBytes, encodeBytes } from "./snapshot";
import { buildWorld, characterSettings, physicsValues, type BodyEntry } from "./world";

/** The memory of the system: plain JSON. */
export interface PhysicsMemory {
  /** The last fixed step of the world, or -1 when the system has no world. */
  readonly step: number;
  /** The step of the build of the world. The ray casts see no collider before the first step after it. */
  readonly built: number;
  /** The world as a Rapier snapshot in base64 text, or null before the first step. */
  readonly world: string | null;
  readonly bodies: Readonly<Record<string, BodyEntry>>;
  readonly characters: Readonly<Record<string, CharacterMemory>>;
  /** The time in ms of the last impulse key that applied to each body. */
  readonly impulses: Readonly<Record<string, number>>;
}

const NO_WORLD: PhysicsMemory = { step: -1, built: -1, world: null, bodies: {}, characters: {}, impulses: {} };

/** The live state of the system: the Rapier world and the JSON parts of the memory. */
interface Live {
  readonly world: World;
  readonly bodies: Readonly<Record<string, BodyEntry>>;
  /** The entity ID of each collider handle. */
  readonly owners: Readonly<Record<string, string>>;
  /** The entity IDs of the bodies, in sort order. */
  readonly ids: readonly string[];
  characters: Record<string, CharacterMemory>;
  impulses: Record<string, number>;
  step: number;
  readonly built: number;
  /** The character controllers by entity ID. They are not part of the memory: the system makes them again. */
  readonly controllers: Record<string, KinematicCharacterController>;
}

type Context = SystemContext<PhysicsInput | undefined>;

function liveOf(world: World, memory: Omit<PhysicsMemory, "world">): Live {
  const owners: Record<string, string> = {};
  const ids = Object.keys(memory.bodies).sort();
  for (const id of ids) {
    const collider = memory.bodies[id]?.collider;
    if (collider !== null && collider !== undefined) owners[String(collider)] = id;
  }
  return {
    world,
    bodies: memory.bodies,
    owners,
    ids,
    characters: { ...memory.characters },
    impulses: { ...memory.impulses },
    step: memory.step,
    built: memory.built,
    controllers: {},
  };
}

/** Free the controllers and the WASM memory of a world. */
function dispose(live: Live | null): void {
  if (live === null) return;
  for (const id of Object.keys(live.controllers).sort()) {
    const controller = live.controllers[id];
    if (controller !== undefined) live.world.removeCharacterController(controller);
  }
  live.world.free();
}

/** The controller of a character, made on the first use in a world. */
function controllerOf(live: Live, id: string, ctx: Context): KinematicCharacterController {
  const known = live.controllers[id];
  if (known !== undefined) return known;
  const value = physicsValues(ctx.frame.scene.entities[id]?.components ?? {})?.character ?? {};
  const controller = createController(live.world, characterSettings(value));
  live.controllers[id] = controller;
  return controller;
}

/** Prepare one body for the next step: a kinematic target, a character move or an impulse key. */
function prepareBody(live: Live, id: string, entry: BodyEntry, ctx: Context): void {
  const body = live.world.getRigidBody(entry.body);
  if (entry.kind === "kinematic") {
    const place = worldPlace(ctx.frame.scene, id);
    if (place === undefined) return;
    const [x, y, z] = place.position;
    const [rx, ry, rz, rw] = place.rotation;
    body.setNextKinematicTranslation({ x, y, z });
    body.setNextKinematicRotation({ x: rx, y: ry, z: rz, w: rw });
  } else if (entry.kind === "character" && entry.collider !== null) {
    const settings = characterSettings(physicsValues(ctx.frame.scene.entities[id]?.components ?? {})?.character ?? {});
    live.characters[id] = stepCharacter({
      world: live.world,
      controller: controllerOf(live, id, ctx),
      collider: live.world.getCollider(entry.collider),
      id,
      settings,
      input: ctx.input,
      inputs: ctx.inputs,
      memory: live.characters[id] ?? INITIAL_CHARACTER,
    });
  } else if (entry.kind === "dynamic") {
    const impulse = ctx.input?.impulses?.[id];
    if (impulse === undefined || impulse.t > ctx.t || impulse.t <= (live.impulses[id] ?? -1)) return;
    const [x, y, z] = impulse.impulse;
    body.applyImpulse({ x, y, z }, true);
    live.impulses[id] = impulse.t;
  }
}

/**
 * Run one fixed step of the world. The characters wait for the first step after the build: before it, the ray and
 * shape casts of the controller see no collider, and a character would fall into the floor.
 */
function stepWorld(live: Live, ctx: Context): void {
  const queries = live.step > live.built;
  for (const id of live.ids) {
    const entry = live.bodies[id];
    if (entry === undefined || entry.kind === "fixed" || (entry.kind === "character" && !queries)) continue;
    prepareBody(live, id, entry, ctx);
  }
  live.world.step();
  live.step += 1;
}

/** Write the transform of each dynamic body and each character, in the frame of the parent of its entity. */
function writeOutputs(live: Live, ctx: Context): void {
  for (const id of live.ids) {
    const entry = live.bodies[id];
    if (entry === undefined || (entry.kind !== "dynamic" && entry.kind !== "character")) continue;
    const body = live.world.getRigidBody(entry.body);
    const at = body.translation();
    const turn = body.rotation();
    const facing = live.characters[id]?.facing;
    const rotation: Quat | undefined =
      entry.kind === "dynamic" ? [turn.x, turn.y, turn.z, turn.w] : facing ? facingRotation(facing) : undefined;
    const local = localPlace(ctx.frame.scene, entry.parent, [at.x, at.y, at.z], rotation);
    ctx.out.setTransform(id, local);
  }
}

/** The first hit of a ray in a live world. */
function castRay(live: Live, origin: Vec3, direction: Vec3, maxDistance: number, options: RayOptions): RayHit | null {
  const [dx, dy, dz] = direction;
  const length = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (!(length > 0) || !(maxDistance > 0)) return null;
  const dir = { x: dx / length, y: dy / length, z: dz / length };
  const ray = new RAPIER.Ray({ x: origin[0], y: origin[1], z: origin[2] }, dir);
  const flags = options.sensors === true ? undefined : RAPIER.QueryFilterFlags.EXCLUDE_SENSORS;
  const excluded = options.exclude === undefined ? undefined : live.bodies[options.exclude];
  const body = excluded === undefined ? undefined : live.world.getRigidBody(excluded.body);
  const hit = live.world.castRayAndGetNormal(ray, maxDistance, true, flags, undefined, undefined, body);
  if (hit === null) return null;
  const entity = live.owners[String(hit.collider.handle)];
  if (entity === undefined) return null;
  const distance = hit.timeOfImpact;
  return {
    entity,
    distance,
    point: [origin[0] + dir.x * distance, origin[1] + dir.y * distance, origin[2] + dir.z * distance],
    normal: [hit.normal.x, hit.normal.y, hit.normal.z],
  };
}

/** A new physics system with its own world. `core` is the core of the runner: the ray casts register under it. */
export function physicsSystem(core?: unknown): SystemDefinition<PhysicsInput | undefined, PhysicsMemory> {
  let live: Live | null = null;
  registerPhysicsQueries(core, {
    castRay: (origin, direction, maxDistance, options = {}) =>
      live === null ? null : castRay(live, origin, direction, maxDistance, options),
  });
  return defineSystem<PhysicsInput | undefined, PhysicsMemory>({
    id: "physics.world",
    order: PHYSICS_ORDER,
    reads: ["physics.collider", "physics.rigidBody", "physics.character", "transform", "shape"],
    update(ctx) {
      const target = lastStep(ctx.t);
      if (live === null) {
        const built = buildWorld(ctx.frame.scene);
        live = liveOf(built.world, { ...NO_WORLD, bodies: built.bodies, step: target, built: target });
      }
      while (live.step < target) stepWorld(live, ctx);
      writeOutputs(live, ctx);
    },
    save: () =>
      live === null
        ? NO_WORLD
        : {
            step: live.step,
            built: live.built,
            world: encodeBytes(live.world.takeSnapshot()),
            bodies: live.bodies,
            characters: live.characters,
            impulses: live.impulses,
          },
    restore(memory) {
      dispose(live);
      live = null;
      if (memory.world === null) return;
      live = liveOf(RAPIER.World.restoreSnapshot(decodeBytes(memory.world)), memory);
    },
  });
}
