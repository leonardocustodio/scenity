// SPDX-License-Identifier: Apache-2.0
/**
 * The input events of the play mode in a document core. The page sends the events of the input maps of the plugins
 * ("inputs", documentMessages.ts); this module keeps them in an `InputTrack` and gives the events of each system step
 * to the systems as `ctx.inputs`.
 *
 * - The step at the time `s` gets the events in (`s` - dt, `s`], so an event applies at a step boundary, never at a
 *   wall-clock time. The memory of the systems at a time is a function of the documents, the events and the time.
 * - An event can come after the steps passed its time (the page and the worker are apart). Then the steps from its
 *   time run again (`SystemSteps.forget`), so the next frame is the frame of a replay with the same events.
 * - A simulation of a plugin gets the events as action keys (`withInputs` of `@scenity/scene/input`): the core gives
 *   the time line a sequence with one more action track.
 *
 * The module is a part of the generic document core only. A plugin core of a render worker has no input track, and
 * its systems get no `ctx.inputs`.
 */
import { InputTrack, withInputs, type InputEvent } from "@scenity/scene/input";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { PluginSystem, RuntimePlugin } from "../plugins/types";
import { systemOf } from "../plugins/systems";
import type { SystemDefinition } from "../systems/types";

/** The system with the input events of each step as `ctx.inputs`. The memory functions stay those of the system. */
function inputSystem(system: SystemDefinition, track: InputTrack): SystemDefinition {
  const wrapped: SystemDefinition = {
    id: system.id,
    order: system.order,
    reads: system.reads,
    update(ctx) {
      // The first step after a reset has dt = 0: it gets the events at or before its time.
      const from = ctx.dt === 0 ? -1 : ctx.t - ctx.dt;
      system.update({ ...ctx, inputs: track.step(from, ctx.t) });
    },
  };
  if (system.save === undefined || system.restore === undefined) return wrapped;
  return { ...wrapped, save: system.save.bind(system), restore: system.restore.bind(system) };
}

/** The plugins with the input events of the track in the context of each system. */
export function withInputSystems(plugins: readonly RuntimePlugin[], track: InputTrack): RuntimePlugin[] {
  return plugins.map((plugin) => {
    if (plugin.systems.length === 0) return plugin;
    const systems: PluginSystem[] = plugin.systems.map(
      (source) => (core?: unknown) => inputSystem(systemOf(source, core), track),
    );
    return { ...plugin, systems };
  });
}

/** The input events of a document core and the base sequence of each sequence with the events as action keys. */
export class DocumentInputs {
  readonly track = new InputTrack();
  readonly #bases = new WeakMap<SequenceDocument, SequenceDocument>();

  /** Add the events, or replace all of them. The result is the earliest time that changes, or null. */
  set(events: readonly InputEvent[], replace: boolean): number | null {
    return replace ? this.track.replace(events) : this.track.add(events);
  }

  /**
   * The sequence of a time line: with `simulations`, the base sequence with the events as one more action track,
   * else the base sequence. A sequence of an earlier call gives the same base, so the events go in one time only.
   */
  sequence(sequence: SequenceDocument, simulations: boolean): SequenceDocument {
    const base = this.#bases.get(sequence) ?? sequence;
    if (!simulations) return base;
    const merged = withInputs(base, this.track.events);
    if (merged !== base) this.#bases.set(merged, base);
    return merged;
  }
}
