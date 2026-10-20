// SPDX-License-Identifier: Apache-2.0
/**
 * The animator: `evaluate(controller, parameters, t)` gives the pose of each layer at a
 * time in ms. The pose of a layer is a list of weighted motion samples (a clip and its clip time, or a procedural
 * motion of a plugin); the runtime mixes them on the skinned model. The animator is pure: the same component value,
 * clip lengths, parameters and `t` give the same frame. A memo keeps the runs at fixed checkpoints, so a seek makes at
 * most one checkpoint step of checks; the memo is a cache and its loss changes no frame.
 */
import type { AnimatorValue, RootMotion } from "@scenity/scene/components";
import {
  advance,
  cloneRun,
  eventOrder,
  initialRun,
  pendingEvents,
  phaseAt,
  timeAtPhase,
  type AnimatorEvent,
  type MachineContext,
  type MachineRun,
} from "./machine";
import { motionSamples, type ClipLengths, type MotionSample } from "./motion";
import { constantParameters, defaultParameters, type ParameterSource } from "./parameters";

/** The default time between two checkpoints of the memo, in ms. */
export const ANIMATOR_CHECKPOINT_MS = 1000;

/** The pose of one layer at a time. */
export interface LayerPose {
  readonly name: string;
  readonly weight: number;
  readonly blend: "override" | "additive";
  readonly mask: readonly string[] | null;
  /** The current state and its normalized time (1: one cycle). */
  readonly state: string;
  readonly phase: number;
  /** In a crossfade: the state before it, its normalized time, and the share of the current state (0..1). */
  readonly from: string | null;
  readonly fromPhase: number;
  readonly fade: number;
  /** The entry time of the current state, and the time where its crossfade ends (its entry time with no fade). */
  readonly enter: number;
  readonly fadeEnd: number;
  /** The weighted motions; the weights add to 1. */
  readonly samples: readonly MotionSample[];
}

/** The frame of an animator at a time. */
export interface AnimatorFrame {
  readonly t: number;
  readonly rootMotion: RootMotion;
  readonly layers: readonly LayerPose[];
  /** The events of the states in (since, t]; empty when the call gives no `since`. */
  readonly events: readonly AnimatorEvent[];
}

export interface AnimatorOptions {
  /** The component value with its defaults (`registry.fill`). */
  readonly value: AnimatorValue;
  /** The length of each clip of the model in seconds. A clip that the table does not hold has no motion. */
  readonly clips: ClipLengths;
  /** The parameters over time (default: the values of the component). */
  readonly parameters?: ParameterSource;
  readonly checkpointMs?: number;
}

export interface Animator {
  /** The frame at `t` (an integer count of ms, 0 or more). With `since`, the frame holds the events in (since, t]. */
  at(t: number, since?: number): AnimatorFrame;
  /**
   * The time where a state of a layer had the normalized time `phase`, from the run of the last `at` call (the
   * current state, or the state before it in a crossfade). Null when the run does not keep that time.
   */
  timeAtPhase(layer: number, which: "current" | "previous", phase: number): number | null;
  /** Drop the memo. The next frames are the same; only the time to make them changes. */
  clearMemo(): void;
}

/** A crossfade weight with a soft start and end. */
function smooth(share: number): number {
  const x = Math.min(1, Math.max(0, share));
  return x * x * (3 - 2 * x);
}

function checkTime(t: number): void {
  if (!Number.isInteger(t) || t < 0)
    throw new RangeError(`an animator time is an integer count of ms, not ${String(t)}`);
}

