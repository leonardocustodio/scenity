// SPDX-License-Identifier: Apache-2.0
/**
 * The evaluator of a sequence: the frame state at a time `t` in ms. The evaluator is pure:
 * the same documents, layers, plugins and `t` give the same frame. The scene of the frame is the base scene, then the
 * layers under the sequence (variants), then the sequence values at `t` as one more layer, then the layers over the
 * sequence (URL values, then proposals). The simulation states come from the replay with the checkpoint memo, or
 * from an external source (a recorded stream or a live engine) in place of a simulation plugin.
 */
import type { ComponentRegistry } from "../components/registry";
import type { JsonValue } from "../json";
import { applyLayers, overridesOf, type LayerReportEntry } from "../layers";
import type { OverridesDocument, SceneDocument } from "../schema/documents";
import type { SequenceDocument } from "../schema/sequence";
import { sequenceOps } from "./layer";
import { lastKeyAt, sampleTrack, type ActiveClip, type TrackSample } from "./sample";
import { actionPlugin, SimulationReplay, type SimulationPlugin } from "./simulation";
import type { SimulationSource } from "./source";

/** The default time between two checkpoints of the simulation memo, in ms. */
export const DEFAULT_CHECKPOINT_MS = 1000;

export interface EvaluatorOptions {
  readonly scene: SceneDocument;
  readonly sequence: SequenceDocument;
  /** The layers under the sequence values (the variants), in order. */
  readonly layers?: readonly OverridesDocument[];
  /** The layers over the sequence values (the URL values, then the proposals), in order. */
  readonly topLayers?: readonly OverridesDocument[];
  readonly simulations?: readonly SimulationPlugin[];
  /** The external sources: each gives the state and the input of one plugin ID at each time. */
  readonly sources?: readonly SimulationSource[];
  readonly registry: ComponentRegistry;
  /** The time between two checkpoints of the simulation memo, in ms (default 1000). */
  readonly checkpointMs?: number;
}

/** An event key or an action key in the time range of a play step. */
export interface FiredKey {
  readonly kind: "event" | "action";
  readonly t: number;
  readonly track: number;
  readonly key: number;
  readonly entity: string | undefined;
  /** The event name, or the action name. */
  readonly name: string;
  readonly args: Readonly<Record<string, JsonValue>> | undefined;
}

/** The state of a frame. Treat each part as read only: the evaluator can share parts between frames. */
export interface FrameState {
  /** The time of the frame: `t` clamped to 0..duration. */
  readonly t: number;
  /** The evaluated scene: the base scene and all the layers. */
  readonly scene: SceneDocument;
  /** The ops that did not apply. The layer index counts the layers under, then the sequence layer, then the top. */
  readonly report: readonly LayerReportEntry[];
  /** The sample of each track, in the order of the tracks. */
  readonly tracks: readonly TrackSample[];
  /** The active camera (`entity:<id>`): the last camera track in file order with a key at or before `t`. */
  readonly camera: string | undefined;
  /** The attach parent of each entity of an attach track that has a key at or before `t` (null: no parent). */
  readonly attach: Readonly<Record<string, string | null>>;
  /** The active clips of each entity of an animation track. */
  readonly animations: Readonly<Record<string, readonly ActiveClip[]>>;
  /** The event and action keys in (since, t] in the stable order. Empty when the call gives no `since`. */
  readonly fired: readonly FiredKey[];
  /** The state of each simulation plugin, by plugin ID. */
  readonly simulations: Readonly<Record<string, unknown>>;
  /** The `project` output of each plugin that has the function, by plugin ID. */
  readonly projections: Readonly<Record<string, unknown>>;
}

export interface Evaluator {
  readonly sequence: SequenceDocument;
  /** The notes of the setup: a track of an entity that the scene does not hold, an action with no plugin. */
  readonly warnings: readonly string[];
  /** The frame at `t` (an integer count of ms). With `since`, `fired` holds the keys in (since, t] of a play step. */
  at(t: number, since?: number): FrameState;
  /** The sample of each track at `t`, with no scene and no simulation (for the lanes). */
  samplesAt(t: number): TrackSample[];
  /** The event and action keys in (since, t]. When the sequence loops and `since > t`, the range wraps at the end. */
  firedBetween(since: number, t: number): FiredKey[];
  /** The simulation states at `t`, by plugin ID. */
  simulationsAt(t: number): Record<string, unknown>;
  /** Clear the checkpoint memo. The next frames are the same. Only the time to make them changes. */
  clearMemo(): void;
}

/** A time of the time line: an integer, clamped to 0..duration. A time that is not an integer is an error. */
function clampTime(t: number, duration: number): number {
  if (!Number.isInteger(t)) throw new RangeError(`a sequence time is an integer count of ms, not ${String(t)}`);
  return Math.min(Math.max(t, 0), duration);
}

/** The event and action keys of a sequence in the stable order. */
function firedKeys(sequence: SequenceDocument): FiredKey[] {
  const out: FiredKey[] = [];
  sequence.tracks.forEach((track, trackIndex) => {
    if (track.kind !== "event" && track.kind !== "action") return;
    track.keys.forEach((key, keyIndex) => {
      const name = "name" in key ? key.name : key.action;
      const base = { kind: track.kind, t: key.t, track: trackIndex, key: keyIndex, entity: track.entity };
      out.push({ ...base, name, args: key.args });
    });
  });
  // The sort is stable: keys at the same time keep the order of the file.
  return out.sort((a, b) => a.t - b.t);
}

