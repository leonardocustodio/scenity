// SPDX-License-Identifier: Apache-2.0
/**
 * The state machines of the animator layers. A run holds the state of each layer after the last
 * check. The checks are at fixed times: each multiple of the step, each parameter change, each exit time and each
 * crossfade end. A transition goes only at a check, and a run moves only from check to check, so the run at a time
 * does not depend on the frames before it: a seek equals a play.
 */
import {
  ANY_STATE,
  DEFAULT_FADE_MS,
  DEFAULT_STEP_MS,
  type AnimatorCondition,
  type AnimatorLayer,
  type AnimatorTransition,
  type AnimatorValue,
} from "@scenity/scene/components";
import { stateRate, type ClipLengths } from "./motion";
import type { ParameterSource, Parameters } from "./parameters";

/** A small tolerance for the compare of a normalized time with an exit time. */
const EPSILON = 1e-9;
/** The number of rate changes that a state keeps for `timeAtPhase` (the foot lock looks back in time with it). */
const MARK_LIMIT = 64;

/** A rate change of a state: from `t`, the normalized time is `phase + (time - t) × rate`. */
export interface Mark {
  readonly t: number;
  readonly phase: number;
  readonly rate: number;
}

/** The run of one state: its entry time and its normalized time at the last check. */
export interface StateRun {
  readonly state: string;
  readonly enter: number;
  base: number;
  phase: number;
  rate: number;
  marks: Mark[];
}

/** The run of one layer: the current state and, in a crossfade, the state before it. */
export interface LayerRun {
  current: StateRun;
  previous: StateRun | null;
  fadeStart: number;
  fadeMs: number;
}

/** The runs of all layers after the check at `t`. */
export interface MachineRun {
  t: number;
  readonly layers: LayerRun[];
}

/** An event of a state, at its time. */
export interface AnimatorEvent {
  readonly t: number;
  readonly layer: string;
  readonly state: string;
  readonly name: string;
}

/** The fixed inputs of a run. */
export interface MachineContext {
  readonly value: AnimatorValue;
  readonly clips: ClipLengths;
  readonly params: ParameterSource;
}

function stepOf(ctx: MachineContext): number {
  return ctx.value.controller.stepMs ?? DEFAULT_STEP_MS;
}

function rateOf(ctx: MachineContext, layer: AnimatorLayer, state: string, params: Parameters): number {
  const definition = layer.states[state];
  return definition === undefined ? 0 : stateRate(definition, ctx.clips, params, ctx.value.speed ?? 1);
}

/** The entry events (at 0) of a state that starts at `t`. */
function entryEvents(layer: AnimatorLayer, state: string, t: number, out: AnimatorEvent[] | null): void {
  for (const event of layer.states[state]?.events ?? []) {
    if (event.at === 0) out?.push({ t, layer: layer.name, state, name: event.name });
  }
}

function startState(state: string, t: number, rate: number): StateRun {
  return { state, enter: t, base: t, phase: 0, rate, marks: [{ t, phase: 0, rate }] };
}

/** The events whose normalized time a state run passes from its last check to `t`. The run does not change. */
function stateEvents(layer: AnimatorLayer, run: StateRun, t: number, out: AnimatorEvent[]): void {
  const from = run.phase;
  const to = from + (t - run.base) * run.rate;
  const definition = layer.states[run.state];
  if (definition?.events === undefined || to <= from) return;
  const loop = definition.loop !== false;
  for (const event of definition.events) {
    // A loop passes `at` in each cycle (at 0: each cycle after the first); a once motion passes it one time.
    const first = loop ? Math.floor(from - event.at) + 1 : event.at === 0 ? Infinity : 0;
    for (let cycle = first; event.at + cycle <= to && (loop || cycle === 0); cycle += 1) {
      const at = event.at + cycle;
      if (at <= from) continue;
      const time = Math.min(t, Math.max(run.base + 1, Math.ceil(run.base + (at - from) / run.rate - EPSILON)));
      out.push({ t: time, layer: layer.name, state: run.state, name: event.name });
    }
  }
}