/** The pose of each layer of a run at `t` (at or after the last check of the run). */
export function layerPoses(ctx: MachineContext, run: MachineRun, t: number): LayerPose[] {
  const params = ctx.params.at(t);
  return ctx.value.controller.layers.map((layer, index) => {
    const item = run.layers[index];
    const current = item?.current;
    const phase = current === undefined ? 0 : phaseAt(current, t);
    const previous = item?.previous ?? null;
    const fade = previous === null || item === undefined ? 1 : smooth((t - item.fadeStart) / Math.max(1, item.fadeMs));
    const fromPhase = previous === null ? 0 : phaseAt(previous, t);
    const samples: MotionSample[] = [];
    const state = current === undefined ? undefined : layer.states[current.state];
    if (state !== undefined) samples.push(...motionSamples(state, phase, fade, ctx.clips, params));
    const before = previous === null ? undefined : layer.states[previous.state];
    if (before !== undefined && fade < 1)
      samples.push(...motionSamples(before, fromPhase, 1 - fade, ctx.clips, params));
    return {
      name: layer.name,
      weight: layer.weight ?? 1,
      blend: layer.blend ?? "override",
      mask: layer.mask ?? null,
      state: current?.state ?? layer.start,
      phase,
      from: previous?.state ?? null,
      fromPhase,
      fade,
      enter: current?.enter ?? 0,
      fadeEnd: (current?.enter ?? 0) + (item !== undefined && item.fadeStart === current?.enter ? item.fadeMs : 0),
      samples,
    };
  });
}

/** Make an animator over a component value, the clip lengths of its model and its parameters. */
export function createAnimator(options: AnimatorOptions): Animator {
  const ctx: MachineContext = {
    value: options.value,
    clips: options.clips,
    params: options.parameters ?? constantParameters(defaultParameters(options.value)),
  };
  const step = Math.max(1, Math.floor(options.checkpointMs ?? ANIMATOR_CHECKPOINT_MS));
  const startEvents: AnimatorEvent[] = [];
  const start = initialRun(ctx, startEvents);
  const memo = new Map<number, MachineRun>([[0, cloneRun(start)]]);
  // The cursor: the run after each check at or before `upTo`.
  let cursor = { run: cloneRun(start), upTo: 0 };

  /**
   * Put the cursor at `t`. Without `out`, the cursor can jump to a checkpoint of the memo. With `out`, it makes each
   * check after its time (no jump), and `out` gets the events of these checks.
   */
  function moveTo(t: number, out: AnimatorEvent[] | null): void {
    const floor = Math.floor(t / step) * step;
    if (!(cursor.upTo <= t && (out !== null || cursor.upTo >= floor))) {
      let key = floor;
      while (!memo.has(key)) key -= step;
      cursor = { run: cloneRun(memo.get(key) ?? start), upTo: key };
    }
    for (let boundary = (Math.floor(cursor.upTo / step) + 1) * step; boundary <= t; boundary += step) {
      advance(ctx, cursor.run, boundary, out);
      cursor.upTo = boundary;
      if (!memo.has(boundary)) memo.set(boundary, cloneRun(cursor.run));
    }
    advance(ctx, cursor.run, t, out);
    cursor.upTo = t;
  }

  return {
    at(t, since) {
      checkTime(t);
      let events: AnimatorEvent[] = [];
      if (since !== undefined && since < t) {
        if (since >= 0) moveTo(since, null);
        else {
          cursor = { run: cloneRun(start), upTo: 0 };
          events = startEvents.filter((event) => event.t > since);
        }
        moveTo(t, events);
        pendingEvents(ctx, cursor.run, t, events);
        events = events.filter((event) => event.t > since && event.t <= t).sort(eventOrder);
      } else moveTo(t, null);
      return { t, rootMotion: ctx.value.rootMotion ?? "in-place", layers: layerPoses(ctx, cursor.run, t), events };
    },
    timeAtPhase(layer, which, phase) {
      const item = cursor.run.layers[layer];
      const run = which === "current" ? item?.current : item?.previous;
      return run === undefined || run === null ? null : timeAtPhase(run, phase);
    },
    clearMemo() {
      memo.clear();
      memo.set(0, cloneRun(start));
    },
  };
}

/** The frame at `t` with no memo: a run of every check from 0 (the reference of the tests). */
export function evaluateAnimator(options: AnimatorOptions, t: number): AnimatorFrame {
  checkTime(t);
  const ctx: MachineContext = {
    value: options.value,
    clips: options.clips,
    params: options.parameters ?? constantParameters(defaultParameters(options.value)),
  };
  const run = initialRun(ctx, null);
  advance(ctx, run, t, null);
  return { t, rootMotion: ctx.value.rootMotion ?? "in-place", layers: layerPoses(ctx, run, t), events: [] };
}
