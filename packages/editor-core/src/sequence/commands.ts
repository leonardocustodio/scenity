// SPDX-License-Identifier: Apache-2.0
/**
 * The commands of the sequencer. Each action of the sequencer panel is one of these commands, and each command is one
 * edit of the sequence channel: one step of the one history.
 *
 * - `sequence.track.add`, `sequence.track.remove`: a track of an entity (or of the sequence) and its keys;
 * - `sequence.key.add`: a key at a time (default: the time of the clock) with the value of the frame at that time, or
 *   a given value (JSON); `sequence.key.move`, `sequence.key.value`, `sequence.key.delete`;
 * - `sequence.marker.add`, `sequence.marker.move`, `sequence.marker.remove`;
 * - `sequence.settings`: the duration, the loop flag and the initial state of the simulations;
 * - `sequence.rules`: the rules of the sequence.
 *
 * A track is its index in the track list, and a key is its index in the track. No Vue import.
 */
import type { EntityDocument } from "@scenity/scene";
import { EASE_NAMES, TRACK_KINDS, type SequenceDocument, type Track } from "@scenity/scene/sequence";
import { CommandError, defineCommands, NO_RULE, numberArg, textArg, type Args, type CommandHost } from "../command";
import type { RuleState } from "../registry";
import { sequenceOp, type SequenceChange, type SequenceOp, type TrackKey } from "./edits";
import { findTrack, propertyAt, trackLabel, transformAt } from "./tracks";

/** What the sequence commands read. */
export interface SequenceCommandState extends RuleState {
  readonly scene: EntityDocument;
  readonly sequence: SequenceDocument;
  /** The time of the clock (ms). */
  readonly time: number;
}

const TRACK_ARG = { type: "number", description: "The index of the track.", integer: true, min: 0 } as const;
const KEY_ARG = { type: "number", description: "The index of the key in the track.", integer: true, min: 0 } as const;
const TIME_ARG = {
  type: "number",
  description: "The time in ms (default: the time of the clock).",
  optional: true,
  integer: true,
  min: 0,
} as const;
const VALUE_ARG = {
  type: "string",
  description:
    "The value as JSON: a property value, the transform parts { position, rotation, scale }, or the fields of another key.",
  optional: true,
} as const;
const MARKER_ARG = { type: "string", description: "The name of the marker." } as const;

function edit(title: string, change: SequenceChange) {
  return { kind: "edit" as const, title, ops: [sequenceOp(change)] };
}

function trackOf(state: SequenceCommandState, args: Args): { index: number; track: Track } {
  const index = numberArg(args, "track") ?? -1;
  const track = state.sequence.tracks[index];
  if (track === undefined) throw new CommandError(`The sequence has no track ${String(index)}.`);
  return { index, track };
}

function keyOf(track: Track, args: Args): number {
  const index = numberArg(args, "key") ?? -1;
  if (track.keys[index] === undefined) throw new CommandError(`The track has no key ${String(index)}.`);
  return index;
}

function timeOf(state: SequenceCommandState, args: Args): number {
  const t = numberArg(args, "t") ?? Math.round(state.time);
  if (t > state.sequence.duration) {
    throw new CommandError(`The time ${String(t)} ms is after the end (${String(state.sequence.duration)} ms).`);
  }
  return t;
}

function parsed(args: Args): unknown {
  const text = textArg(args, "value");
  if (text === "") return undefined;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new CommandError(`The value is not JSON: ${text}`);
  }
}

/** The fields of a key at `t` of a track: the value of the argument, else the value of the frame at `t`. */
function keyFields(state: SequenceCommandState, track: Track, t: number, value: unknown): Record<string, unknown> {
  const entity = "entity" in track ? (track.entity ?? "") : "";
  if (track.kind === "property") {
    const now = value !== undefined ? value : propertyAt(state.scene, state.sequence, entity, track.path, t);
    if (now === undefined) throw new CommandError(`No value of ${track.path}: give a value.`);
    return { value: now };
  }
  if (value !== undefined && (typeof value !== "object" || value === null || Array.isArray(value))) {
    throw new CommandError("The value of this key is a JSON object of its fields.");
  }
  if (value !== undefined) return value as Record<string, unknown>;
  if (track.kind === "transform") return transformAt(state.scene, state.sequence, entity, t);
  if (track.kind === "visibility") return { visible: true };
  if (track.kind === "audio") return { play: true };
  throw new CommandError(`A key of a ${track.kind} track needs a value.`);
}

/** The new track of the arguments of `sequence.track.add`. */
function newTrack(state: SequenceCommandState, args: Args): Track {
  const kind = textArg(args, "kind");
  const entity = textArg(args, "entity");
  const path = textArg(args, "path");
  const needs = !["event", "action", "camera"].includes(kind);
  if (needs && entity === "") throw new CommandError(`A ${kind} track needs an entity.`);
  if (entity !== "" && !Object.hasOwn(state.scene.entities, entity)) {
    throw new CommandError(`No entity "${entity}" in the scene.`);
  }
  if (kind === "property" && path === "") throw new CommandError("A property track needs a path (camera/fov).");
  if (findTrack(state.sequence, { kind: kind as Track["kind"], entity: entity || undefined, path }) >= 0) {
    throw new CommandError("The sequence has this track already.");
  }
  return {
    kind,
    ...(entity === "" || kind === "camera" ? {} : { entity }),
    ...(kind === "property" ? { path } : {}),
    keys: keysOf(args),
  } as unknown as Track;
}