/** Move a state run to the check at `t`, with the events whose normalized time it passes. */
function moveState(layer: AnimatorLayer, run: StateRun, t: number, out: AnimatorEvent[] | null): void {
  if (out !== null) stateEvents(layer, run, t, out);
  run.phase += (t - run.base) * run.rate;
  run.base = t;
}

/**
 * The events from the last check of a run to `t` (between two checks). The next check gives these events again with
 * the same times, so a caller keeps only the events after the time of its last call.
 */
export function pendingEvents(ctx: MachineContext, run: MachineRun, t: number, out: AnimatorEvent[]): void {
  ctx.value.controller.layers.forEach((layer, index) => {
    const item = run.layers[index];
    if (item === undefined) return;
    stateEvents(layer, item.current, t, out);
    if (item.previous !== null) stateEvents(layer, item.previous, t, out);
  });
}

/** The order of events: by time, then by name, layer and state (no locale compare). */
export function eventOrder(a: AnimatorEvent, b: AnimatorEvent): number {
  if (a.t !== b.t) return a.t - b.t;
  const left = `${a.name}\n${a.layer}\n${a.state}`;
  const right = `${b.name}\n${b.layer}\n${b.state}`;
  return left < right ? -1 : left > right ? 1 : 0;
}

function setRate(run: StateRun, rate: number): void {
  if (rate === run.rate) return;
  run.rate = rate;
  run.marks.push({ t: run.base, phase: run.phase, rate });
  if (run.marks.length > MARK_LIMIT) run.marks.splice(0, run.marks.length - MARK_LIMIT);
}

function holds(condition: AnimatorCondition, params: Parameters): boolean {
  const value = params[condition.parameter];
  if (value === undefined) return false;
  switch (condition.op) {
    case "eq":
      return value === condition.value;
    case "ne":
      return value !== condition.value;
    case "gt":
      return value > condition.value;
    case "ge":
      return value >= condition.value;
    case "lt":
      return value < condition.value;
    case "le":
      return value <= condition.value;
  }
}

/** True when a transition applies to the state `state` (a "*" transition never goes to its own target). */
function appliesTo(transition: AnimatorTransition, state: string): boolean {
  return transition.from === ANY_STATE ? transition.to !== state : transition.from === state;
}

/** The first transition of the current state that can go now, or undefined. */
function readyTransition(layer: AnimatorLayer, run: StateRun, params: Parameters): AnimatorTransition | undefined {
  return (layer.transitions ?? []).find(
    (transition) =>
      appliesTo(transition, run.state) &&
      (transition.exitTime === undefined || run.phase >= transition.exitTime - EPSILON) &&
      (transition.when ?? []).every((condition) => holds(condition, params)),
  );
}

/** Check the transitions of one layer at the check `t`. No transition goes during a crossfade. */
function checkLayer(
  ctx: MachineContext,
  layer: AnimatorLayer,
  run: LayerRun,
  params: Parameters,
  out: AnimatorEvent[] | null,
): void {
  setRate(run.current, rateOf(ctx, layer, run.current.state, params));
  if (run.previous !== null) {
    setRate(run.previous, rateOf(ctx, layer, run.previous.state, params));
    return;
  }
  const transition = readyTransition(layer, run.current, params);
  if (transition === undefined) return;
  const t = run.current.base;
  const fadeMs = transition.duration ?? DEFAULT_FADE_MS;
  run.previous = fadeMs > 0 ? run.current : null;
  run.current = startState(transition.to, t, rateOf(ctx, layer, transition.to, params));
  run.fadeStart = t;
  run.fadeMs = fadeMs;
  entryEvents(layer, transition.to, t, out);
}

