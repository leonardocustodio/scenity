// SPDX-License-Identifier: Apache-2.0
/**
 * The recorded state stream: the reader and the writer of `*.stream.jsonl` (schema/stream.ts) and the
 * recorded source of a stream. A stream plays like a sequence: the state at a time `t` is a pure function of the
 * stream and `t`, so a seek gives the state of playback.
 *
 * The state at `t` holds each field that a sample at or before `t` sets. A `step` field has the value of the last
 * sample at or before `t` that sets it. A `linear` field interpolates between that sample and the next sample that
 * sets the field, when the two values are numbers or number arrays of the same length. Other values step. Before its
 * first sample, a field is not in the state.
 */
import { roundNumber } from "../canonical";
import { formatErrors, zodErrors, type DocError } from "../errors";
import { isObject, sortedKeys, type JsonValue } from "../json";
import type { SequenceDocument } from "../schema/sequence";
import {
  STREAM_FORMAT,
  streamHeaderSchema,
  streamSampleSchema,
  type FieldMode,
  type StreamDocument,
  type StreamHeader,
  type StreamSample,
} from "../schema/stream";
import { lastKeyAt } from "./sample";
import { inputOf, type SimulationSource, type SourceOptions } from "./source";

/** The state of a stream at a time: the value of each field, by field name. */
export type StreamState = Readonly<Record<string, JsonValue>>;

export type StreamReadResult =
  { readonly ok: true; readonly doc: StreamDocument } | { readonly ok: false; readonly errors: readonly DocError[] };

/** A JSON value with sorted keys and each number on the grid of the documents. */
function canonicalLineValue(value: unknown): unknown {
  if (typeof value === "number") return roundNumber(value);
  if (Array.isArray(value)) return value.map(canonicalLineValue);
  if (isObject(value)) {
    const out: Record<string, unknown> = {};
    for (const key of sortedKeys(value)) if (value[key] !== undefined) out[key] = canonicalLineValue(value[key]);
    return out;
  }
  return value;
}

/** The text of one line: compact JSON with sorted keys and each number on the grid. */
function writeLine(value: unknown): string {
  return JSON.stringify(canonicalLineValue(value));
}

/** The canonical text of a stream: the header line, then one line for each sample, and a final newline. */
export function writeStream(doc: StreamDocument): string {
  const { samples, ...header } = doc;
  return `${[header, ...samples].map(writeLine).join("\n")}\n`;
}

/** The checks over more than one line: the samples are in time order, and each time is in 0..duration. */
function streamOrderErrors(header: StreamHeader, samples: readonly StreamSample[]): DocError[] {
  const errors: DocError[] = [];
  for (const [name, t] of Object.entries(header.markers ?? {})) {
    if (t > header.duration) errors.push({ path: `/0/markers/${name}`, message: "the marker is after the duration" });
  }
  samples.forEach((sample, index) => {
    const path = `/${String(index + 1)}/t`;
    if (sample.t > header.duration) errors.push({ path, message: "the sample is after the duration" });
    if (index > 0 && sample.t < (samples[index - 1]?.t ?? 0)) {
      errors.push({ path, message: "the sample is before the sample of the line above it" });
    }
  });
  return errors;
}

/** Read a stream from its text. An error path starts with the line index (`/0` is the header). */
export function readStream(text: string): StreamReadResult {
  const lines = text.split("\n").filter((line) => line.trim() !== "");
  const values: unknown[] = [];
  for (const [index, line] of lines.entries()) {
    try {
      values.push(JSON.parse(line));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, errors: [{ path: `/${String(index)}`, message: `the line is not JSON: ${message}` }] };
    }
  }
  const [first, ...rest] = values;
  if (!isObject(first) || first.format !== STREAM_FORMAT) {
    return { ok: false, errors: [{ path: "/0/format", message: `the first line is a ${STREAM_FORMAT} header` }] };
  }
  const header = streamHeaderSchema.safeParse(first);
  if (!header.success) return { ok: false, errors: zodErrors(header.error, "/0") };
  const errors: DocError[] = [];
  const samples: StreamSample[] = [];
  rest.forEach((value, index) => {
    const sample = streamSampleSchema.safeParse(value);
    if (sample.success) samples.push(value as StreamSample);
    else errors.push(...zodErrors(sample.error, `/${String(index + 1)}`));
  });
  errors.push(...streamOrderErrors(first as StreamHeader, samples));
  if (errors.length > 0) return { ok: false, errors };
  // The reader gives the input values, as readDocument does: the order of the keys stays.
  return { ok: true, doc: { ...(first as StreamHeader), samples } };
}