function setupWarnings(
  scene: SceneDocument,
  sequence: SequenceDocument,
  replay: SimulationReplay,
  plugins: readonly SimulationPlugin[],
): string[] {
  const warnings: string[] = [];
  if (sequence.scene !== scene.id) {
    warnings.push(`the sequence "${sequence.id}" is for the scene "${sequence.scene}", not "${scene.id}"`);
  }
  sequence.tracks.forEach((track, index) => {
    if ("entity" in track && track.entity !== undefined && !Object.hasOwn(scene.entities, track.entity)) {
      warnings.push(`track ${String(index)}: the scene has no entity "${track.entity}"`);
    }
  });
  const missing = [...new Set(replay.unhandled.map((item) => actionPlugin(item.action)))].sort();
  for (const id of missing) warnings.push(`no simulation plugin "${id}" for the action keys "${id}.*"`);
  for (const id of Object.keys(sequence.initial ?? {}).sort()) {
    if (!plugins.some((plugin) => plugin.id === id))
      warnings.push(`no simulation plugin "${id}" for the initial value`);
  }
  return warnings;
}

/** The camera, the attach parents and the active clips from the track samples. */
function frameParts(samples: readonly TrackSample[]) {
  let camera: string | undefined;
  const attach: Record<string, string | null> = {};
  const animations: Record<string, ActiveClip[]> = {};
  for (const sample of samples) {
    if (sample.kind === "camera" && sample.camera !== undefined) camera = sample.camera;
    else if (sample.kind === "attach" && sample.to !== undefined) attach[sample.entity] = sample.to;
    else if (sample.kind === "animation")
      animations[sample.entity] = [...(animations[sample.entity] ?? []), ...sample.clips];
  }
  return { camera, attach, animations };
}

/** Make an evaluator. The base layers apply once here. Each frame applies the sequence layer and the top layers. */
export function createEvaluator(options: EvaluatorOptions): Evaluator {
  const { scene, sequence, registry } = options;
  const plugins = options.simulations ?? [];
  const step = options.checkpointMs ?? DEFAULT_CHECKPOINT_MS;
  if (!Number.isInteger(step) || step <= 0) throw new RangeError("checkpointMs is a positive integer");
  const sources = options.sources ?? [];
  const ids = [...plugins, ...sources].map((plugin) => plugin.id);
  const twice = ids.find((id, index) => ids.indexOf(id) !== index);
  if (twice !== undefined) throw new Error(`two simulation plugins have the ID "${twice}"`);
  const under = options.layers ?? [];
  const top = options.topLayers ?? [];
  const base = applyLayers(scene, under, registry);
  const replay = new SimulationReplay(sequence, plugins, step);
  const fired = firedKeys(sequence);
  const warnings = setupWarnings(scene, sequence, replay, plugins);
  const layerName = `sequence:${sequence.id}`;

  const samplesAt = (t: number) => sequence.tracks.map((track) => sampleTrack(track, t));
  const firedBetween = (since: number, t: number): FiredKey[] => {
    const from = lastKeyAt(fired, since) + 1;
    const to = lastKeyAt(fired, t) + 1;
    if (since <= t) return fired.slice(from, to);
    return sequence.loop === true ? [...fired.slice(from), ...fired.slice(0, to)] : [];
  };
  const simulationsAt = (t: number): Record<string, unknown> => {
    const states = replay.statesAt(t);
    const out: Record<string, unknown> = Object.fromEntries(plugins.map((plugin, index) => [plugin.id, states[index]]));
    for (const source of sources) out[source.id] = source.stateAt(t);
    return out;
  };

  const at = (time: number, since?: number): FrameState => {
    const t = clampTime(time, sequence.duration);
    const tracks = samplesAt(t);
    const layer = overridesOf(sequence.scene, sequenceOps(base.doc, tracks), layerName);
    const layered = applyLayers(base.doc, [layer, ...top], registry);
    const shift = under.length;
    const report = [...base.report, ...layered.report.map((entry) => ({ ...entry, layer: entry.layer + shift }))];
    const simulations = simulationsAt(t);
    const projections: Record<string, unknown> = {};
    for (const plugin of plugins) {
      if (plugin.project !== undefined) projections[plugin.id] = plugin.project(simulations[plugin.id], t);
    }
    for (const source of sources) projections[source.id] = source.inputAt(t);
    const firedKeysOfStep = since === undefined ? [] : firedBetween(Math.trunc(since), t);
    return {
      t,
      scene: layered.doc,
      report,
      tracks,
      ...frameParts(tracks),
      fired: firedKeysOfStep,
      simulations,
      projections,
    };
  };

  return {
    sequence,
    warnings,
    at,
    samplesAt: (t) => samplesAt(clampTime(t, sequence.duration)),
    firedBetween: (since, t) => firedBetween(since, clampTime(t, sequence.duration)),
    simulationsAt: (t) => simulationsAt(clampTime(t, sequence.duration)),
    clearMemo: () => replay.clear(),
  };
}
