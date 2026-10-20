// SPDX-License-Identifier: Apache-2.0
/**
 * The simulation plugins and their replay with a checkpoint memo. A simulation plugin gives the meaning of the
 * `action` keys whose action name starts with its ID and a dot (`doors.open`).
 *
 * The state at a time `t` starts as the initial state. For each action key at or before `t` in the stable order, the
 * replay calls `settle` to the key time and `reduce` with the key. At the end, it calls `settle` to `t`.
 *
 * The memo keeps the state after the keys at or before each multiple of the checkpoint step. Thus a seek replays at
 * most one step of keys. A start point holds the states before the final `settle`, so each start point gives the same
 * calls. The memo is a cache, and its loss changes no state. `defineSimulation` (define.ts) makes a plugin of this
 * type with a state schema and `project`.
 */
import type { JsonValue } from "../json";
import type { SequenceDocument } from "../schema/sequence";
import { lastKeyAt } from "./sample";

/** One action key of a sequence, as a simulation plugin gets it. */
export interface SimulationAction {
  readonly t: number;
  /** The index of the track in the sequence, and the index of the key in the track. */
  readonly track: number;
  readonly key: number;
  readonly entity: string | undefined;
  /** The full action name, for example `doors.open`. */
  readonly action: string;
  readonly args: Readonly<Record<string, JsonValue>> | undefined;
}

/**
 * A simulation plugin. Each function is pure: it must not change its input state, and it must not read wall time or
 * `Math.random`. `settle(state, t)` moves the state with no key to the time `t`. The evaluator calls it before each
 * key and at the frame time.
 */
export interface SimulationPlugin<S = unknown> {
  readonly id: string;
  /** The state at t = 0 from the `initial` value of the sequence for this plugin (undefined when it has none). */
  initial(params: JsonValue | undefined): S;
  reduce(state: S, key: SimulationAction, t: number): S;
  settle(state: S, t: number): S;
  /** The plugin input of the runtime at `t`. */
  project?(state: S, t: number): unknown;
}

/** The plugin ID of an action name: the part before the first dot. */
export function actionPlugin(action: string): string {
  const dot = action.indexOf(".");
  return dot < 0 ? action : action.slice(0, dot);
}

/** A start point of a replay: the states after the first `next` ordered keys, before the final `settle`. */
interface StartPoint {
  readonly next: number;
  readonly states: readonly unknown[];
}

/** The action keys of a sequence that a plugin handles, in the stable order, and the keys with no plugin. */
export function orderedActions(
  sequence: SequenceDocument,
  plugins: readonly SimulationPlugin[],
): { actions: { action: SimulationAction; plugin: number }[]; unhandled: SimulationAction[] } {
  const index = new Map(plugins.map((plugin, position) => [plugin.id, position]));
  const actions: { action: SimulationAction; plugin: number }[] = [];
  const unhandled: SimulationAction[] = [];
  sequence.tracks.forEach((track, trackIndex) => {
    if (track.kind !== "action") return;
    track.keys.forEach((key, keyIndex) => {
      const action = { t: key.t, track: trackIndex, key: keyIndex, entity: track.entity, action: key.action };
      const item: SimulationAction = { ...action, args: key.args };
      const plugin = index.get(actionPlugin(key.action));
      if (plugin === undefined) unhandled.push(item);
      else actions.push({ action: item, plugin });
    });
  });
  // The sort is stable: keys at the same time keep the order of the file (track order, then key order).
  actions.sort((a, b) => a.action.t - b.action.t);
  return { actions, unhandled };
}

/** The replay of the simulation plugins of one sequence, with the checkpoint memo and the play cursor. */
export class SimulationReplay {
  private readonly ordered: readonly { action: SimulationAction; plugin: number }[];
  /** The ordered keys alone, for the binary search by time. */
  private readonly keys: readonly SimulationAction[];
  private readonly checkpoints: StartPoint[] = [];
  /** The start point of the last call. The playback continues from it with no replay. */
  private cursor: StartPoint | undefined;
  readonly unhandled: readonly SimulationAction[];

  constructor(
    private readonly sequence: SequenceDocument,
    private readonly plugins: readonly SimulationPlugin[],
    private readonly step: number,
  ) {
    const { actions, unhandled } = orderedActions(sequence, plugins);
    this.ordered = actions;
    this.keys = actions.map((item) => item.action);
    this.unhandled = unhandled;
  }

  /** The number of ordered keys at or before `t`. */
  private countAt(t: number): number {
    return lastKeyAt(this.keys, t) + 1;
  }

  /** Apply the ordered keys from `start.next` up to (not with) `end`. */
  private advance(start: StartPoint, end: number): StartPoint {
    if (start.next >= end) return start;
    const states = [...start.states];
    for (let next = start.next; next < end; next += 1) {
      const item = this.ordered[next];
      const plugin = item === undefined ? undefined : this.plugins[item.plugin];
      if (item === undefined || plugin === undefined) continue;
      const settled = plugin.settle(states[item.plugin], item.action.t);
      states[item.plugin] = plugin.reduce(settled, item.action, item.action.t);
    }
    return { next: end, states };
  }

  /** Checkpoint `index`: the states after the keys at or before `index × step`. The memo makes the missing ones. */
  private checkpoint(index: number): StartPoint {
    const { checkpoints } = this;
    let point = checkpoints[Math.min(index, checkpoints.length - 1)];
    if (point === undefined) {
      const initial = this.sequence.initial ?? {};
      const states = this.plugins.map((plugin) => plugin.initial(initial[plugin.id]));
      point = this.advance({ next: 0, states }, this.countAt(0));
      checkpoints.push(point);
    }
    while (checkpoints.length <= index) {
      point = this.advance(point, this.countAt(checkpoints.length * this.step));
      checkpoints.push(point);
    }
    return point;
  }

  /** The states of the plugins at `t`, in the order of the plugins. */
  statesAt(t: number): unknown[] {
    const end = this.countAt(t);
    // After the last key no key applies: the last checkpoint that a seek needs is one step after it.
    const last = this.ordered[this.ordered.length - 1]?.action.t ?? 0;
    let start = this.checkpoint(Math.floor(Math.min(t, last + this.step) / this.step));
    const cursor = this.cursor;
    if (cursor !== undefined && cursor.next <= end && cursor.next > start.next) start = cursor;
    const point = this.advance(start, end);
    this.cursor = point;
    return this.plugins.map((plugin, index) => plugin.settle(point.states[index], t));
  }

  /** Clear the memo and the cursor. The next call replays from the start. The states stay the same. */
  clear(): void {
    this.checkpoints.length = 0;
    this.cursor = undefined;
  }
}