/** Read a stream, or throw an error with the problems. */
export function parseStream(text: string): StreamDocument {
  const result = readStream(text);
  if (!result.ok) throw new Error(`not a ${STREAM_FORMAT} stream:\n${formatErrors(result.errors)}`);
  return result.doc;
}

/** The value between two values of a `linear` field. A value that cannot interpolate steps. */
function mixValue(a: JsonValue, b: JsonValue, fraction: number): JsonValue {
  if (typeof a === "number" && typeof b === "number") return a + (b - a) * fraction;
  const numbers = (value: JsonValue): value is number[] =>
    Array.isArray(value) && value.every((item) => typeof item === "number");
  if (numbers(a) && numbers(b) && a.length === b.length)
    return a.map((item, i) => item + ((b[i] ?? item) - item) * fraction);
  return a;
}

/** A recorded source: the samples of a stream. Its state at each time is a state object (empty before a sample). */
export interface RecordedSource<S = StreamState, P = S> extends SimulationSource<S, P> {
  readonly kind: "recorded";
  readonly duration: number;
  readonly stream: StreamDocument;
  stateAt(t: number): S;
  /**
   * The index of the last sample at or before `t`, or -1. The state of a stream with no `linear` field changes only
   * when this index changes.
   */
  sampleAt(t: number): number;
}

interface FieldKeys {
  readonly name: string;
  readonly mode: FieldMode;
  readonly keys: readonly { readonly t: number; readonly value: JsonValue }[];
}

/** The keys of each field in the order of the field names. */
function fieldKeys(stream: StreamDocument): FieldKeys[] {
  const keys = new Map<string, { t: number; value: JsonValue }[]>();
  for (const sample of stream.samples) {
    for (const [name, value] of Object.entries(sample.set)) {
      const list = keys.get(name) ?? [];
      list.push({ t: sample.t, value });
      keys.set(name, list);
    }
  }
  return [...keys.keys()].sort().map((name) => ({
    name,
    mode: stream.fields?.[name] ?? "step",
    keys: keys.get(name) ?? [],
  }));
}

/**
 * Make the recorded source of a stream. The state type `S` is the type that the plugin gives the fields. The reader
 * checks only the JSON form. The calls of one sample share a state object: treat it as read only.
 */
export function recordedSource<S extends object = StreamState, P = S>(
  stream: StreamDocument,
  options: Partial<SourceOptions<S, P>> = {},
): RecordedSource<S, P> {
  const fields = fieldKeys(stream);
  const stepOnly = fields.every((field) => field.mode === "step");
  let memo: { readonly sample: number; readonly state: S } | undefined;
  const sampleAt = (t: number): number => {
    if (!Number.isFinite(t)) throw new RangeError(`a source time is a finite number of ms, not ${String(t)}`);
    return lastKeyAt(stream.samples, t);
  };
  const stateAt = (t: number): S => {
    const sample = sampleAt(t);
    if (stepOnly && memo?.sample === sample) return memo.state;
    const state: Record<string, JsonValue> = {};
    for (const field of fields) {
      const index = lastKeyAt(field.keys, t);
      const key = field.keys[index];
      if (key === undefined) continue;
      const next = field.mode === "linear" ? field.keys[index + 1] : undefined;
      state[field.name] =
        next === undefined || next.t <= key.t
          ? key.value
          : mixValue(key.value, next.value, (t - key.t) / (next.t - key.t));
    }
    memo = { sample, state: state as S };
    return memo.state;
  };
  const project = { id: stream.plugin, ...options };
  return {
    id: project.id,
    kind: "recorded",
    duration: stream.duration,
    stream,
    stateAt,
    sampleAt,
    inputAt: (t) => inputOf(project, stateAt(t), t),
  };
}

/**
 * A sequence with no tracks and the time line of a stream (its duration and markers). The evaluator plays a stream on
 * it like a sequence: `createEvaluator({ scene, sequence: streamSequence(stream, scene.id), sources: [source] })`.
 */
export function streamSequence(stream: StreamHeader, scene: string): SequenceDocument {
  const markers = stream.markers === undefined ? {} : { markers: { ...stream.markers } };
  return { format: "scenity.sequence/1", id: stream.id, scene, duration: stream.duration, ...markers, tracks: [] };
}