/** The run at time 0: each layer in its start state, then the check at 0. */
export function initialRun(ctx: MachineContext, out: AnimatorEvent[] | null): MachineRun {
  const params = ctx.params.at(0);
  const layers = ctx.value.controller.layers.map((layer) => {
    entryEvents(layer, layer.start, 0, out);
    return {
      current: startState(layer.start, 0, rateOf(ctx, layer, layer.start, params)),
      previous: null,
      fadeStart: 0,
      fadeMs: 0,
    };
  });
  const run: MachineRun = { t: 0, layers };
  ctx.value.controller.layers.forEach((layer, index) => {
    const item = layers[index];
    if (item !== undefined) checkLayer(ctx, layer, item, params, out);
  });
  return run;
}

/** The time of the next check after `run.t`, or null when it is after `to`. */
function nextCheck(ctx: MachineContext, run: MachineRun, to: number): number | null {
  const step = stepOf(ctx);
  let next = (Math.floor(run.t / step) + 1) * step;
  const change = ctx.params.changes(run.t, Math.min(next, to))[0];
  if (change !== undefined) next = Math.min(next, change);
  ctx.value.controller.layers.forEach((layer, index) => {
    const item = run.layers[index];
    if (item === undefined) return;
    if (item.previous !== null) {
      next = Math.min(next, Math.max(run.t + 1, item.fadeStart + item.fadeMs));
      return;
    }
    const current = item.current;
    if (current.rate <= 0) return;
    for (const transition of layer.transitions ?? []) {
      if (transition.exitTime === undefined || !appliesTo(transition, current.state)) continue;
      const at = Math.ceil(current.base + (transition.exitTime - current.phase) / current.rate - EPSILON);
      if (at > run.t) next = Math.min(next, at);
    }
  });
  return next <= to ? next : null;
}

/** Make the check at `t`: move each state, end the crossfades, then check the transitions. */
function check(ctx: MachineContext, run: MachineRun, t: number, out: AnimatorEvent[] | null): void {
  const params = ctx.params.at(t);
  ctx.value.controller.layers.forEach((layer, index) => {
    const item = run.layers[index];
    if (item === undefined) return;
    moveState(layer, item.current, t, out);
    if (item.previous !== null) {
      moveState(layer, item.previous, t, out);
      if (t >= item.fadeStart + item.fadeMs) item.previous = null;
    }
    checkLayer(ctx, layer, item, params, out);
  });
  run.t = t;
}

/** Make each check in (run.t, to]. `out` gets the events of the states. */
export function advance(ctx: MachineContext, run: MachineRun, to: number, out: AnimatorEvent[] | null): void {
  for (let next = nextCheck(ctx, run, to); next !== null; next = nextCheck(ctx, run, to)) check(ctx, run, next, out);
}

function cloneState(run: StateRun): StateRun {
  return { ...run, marks: [...run.marks] };
}

/** A copy of a run that shares no mutable part with it. */
export function cloneRun(run: MachineRun): MachineRun {
  return {
    t: run.t,
    layers: run.layers.map((item) => ({
      ...item,
      current: cloneState(item.current),
      previous: item.previous === null ? null : cloneState(item.previous),
    })),
  };
}

/** The normalized time of a state run at `t` (at or after its last check). */
export function phaseAt(run: StateRun, t: number): number {
  return run.phase + (t - run.base) * run.rate;
}

/**
 * The time where a state run had the normalized time `phase`, from its rate changes. Null when the time is before
 * the oldest rate change that the run keeps, or when the state did not move.
 */
export function timeAtPhase(run: StateRun, phase: number): number | null {
  for (let index = run.marks.length - 1; index >= 0; index -= 1) {
    const mark = run.marks[index];
    if (mark === undefined || mark.phase > phase) continue;
    if (mark.rate <= 0) return phase === mark.phase ? mark.t : null;
    return mark.t + (phase - mark.phase) / mark.rate;
  }
  return null;
}