/** The keys of the `keys` argument of a new track (none: an empty track). The schema checks them. */
function keysOf(args: Args): unknown[] {
  const text = textArg(args, "keys");
  if (text === "") return [];
  let value: unknown;
  try {
    value = JSON.parse(text) as unknown;
  } catch {
    throw new CommandError(`The keys are not JSON: ${text}`);
  }
  if (!Array.isArray(value)) throw new CommandError("The keys are a JSON list of keys.");
  const keys: unknown[] = value;
  return [...keys].sort((a, b) => Number((a as { t?: unknown }).t) - Number((b as { t?: unknown }).t));
}

/** The commands of the sequencer. */
export const SEQUENCE_COMMANDS = defineCommands<SequenceCommandState, CommandHost, SequenceOp>([
  {
    id: "sequence.track.add",
    undo: "sequence",
    menu: "sequence",
    title: "Add a track",
    key: null,
    kind: "edit",
    args: {
      kind: { type: "string", description: "The kind of the track.", values: TRACK_KINDS },
      entity: { type: "string", description: "The entity of the track.", optional: true },
      path: { type: "string", description: "The path of a property track (camera/fov).", optional: true },
      keys: {
        type: "string",
        description: "The keys of the new track as a JSON list, for example a camera move in one step.",
        optional: true,
      },
    },
    selection: NO_RULE,
    build: (args, state) => {
      const track = newTrack(state, args);
      return edit(`Add the ${trackLabel(track)} track`, { type: "addTrack", track });
    },
  },
  {
    id: "sequence.track.remove",
    undo: "sequence",
    title: "Remove a track",
    key: null,
    kind: "edit",
    args: { track: TRACK_ARG },
    selection: NO_RULE,
    build: (args, state) => {
      const { index, track } = trackOf(state, args);
      return edit(`Remove the ${trackLabel(track)} track`, { type: "removeTrack", track: index });
    },
  },
  {
    id: "sequence.key.add",
    undo: "sequence",
    menu: "sequence",
    title: "Add a key",
    key: null,
    kind: "edit",
    args: { track: TRACK_ARG, t: TIME_ARG, value: VALUE_ARG },
    selection: NO_RULE,
    build: (args, state) => {
      const { index, track } = trackOf(state, args);
      const t = timeOf(state, args);
      const key = { ...keyFields(state, track, t, parsed(args)), t } as unknown as TrackKey;
      return edit(`Add a ${trackLabel(track)} key at ${String(t)} ms`, { type: "putKey", track: index, key });
    },
  },
  {
    id: "sequence.key.move",
    undo: "sequence",
    title: "Move a key",
    key: null,
    kind: "edit",
    args: { track: TRACK_ARG, key: KEY_ARG, t: { ...TIME_ARG, optional: false, description: "The new time in ms." } },
    selection: NO_RULE,
    build: (args, state) => {
      const { index, track } = trackOf(state, args);
      const key = keyOf(track, args);
      const t = timeOf(state, args);
      return edit(`Move a ${trackLabel(track)} key to ${String(t)} ms`, { type: "moveKey", track: index, key, t });
    },
  },
  {
    id: "sequence.key.value",
    undo: "sequence",
    title: "Change the value of a key",
    key: null,
    kind: "edit",
    args: {
      track: TRACK_ARG,
      key: KEY_ARG,
      value: VALUE_ARG,
      ease: {
        type: "string",
        description: 'The ease from the key before: a name, or { "bezier": [x1, y1, x2, y2] } as JSON.',
        optional: true,
      },
    },
    selection: NO_RULE,
    build: (args, state) => {
      const { index, track } = trackOf(state, args);
      const key = keyOf(track, args);
      const now = track.keys[key] as Record<string, unknown>;
      const fields = parsed(args) === undefined ? {} : keyFields(state, track, Number(now.t), parsed(args));
      const value = { ...now, ...fields, ...easeOf(textArg(args, "ease")) } as unknown as TrackKey;
      return edit(`Change a ${trackLabel(track)} key`, { type: "setKey", track: index, key, value });
    },
  },
  {
    id: "sequence.key.delete",
    undo: "sequence",
    title: "Delete a key",
    key: null,
    kind: "edit",
    args: { track: TRACK_ARG, key: KEY_ARG },
    selection: NO_RULE,
    build: (args, state) => {
      const { index, track } = trackOf(state, args);
      const key = keyOf(track, args);
      return edit(`Delete a ${trackLabel(track)} key`, { type: "deleteKey", track: index, key });
    },
  },
  {
    id: "sequence.marker.add",
    undo: "sequence",
    menu: "sequence",
    title: "Add a marker",
    key: null,
    kind: "edit",
    args: { name: MARKER_ARG, t: TIME_ARG },
    selection: NO_RULE,
    build: (args, state) => {
      const name = textArg(args, "name").trim();
      if (state.sequence.markers?.[name] !== undefined) throw new CommandError(`The marker "${name}" exists.`);
      const t = timeOf(state, args);
      return edit(`Add the marker ${name} at ${String(t)} ms`, { type: "marker", name, t });
    },
  },
  {
    id: "sequence.marker.move",
    undo: "sequence",
    title: "Move a marker",
    key: null,
    kind: "edit",
    args: { name: MARKER_ARG, t: { ...TIME_ARG, optional: false, description: "The new time in ms." } },
    selection: NO_RULE,
    build: (args, state) => {
      const name = markerOf(state, args);
      const t = timeOf(state, args);
      return edit(`Move the marker ${name} to ${String(t)} ms`, { type: "marker", name, t });
    },
  },
  {
    id: "sequence.marker.remove",
    undo: "sequence",
    title: "Remove a marker",
    key: null,
    kind: "edit",
    args: { name: MARKER_ARG },
    selection: NO_RULE,
    build: (args, state) => {
      const name = markerOf(state, args);
      return edit(`Remove the marker ${name}`, { type: "marker", name, t: null });
    },
  },
  {
    id: "sequence.settings",
    undo: "sequence",
    menu: "sequence",
    title: "Set the duration, the loop or the initial state of the sequence",
    key: null,
    kind: "edit",
    args: {
      duration: { type: "number", description: "The duration in ms.", optional: true, integer: true, min: 1 },
      loop: { type: "boolean", description: "True: the time line plays again from 0 at its end.", optional: true },
      initial: {
        type: "string",
        description: "The initial state of the simulations as JSON: an object by plugin ID, or null for none.",
        optional: true,
      },
    },
    selection: NO_RULE,
    build: (args, state) => settingsEdit(state, args),
  },
  {
    id: "sequence.rules",
    undo: "sequence",
    menu: "sequence",
    title: "Set the rules of the sequence",
    key: null,
    kind: "edit",
    args: {
      rules: { type: "string", description: "The rules of the sequence as a JSON list (an empty list removes them)." },
    },
    selection: NO_RULE,
    build: (args, state) => rulesEdit(state, args),
  },
]);

