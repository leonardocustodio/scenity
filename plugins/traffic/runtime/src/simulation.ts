// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation face of the traffic plugin: the meaning of the
 * `traffic.*` action keys of a sequence. The entity of a key is the entity of its track, else the `entity` argument.
 *
 * - `traffic.car` `{ lane, speed?, ignoresSignal? }`: the car comes onto the start of the lane at its top speed.
 * - `traffic.walker` `{ side }`: the walker starts its walk on that side of the crossing.
 * - `traffic.button`: a press of the button of the crossing (also the key of the play mode, input.ts). The key of a
 *   button release (`kind: "release"`) changes nothing.
 *
 * `settle` runs the steps of traffic.ts to the time. `project` gives the system (systems/road.ts) the phase, the place
 * of each car and walker, and the red entries.
 */
import { defineSimulation, type SimulationAction } from "@scenity/scene/sequence";
import { pressed, signalAt } from "./signals";
import { initialState, trafficStateSchema, type FloorPoint, type TrafficState } from "./state";
import { legEnds, settleTraffic } from "./traffic";

/** A quaternion [x, y, z, w]. */
export type Quat = [number, number, number, number];

/** The place of a car or a walker in the world. */
export interface Placement {
  readonly position: [number, number, number];
  readonly rotation: Quat;
}

/** The input of the road system: the projection of the simulation. */
export interface TrafficInput {
  readonly phase: TrafficState["signal"]["phase"];
  readonly cars: Readonly<Record<string, Placement>>;
  readonly walkers: Readonly<Record<string, Placement>>;
  readonly redEntries: readonly string[];
}

/** The text argument `name` of a key, or undefined. */
function textArg(key: SimulationAction, name: string): string | undefined {
  const value = key.args?.[name];
  return typeof value === "string" ? value : undefined;
}

/** The state after one action key. A key of another name or with bad arguments changes nothing. */
export function reduceTraffic(state: TrafficState, key: SimulationAction): TrafficState {
  const entity = key.entity ?? textArg(key, "entity");
  switch (key.action) {
    case "traffic.button": {
      if (textArg(key, "kind") === "release") return state;
      return { ...state, signal: pressed(signalAt(state.signal, state.config.timing, key.t), key.t) };
    }
    case "traffic.car": {
      const lane = textArg(key, "lane");
      if (entity === undefined || lane === undefined || state.config.lanes[lane] === undefined) return state;
      if (Object.hasOwn(state.cars, entity)) return state;
      const speed = key.args?.speed;
      const top = typeof speed === "number" && speed > 0 ? speed : state.config.motion.carSpeed;
      const car = { lane, s: 0, v: top, top, committed: false, ignoresSignal: key.args?.ignoresSignal === true };
      return { ...state, cars: { ...state.cars, [entity]: car } };
    }
    case "traffic.walker": {
      const side = textArg(key, "side");
      if (entity === undefined || side === undefined || state.config.sides[side] === undefined) return state;
      if (Object.hasOwn(state.walkers, entity)) return state;
      return { ...state, walkers: { ...state.walkers, [entity]: { side, leg: 0, d: 0 } } };
    }
    default:
      return state;
  }
}

/** The turn about the up axis (Y) by `angle` radians. */
function yawQuat(angle: number): Quat {
  return [0, Math.sin(angle / 2), 0, Math.cos(angle / 2)];
}

/** A number on a grid of 0.1 mm, so the frames do not change with float noise. */
const round = (value: number): number => Math.round(value * 10_000) / 10_000;

/** The place of a car: its centre is half a car length behind its front, and its +X axis points along the lane. */
function carPlacement(state: TrafficState, id: string): Placement | null {
  const car = state.cars[id];
  const lane = car === undefined ? undefined : state.config.lanes[car.lane];
  if (car === undefined || lane === undefined) return null;
  const back = car.s - state.config.motion.carLength / 2;
  const [hx, hz] = lane.heading;
  const position: [number, number, number] = [round(lane.start[0] + hx * back), 0, round(lane.start[1] + hz * back)];
  // `|| 0` turns −0 into 0, so the west lane turns by +π (the same turn as −π, with the positive quaternion).
  return { position, rotation: yawQuat(Math.atan2(-hz || 0, hx)) };
}

/** The place of a walker on its part of the walk. Its +Z axis points along the walk. */
function walkerPlacement(state: TrafficState, id: string): Placement | null {
  const walker = state.walkers[id];
  const side = walker === undefined ? undefined : state.config.sides[walker.side];
  if (walker === undefined || side === undefined) return null;
  const [a, b]: [FloorPoint, FloorPoint] = legEnds(side, walker.leg);
  const length = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
  const share = Math.min(1, walker.d / length);
  const position: [number, number, number] = [
    round(a[0] + (b[0] - a[0]) * share),
    0,
    round(a[1] + (b[1] - a[1]) * share),
  ];
  return { position, rotation: yawQuat(Math.atan2(b[0] - a[0], b[1] - a[1])) };
}

/** The input of the road system at the time of a settled state. */
export function projectTraffic(state: TrafficState): TrafficInput {
  const places = (ids: string[], place: (state: TrafficState, id: string) => Placement | null) => {
    const out: Record<string, Placement> = {};
    for (const id of ids.sort()) {
      const placement = place(state, id);
      if (placement !== null) out[id] = placement;
    }
    return out;
  };
  return {
    phase: state.signal.phase,
    cars: places(Object.keys(state.cars), carPlacement),
    walkers: places(Object.keys(state.walkers), walkerPlacement),
    redEntries: state.redEntries,
  };
}

export const trafficSimulation = defineSimulation<TrafficState, TrafficInput>({
  id: "traffic",
  stateSchema: trafficStateSchema,
  initial: (params) => initialState(params),
  reduce: reduceTraffic,
  settle: settleTraffic,
  project: (state, t) => projectTraffic(settleTraffic(state, t)),
});
