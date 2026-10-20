// SPDX-License-Identifier: Apache-2.0
/**
 * The state of the traffic simulation: a straight road with lanes, a pedestrian
 * crossing with a push-button signal, the cars and the walkers. The state is plain JSON, so a checkpoint can go to a
 * file. The configuration is a part of the state: `initial` merges the `initial.traffic` value of a sequence over the
 * defaults, and each later step reads it from the state.
 *
 * Units: metres, seconds for the speeds, ms for the times. A floor point is [x, z].
 */
import { z } from "zod";

const floorPoint = z.tuple([z.number(), z.number()]);
export type FloorPoint = z.infer<typeof floorPoint>;

/** A lane: the start point, the unit heading, and the stop line and the exit as distances along the heading. */
export const laneSchema = z.strictObject({
  start: floorPoint,
  heading: floorPoint,
  /** The place of the front of a car that waits at the stop line. */
  stop: z.number().min(0),
  /** A car whose front passes this distance leaves the road. */
  exit: z.number().min(0),
});
export type Lane = z.infer<typeof laneSchema>;

/** A side of the crossing: the walk of a walker from this side, as four points (start, wait, far kerb, end). */
export const sideSchema = z.strictObject({ path: z.tuple([floorPoint, floorPoint, floorPoint, floorPoint]) });
export type Side = z.infer<typeof sideSchema>;

/** The times of the signal phases in ms. Green holds until a request, and at least `minGreen`. */
export const timingSchema = z.strictObject({
  minGreen: z.number().int().min(0),
  amber: z.number().int().min(1),
  allRed: z.number().int().min(0),
  walk: z.number().int().min(1),
  clearance: z.number().int().min(0),
});
export type Timing = z.infer<typeof timingSchema>;

/** The motion values: speeds in m/s, rates in m/s², lengths in m. */
export const motionSchema = z.strictObject({
  carSpeed: z.number().positive(),
  accel: z.number().positive(),
  /** The normal brake rate of a car that stops at a line. */
  brake: z.number().positive(),
  /** The highest brake rate: at amber, a car that cannot stop with it goes on. */
  hardBrake: z.number().positive(),
  carLength: z.number().positive(),
  /** The gap from the back of a car to the front of the car behind it in a queue. */
  gap: z.number().min(0),
  walkSpeed: z.number().positive(),
});
export type Motion = z.infer<typeof motionSchema>;

export const configSchema = z.strictObject({
  lanes: z.record(z.string(), laneSchema),
  sides: z.record(z.string(), sideSchema),
  timing: timingSchema,
  motion: motionSchema,
});
export type Config = z.infer<typeof configSchema>;

/** The phases of the signal. Cars go only on `green`. Walkers start to cross only on `walk`. */
export const PHASES = ["green", "amber", "allRed", "walk", "clearance"] as const;
export type Phase = (typeof PHASES)[number];

export const signalSchema = z.strictObject({
  phase: z.enum(PHASES),
  /** The start time of the phase (ms). */
  since: z.number(),
  /** The time of the first button press that the signal did not serve yet, or null. */
  request: z.number().nullable(),
});
export type Signal = z.infer<typeof signalSchema>;

export const carSchema = z.strictObject({
  lane: z.string(),
  /** The distance of the front along the lane (m). */
  s: z.number(),
  /** The speed (m/s). */
  v: z.number().min(0),
  /** The top speed of this car (m/s). */
  top: z.number().positive(),
  /** True when the car decided at amber to go on over the stop line. */
  committed: z.boolean(),
  /** True for a car that does not stop for the signal (a test of the rules: it enters on red). */
  ignoresSignal: z.boolean(),
});
export type Car = z.infer<typeof carSchema>;

export const walkerSchema = z.strictObject({
  side: z.string(),
  /** The part of the walk: 0 to the kerb, 1 over the road, 2 away on the far side. */
  leg: z.number().int().min(0).max(2),
  /** The distance along the part (m). */
  d: z.number().min(0),
});
export type Walker = z.infer<typeof walkerSchema>;

export const trafficStateSchema = z.strictObject({
  /** The time of the state (ms). */
  t: z.number(),
  config: configSchema,
  signal: signalSchema,
  /** The cars on the road by entity ID. A car that leaves the road goes out of the record. */
  cars: z.record(z.string(), carSchema),
  /** The walkers by entity ID. A walker at the end of the walk goes out of the record. */
  walkers: z.record(z.string(), walkerSchema),
  /** The cars whose front passed the stop line while the signal did not let them go. */
  redEntries: z.array(z.string()),
});
export type TrafficState = z.infer<typeof trafficStateSchema>;

/**
 * The default road: two lanes along X (east on +Z, west on −Z, road from z = −3 to 3), the crossing from x = −1.5 to
 * 1.5, the stop lines at x = −3 and x = 3, and a walker side on each pavement.
 */
export const DEFAULT_CONFIG: Config = {
  lanes: {
    east: { start: [-30, 1.5], heading: [1, 0], stop: 26.7, exit: 62 },
    west: { start: [30, -1.5], heading: [-1, 0], stop: 26.7, exit: 62 },
  },
  sides: {
    south: {
      path: [
        [7, 4.4],
        [0.7, 3.5],
        [0.7, -3.5],
        [-7, -4.4],
      ],
    },
    north: {
      path: [
        [-7, -4.4],
        [-0.7, -3.5],
        [-0.7, 3.5],
        [7, 4.4],
      ],
    },
  },
  timing: { minGreen: 6000, amber: 2000, allRed: 1500, walk: 4000, clearance: 5000 },
  motion: { carSpeed: 9, accel: 2.5, brake: 3.5, hardBrake: 6, carLength: 3.8, gap: 2, walkSpeed: 1.3 },
};

/** The parameters of `initial`: each part replaces the default part, and the timing and motion values merge. */
const paramsSchema = z
  .strictObject({
    lanes: z.record(z.string(), laneSchema).optional(),
    sides: z.record(z.string(), sideSchema).optional(),
    timing: timingSchema.partial().optional(),
    motion: motionSchema.partial().optional(),
  })
  .optional();

/** The base values with each given value over them. A value that the parameters leave out keeps the base value. */
function merged<T extends object>(base: T, given: { readonly [K in keyof T]?: T[K] | undefined } | undefined): T {
  const out = { ...base };
  for (const key of Object.keys(given ?? {}) as (keyof T)[]) {
    const value = given?.[key];
    if (value !== undefined) out[key] = value;
  }
  return out;
}

/** The state at t = 0 from the `initial.traffic` value of a sequence. Bad parameters throw with the zod message. */
export function initialState(params: unknown): TrafficState {
  const given = paramsSchema.parse(params) ?? {};
  const config: Config = {
    lanes: given.lanes ?? DEFAULT_CONFIG.lanes,
    sides: given.sides ?? DEFAULT_CONFIG.sides,
    timing: merged(DEFAULT_CONFIG.timing, given.timing),
    motion: merged(DEFAULT_CONFIG.motion, given.motion),
  };
  return {
    t: 0,
    config,
    signal: { phase: "green", since: 0, request: null },
    cars: {},
    walkers: {},
    redEntries: [],
  };
}
