// SPDX-License-Identifier: Apache-2.0
/**
 * The parameters of an animator over time. A parameter source gives the values at a time and the times where
 * a value can change. The state machines check their transitions at these times, so a seek and a play see the same
 * changes. The source of a sequence reads the property tracks on `animator/parameters/<name>` of one entity.
 */
import type { AnimatorValue } from "@scenity/scene/components";
import { sampleTrack, type PropertyTrack, type SequenceDocument } from "@scenity/scene/sequence";

export type ParameterValue = number | boolean;
export type Parameters = Readonly<Record<string, ParameterValue>>;

export interface ParameterSource {
  /** The value of each parameter at `t` (ms). */
  at(t: number): Parameters;
  /** The times in (from, to] where a value can change, in increasing order. */
  changes(from: number, to: number): readonly number[];
}

/** The path prefix of a property track that keys an animator parameter. */
export const PARAMETER_PATH = "animator/parameters/";

/** The values of the parameters with no key: the defaults of the controller, then the values of the component. */
export function defaultParameters(
  value: Pick<AnimatorValue, "controller" | "parameters">,
): Record<string, ParameterValue> {
  const out: Record<string, ParameterValue> = {};
  for (const [name, parameter] of Object.entries(value.controller.parameters ?? {})) out[name] = parameter.default;
  for (const [name, item] of Object.entries(value.parameters ?? {})) {
    if (Object.hasOwn(out, name)) out[name] = item;
  }
  return out;
}

/** A source with values that do not change. */
export function constantParameters(values: Parameters): ParameterSource {
  const frozen = Object.freeze({ ...values });
  return { at: () => frozen, changes: () => [] };
}

/** The key times in (from, to] of a list of key time lists, in increasing order and with no repeat. */
function keyTimes(lists: readonly (readonly number[])[], from: number, to: number): number[] {
  const out = new Set<number>();
  for (const list of lists) {
    for (const t of list) if (t > from && t <= to) out.add(t);
  }
  // determinism: ordered (the sort gives the order)
  return [...out].sort((a, b) => a - b);
}

/**
 * The parameter source of one entity of a sequence: the defaults, then the property tracks on
 * `animator/parameters/<name>` in file order. A key value of the wrong type keeps the value before it.
 */
export function sequenceParameters(
  sequence: SequenceDocument | null,
  entity: string,
  defaults: Parameters,
): ParameterSource {
  const tracks: { name: string; track: PropertyTrack }[] = [];
  for (const track of sequence?.tracks ?? []) {
    if (track.kind !== "property" || track.entity !== entity || !track.path.startsWith(PARAMETER_PATH)) continue;
    const name = track.path.slice(PARAMETER_PATH.length);
    if (Object.hasOwn(defaults, name)) tracks.push({ name, track });
  }
  if (tracks.length === 0) return constantParameters(defaults);
  const times = tracks.map(({ track }) => track.keys.map((key) => key.t));
  return {
    at(t) {
      const out: Record<string, ParameterValue> = { ...defaults };
      for (const { name, track } of tracks) {
        const sample = sampleTrack(track, t);
        const value = sample.kind === "property" ? sample.value : undefined;
        if (typeof value === typeof defaults[name] && (typeof value === "number" || typeof value === "boolean"))
          out[name] = value;
      }
      return out;
    },
    changes: (from, to) => keyTimes(times, from, to),
  };
}
