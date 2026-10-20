// SPDX-License-Identifier: Apache-2.0
/**
 * One step of the traffic simulation: the signal, the walkers and the cars from
 * the time of the state to a later time. `settle` (simulation.ts) runs the steps on a fixed grid of `STEP_MS`, so the
 * state at a time is a function of the keys and the time.
 *
 * - A walker walks to the kerb and presses the button when it arrives. It waits until the walk phase, crosses, and
 *   walks away on the far side. At the end of the walk it goes out of the state.
 * - A car drives at its top speed. Before the stop line it stops when the signal does not let it go, or when a walker
 *   is on the road. At amber, a car that cannot stop with the hard brake rate goes on (it is "committed"). In a queue
 *   a car keeps a gap to the car ahead. Past the exit of its lane it goes out of the state.
 * - A car whose front passes the stop line while the signal does not let it go (and that is not committed) goes into
 *   `redEntries`. With correct cars the list stays empty. A car with `ignoresSignal` adds to it.
 */
import { pressed, signalAt, stopsCars } from "./signals";
import type { Car, Config, FloorPoint, Phase, Side, TrafficState, Walker } from "./state";

/** The step of the simulation in ms. */
export const STEP_MS = 50;

/** The two ends of a part of the walk of a side. */
export function legEnds(side: Side, leg: number): [FloorPoint, FloorPoint] {
  return [side.path[leg] ?? side.path[0], side.path[leg + 1] ?? side.path[3]];
}

/** The length of a part of the walk of a side. */
export function legLength(side: Side, leg: number): number {
  const [a, b] = legEnds(side, leg);
  return Math.hypot(b[0] - a[0], b[1] - a[1]);
}

/** The walkers after one step, and the times of their button presses. */
function stepWalkers(
  config: Config,
  walkers: TrafficState["walkers"],
  phase: Phase,
  t0: number,
  t1: number,
): { walkers: Record<string, Walker>; presses: number[] } {
  const speed = config.motion.walkSpeed;
  const out: Record<string, Walker> = {};
  const presses: number[] = [];
  for (const id of Object.keys(walkers).sort()) {
    const walker = walkers[id];
    const side = walker === undefined ? undefined : config.sides[walker.side];
    if (walker === undefined || side === undefined) continue;
    let { leg, d } = walker;
    let budget = (speed * (t1 - t0)) / 1000;
    if (leg === 0) {
      const left = legLength(side, 0) - d;
      if (budget < left) {
        d += budget;
        budget = 0;
      } else {
        // The walker comes to the kerb in this step: a press at the time of the arrival, unless the walk is on.
        if (left > 0 && phase !== "walk") presses.push(Math.round(t0 + (left / speed) * 1000));
        d = legLength(side, 0);
        budget -= Math.max(0, left);
        if (phase !== "walk") budget = 0;
        else {
          leg = 1;
          d = 0;
        }
      }
    }
    if (leg > 0) d += budget;
    while (leg < 3 && leg > 0 && d >= legLength(side, leg)) {
      d -= legLength(side, leg);
      leg += 1;
    }
    if (leg >= 3) continue;
    out[id] = { side: walker.side, leg, d };
  }
  return { walkers: out, presses };
}

/** The cars of each lane from the front of the queue to its end (the larger distance first). */
function laneQueues(cars: TrafficState["cars"]): string[][] {
  const lanes = new Map<string, string[]>();
  for (const id of Object.keys(cars).sort()) {
    const car = cars[id];
    if (car !== undefined) lanes.set(car.lane, [...(lanes.get(car.lane) ?? []), id]);
  }
  return [...lanes.keys()].sort().map((lane) => {
    const ids = lanes.get(lane) ?? [];
    return ids.sort((a, b) => (cars[b]?.s ?? 0) - (cars[a]?.s ?? 0) || a.localeCompare(b));
  });
}

/** The cars after one step, and the cars that passed the stop line on red in this step. */
function stepCars(
  config: Config,
  cars: TrafficState["cars"],
  phase: Phase,
  walkersOnRoad: boolean,
  dt: number,
): { cars: Record<string, Car>; entries: string[] } {
  const { accel, brake, hardBrake, carLength, gap } = config.motion;
  const out: Record<string, Car> = {};
  const entries: string[] = [];
  for (const queue of laneQueues(cars)) {
    let ahead: number | null = null;
    for (const id of queue) {
      const car = cars[id];
      const lane = car === undefined ? undefined : config.lanes[car.lane];
      if (car === undefined || lane === undefined) continue;
      const before = car.s <= lane.stop;
      let committed = car.committed;
      if (before && phase === "amber" && !committed && !car.ignoresSignal) {
        committed = (car.v * car.v) / (2 * hardBrake) > lane.stop - car.s;
      }
      const stop = before && !car.ignoresSignal && ((stopsCars(phase) && !committed) || walkersOnRoad);
      let limit = stop ? lane.stop : Number.POSITIVE_INFINITY;
      if (ahead !== null) limit = Math.min(limit, ahead - carLength - gap);
      const allowed = Number.isFinite(limit) ? Math.sqrt(2 * brake * Math.max(0, limit - car.s)) : car.top;
      const v = Math.min(car.top, car.v + accel * dt, allowed);
      const s = Math.min(car.s + v * dt, Math.max(car.s, limit));
      const crossed = before && s > lane.stop;
      if (crossed && stopsCars(phase) && !committed) entries.push(id);
      ahead = s;
      if (s >= lane.exit) continue;
      out[id] = { ...car, s, v, committed: crossed ? false : committed };
    }
  }
  return { cars: out, entries };
}

/** The state at the time `t1` after one step from the time of the state. `t1` must not be before the state time. */
export function step(state: TrafficState, t1: number): TrafficState {
  const { config } = state;
  let signal = signalAt(state.signal, config.timing, t1);
  const walked = stepWalkers(config, state.walkers, signal.phase, state.t, t1);
  for (const at of walked.presses) signal = signalAt(pressed(signal, at), config.timing, t1);
  const onRoad = Object.values(walked.walkers).some((walker) => walker.leg === 1);
  const driven = stepCars(config, state.cars, signal.phase, onRoad, (t1 - state.t) / 1000);
  const redEntries = driven.entries.length === 0 ? state.redEntries : [...state.redEntries, ...driven.entries];
  return { ...state, t: t1, signal, walkers: walked.walkers, cars: driven.cars, redEntries };
}

/** The state at the time `t`: the steps on the grid of `STEP_MS` from the state time. An earlier `t` has no effect. */
export function settleTraffic(state: TrafficState, t: number): TrafficState {
  let out = state;
  while (out.t < t) out = step(out, Math.min(t, (Math.floor(out.t / STEP_MS) + 1) * STEP_MS));
  return out;
}
