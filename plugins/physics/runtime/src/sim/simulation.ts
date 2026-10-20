// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation face of the physics plugin: the meaning of the `physics.*` action keys of a sequence.
 * The entity of a key is the entity of its track.
 *
 * - `physics.walk` `{ direction: [x, z], speed? }`: the character walks in the world direction (X, Z) from the key on.
 * - `physics.stop`: the character stops.
 * - `physics.jump`: the character jumps one time, when it stands on the ground.
 * - `physics.impulse` `{ impulse: [x, y, z] }`: a dynamic body gets one impulse in N·s.
 *
 * The state is plain JSON. `project` gives it to the physics system as its input (`PhysicsInput`). The system applies
 * a jump or an impulse one time: at the first step at or after the time of its key.
 */
import { z } from "zod";
import { defineSimulation, type SimulationAction } from "@scenity/scene/sequence";

const vec2 = z.tuple([z.number(), z.number()]);
const vec3 = z.tuple([z.number(), z.number(), z.number()]);

export const walkSchema = z.strictObject({ direction: vec2, speed: z.number().min(0).max(50).optional() });
export type Walk = z.infer<typeof walkSchema>;

/** A pulse: a key that the system applies one time. `t` is the time of the key in ms. */
export const impulseSchema = z.strictObject({ t: z.number(), impulse: vec3 });
export type Impulse = z.infer<typeof impulseSchema>;

export const physicsStateSchema = z.strictObject({
  /** The walk of each character, by entity ID. */
  walks: z.record(z.string(), walkSchema),
  /** The time of the last jump key of each character, by entity ID. */
  jumps: z.record(z.string(), z.number()),
  /** The last impulse key of each body, by entity ID. */
  impulses: z.record(z.string(), impulseSchema),
});
export type PhysicsState = z.infer<typeof physicsStateSchema>;

/** The input of the physics system: the projection of the simulation. The play mode keys come in `ctx.inputs`. */
export interface PhysicsInput {
  readonly walks?: Readonly<Record<string, Walk>>;
  readonly jumps?: Readonly<Record<string, number>>;
  readonly impulses?: Readonly<Record<string, Impulse>>;
}

export const INITIAL_STATE: PhysicsState = { walks: {}, jumps: {}, impulses: {} };

/** A copy of a record with one key changed, or removed when `value` is undefined. */
function withEntry<V>(record: Readonly<Record<string, V>>, key: string, value: V | undefined): Record<string, V> {
  const rest = Object.fromEntries(Object.entries(record).filter(([name]) => name !== key));
  return value === undefined ? rest : { ...rest, [key]: value };
}

/** The walk of a `physics.walk` key, or undefined when its arguments are not a walk. */
function walkOf(key: SimulationAction): Walk | undefined {
  const parsed = walkSchema.safeParse(key.args);
  return parsed.success ? parsed.data : undefined;
}

/** The state after one action key. A key of another name or with bad arguments changes nothing. */
export function reducePhysics(state: PhysicsState, key: SimulationAction): PhysicsState {
  const entity = key.entity;
  if (entity === undefined) return state;
  switch (key.action) {
    case "physics.walk": {
      const walk = walkOf(key);
      return walk === undefined ? state : { ...state, walks: withEntry(state.walks, entity, walk) };
    }
    case "physics.stop":
      return { ...state, walks: withEntry<Walk>(state.walks, entity, undefined) };
    case "physics.jump":
      return { ...state, jumps: withEntry(state.jumps, entity, key.t) };
    case "physics.impulse": {
      const parsed = vec3.safeParse((key.args as { impulse?: unknown } | undefined)?.impulse);
      if (!parsed.success) return state;
      return { ...state, impulses: withEntry(state.impulses, entity, { t: key.t, impulse: parsed.data }) };
    }
    default:
      return state;
  }
}

export const physicsSimulation = defineSimulation<PhysicsState, PhysicsInput>({
  id: "physics",
  stateSchema: physicsStateSchema,
  initial: () => INITIAL_STATE,
  reduce: reducePhysics,
  settle: (state) => state,
  project: (state) => state,
});
