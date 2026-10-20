// SPDX-License-Identifier: Apache-2.0
/**
 * The page side of the time line of a player: the evaluator of `@scenity/scene` over the scene
 * and the sequence. The core (in the worker or on the main thread) draws the scene at the clock time with its own
 * evaluator. The page uses its evaluator for two things:
 *
 * - the markers and the event keys that a play step goes past (the `marker` and `event` events of the player);
 * - the plugin input of a simulation plugin at the clock time: the replay of its action keys with the checkpoint
 *   memo, then its `project` function.
 */
import { builtinRegistry, type ComponentRegistry } from "@scenity/scene/components";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import {
  createEvaluator,
  type Evaluator,
  type FiredKey,
  type SequenceDocument,
  type SimulationPlugin,
} from "@scenity/scene/sequence";

/** A marker or an event key that a play step went past. */
export type Crossed =
  | { readonly kind: "marker"; readonly name: string; readonly t: number }
  | {
      readonly kind: "event";
      readonly name: string;
      readonly t: number;
      readonly entity: string | undefined;
      readonly args: FiredKey["args"];
    };

/** The markers in (since, t], in time order. */
function markersBetween(sequence: SequenceDocument, since: number, t: number): Crossed[] {
  return Object.entries(sequence.markers ?? {})
    .filter(([, at]) => at > since && at <= t)
    .sort((a, b) => a[1] - b[1] || a[0].localeCompare(b[0]))
    .map(([name, at]) => ({ kind: "marker" as const, name, t: at }));
}

/** The part of the time line that the player uses (a dep, so the light player has no evaluator). */
export interface TimelineLike {
  readonly warnings: readonly string[];
  crossed(since: number, t: number): Crossed[];
  input(t: number): unknown;
}

export class PlayerTimeline implements TimelineLike {
  readonly #sequence: SequenceDocument;
  readonly #evaluator: Evaluator;
  readonly #simulation: SimulationPlugin | null;

  constructor(
    scene: SceneDocument,
    sequence: SequenceDocument,
    registry: ComponentRegistry,
    simulation: SimulationPlugin | null,
  ) {
    this.#sequence = sequence;
    this.#simulation = simulation;
    const simulations = simulation === null ? [] : [simulation];
    this.#evaluator = createEvaluator({ scene, sequence, registry, simulations });
  }

  /** The notes of the evaluator start: a track of an entity that the scene does not hold, an action with no plugin. */
  get warnings(): readonly string[] {
    return this.#evaluator.warnings;
  }

  /**
   * The markers and the event keys in (since, t], in time order. When the time line loops and `since > t`, the range
   * wraps at the end.
   */
  crossed(since: number, t: number): Crossed[] {
    if (since === t) return [];
    const wraps = since > t;
    const markers = wraps
      ? [...markersBetween(this.#sequence, since, this.#sequence.duration), ...markersBetween(this.#sequence, -1, t)]
      : markersBetween(this.#sequence, since, t);
    const events = this.#evaluator
      .firedBetween(since, t)
      .filter((key) => key.kind === "event")
      .map((key) => ({ kind: "event" as const, name: key.name, t: key.t, entity: key.entity, args: key.args }));
    const order = (item: Crossed): number => (wraps && item.t <= t ? item.t + this.#sequence.duration + 1 : item.t);
    // The sort is stable: at the same time, the markers come before the event keys.
    return [...markers, ...events].sort((a, b) => order(a) - order(b));
  }

  /** The plugin input of the simulation plugin at `t`, or undefined with no simulation or no `project` function. */
  input(t: number): unknown {
    const simulation = this.#simulation;
    if (simulation?.project === undefined) return undefined;
    const state = this.#evaluator.simulationsAt(t)[simulation.id];
    return simulation.project(state, t);
  }
}

/** The time line of a sequence with the built-in components (the `timeline` dep of the full player). */
export function pageTimeline(
  scene: SceneDocument,
  sequence: SequenceDocument,
  simulation: SimulationPlugin | null,
): PlayerTimeline {
  return new PlayerTimeline(scene, sequence, builtinRegistry(), simulation);
}