/** The edit of `sequence.rules`. The schema of the sequence checks the rules. */
function rulesEdit(state: SequenceCommandState, args: Args) {
  let value: unknown;
  try {
    value = JSON.parse(textArg(args, "rules")) as unknown;
  } catch {
    throw new CommandError("The rules are not JSON.");
  }
  if (!Array.isArray(value)) throw new CommandError("The rules are a JSON list.");
  if (JSON.stringify(value) === JSON.stringify(state.sequence.rules ?? [])) {
    throw new CommandError("The rules of the sequence are the same.");
  }
  const rules = value as NonNullable<SequenceDocument["rules"]>;
  return edit("Set the rules of the sequence", { type: "settings", rules: rules.length === 0 ? null : rules });
}

/** The edit of `sequence.settings`. A change that changes nothing is a refusal. */
function settingsEdit(state: SequenceCommandState, args: Args) {
  const duration = numberArg(args, "duration");
  const loop = typeof args.loop === "boolean" ? args.loop : undefined;
  const text = textArg(args, "initial");
  let initial: Record<string, unknown> | null | undefined;
  if (text !== "") {
    let value: unknown;
    try {
      value = JSON.parse(text) as unknown;
    } catch {
      throw new CommandError(`The initial state is not JSON: ${text}`);
    }
    if (value !== null && (typeof value !== "object" || Array.isArray(value)))
      throw new CommandError("The initial state is an object by plugin ID, or null.");
    initial = value as Record<string, unknown> | null;
  }
  const doc = state.sequence;
  const same =
    (duration === undefined || duration === doc.duration) &&
    (loop === undefined || loop === (doc.loop ?? false)) &&
    (initial === undefined || JSON.stringify(initial ?? null) === JSON.stringify(doc.initial ?? null));
  if (same) throw new CommandError("The settings of the sequence are the same.");
  const change = {
    type: "settings" as const,
    ...(duration === undefined ? {} : { duration }),
    ...(loop === undefined ? {} : { loop: loop ? true : null }),
    ...(initial === undefined ? {} : { initial: initial as SequenceDocument["initial"] | null }),
  };
  return edit("Set the settings of the sequence", change);
}

function markerOf(state: SequenceCommandState, args: Args): string {
  const name = textArg(args, "name");
  if (state.sequence.markers?.[name] === undefined) throw new CommandError(`No marker "${name}".`);
  return name;
}

/** The ease field of the `ease` argument: a name, or a Bézier ease as JSON. An empty text gives no field. */
function easeOf(text: string): { ease?: unknown } {
  if (text === "") return {};
  if ((EASE_NAMES as readonly string[]).includes(text)) return { ease: text };
  try {
    return { ease: JSON.parse(text) as unknown };
  } catch {
    throw new CommandError(`The ease is a name (${EASE_NAMES.join(", ")}) or a Bézier ease as JSON.`);
  }
}
