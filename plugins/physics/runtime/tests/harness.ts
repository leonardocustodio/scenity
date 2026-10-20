// SPDX-License-Identifier: Apache-2.0
// The test harness of the physics plugin: the plugins in a plugin host, the evaluator of a sequence and the
// fixed steps of a document core (SystemSteps), with the input events of the play mode as `ctx.inputs` (as
// documentInputs.ts of the document core gives them). `at(t)` gives the transform outputs of the frame at `t`.
import { InputTrack, type InputEvent } from "@scenity/scene/input";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { createEvaluator, type SequenceDocument } from "@scenity/scene/sequence";
import { PluginHost, systemOf, type PluginSystem, type RuntimePlugin } from "@scenity/runtime/plugins";
import { SystemSteps } from "@scenity/runtime/systemSteps";
import type { EntityOutput, SystemDefinition } from "@scenity/runtime/systems";

/** The plugin with the input events of the track in the context of each system. */
function withInputs(plugin: RuntimePlugin, track: InputTrack): RuntimePlugin {
  const systems: PluginSystem[] = plugin.systems.map((source) => (core?: unknown) => {
    const system = systemOf(source, core);
    const wrapped: SystemDefinition = {
      ...system,
      update(ctx) {
        const from = ctx.dt === 0 ? -1 : ctx.t - ctx.dt;
        system.update({ ...ctx, inputs: track.step(from, ctx.t) });
      },
    };
    return system.save === undefined || system.restore === undefined
      ? wrapped
      : { ...wrapped, save: system.save.bind(system), restore: system.restore.bind(system) };
  });
  return { ...plugin, systems };
}

export interface Harness {
  /** The outputs of the frame at `t` (ms), as plain JSON. */
  at(t: number): Record<string, EntityOutput>;
  /** The core of the runner: the key of the ray casts of the physics system. */
  readonly core: object;
}

/** A harness over a scene and a sequence with the plugins and the input events. */
export function harness(
  plugins: readonly RuntimePlugin[],
  scene: SceneDocument,
  sequence: SequenceDocument,
  events: readonly InputEvent[] = [],
): Harness {
  const track = new InputTrack();
  track.add(events);
  const host = new PluginHost(plugins.map((plugin) => withInputs(plugin, track)));
  const evaluator = createEvaluator({ scene, sequence, simulations: host.simulations, registry: host.components });
  const core = {};
  const steps = new SystemSteps(host.createRunner({ core, documentId: scene.id }));
  return {
    core,
    at(t) {
      const out = steps.at(
        t,
        (time) => evaluator.at(time),
        (frame) => frame.projections,
      );
      return out?.snapshot() ?? {};
    },
  };
}

/** The frame times of a play at 60 frames per second from 0 to `end` (ms), as a page clock gives them. */
export function playTimes(end: number): number[] {
  const times: number[] = [];
  for (let frame = 0; ; frame += 1) {
    const t = Math.round((frame * 1000) / 60 + (frame % 3) * 3);
    if (t > end) break;
    times.push(t);
  }
  return times;
}
