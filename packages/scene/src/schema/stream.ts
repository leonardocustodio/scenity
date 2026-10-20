// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of the recorded state stream `*.stream.jsonl`: the states of a simulation over time, as an external
 * source records them. The file has one JSON value on each line. The first line is the header. Each other line is a
 * sample. A sample sets the fields that it names. Each other field keeps its value of the last sample that set it.
 * Time is an integer count of milliseconds.
 */
import { z } from "zod";
import { idSchema } from "./common";
import { NAME_PATTERN, pluginIdSchema, timeSchema } from "./sequence";

/** The format of a stream header. */
export const STREAM_FORMAT = "scenity.stream/1";

/** The rules of a field between two samples: `step` holds the last value, and `linear` interpolates numbers. */
export const FIELD_MODES = ["step", "linear"] as const;
export type FieldMode = (typeof FIELD_MODES)[number];

const nameSchema = z.string().regex(NAME_PATTERN, "a name has 1 to 64 letters, digits, '_', '.', ':' or '-'");

/** The first line of a stream file. */
export const streamHeaderSchema = z.strictObject({
  format: z.literal(STREAM_FORMAT),
  id: idSchema,
  /** The simulation plugin of the state: the frame state keeps the stream state under this ID. */
  plugin: pluginIdSchema,
  /** The length of the time line in ms. Each sample and each marker is in 0..duration. */
  duration: timeSchema,
  /** The rule of each field between two samples. A field that is not in the list steps. */
  fields: z.record(nameSchema, z.enum(FIELD_MODES)).optional(),
  markers: z.record(nameSchema, timeSchema).optional(),
  /** Free notes of the recorder (the source of the record, a hash, a seed). The engine does not read them. */
  meta: z.record(z.string(), z.json()).optional(),
});

/** One line after the header: the time and the values of the fields that change at that time. */
export const streamSampleSchema = z.strictObject({
  t: timeSchema,
  set: z.record(nameSchema, z.json()),
});

/** One line of a stream file: the header or a sample (the JSON Schema of `stream.schema.json`). */
export const streamLineSchema = z.union([streamHeaderSchema, streamSampleSchema]);

export type StreamHeader = z.infer<typeof streamHeaderSchema>;
export type StreamSample = z.infer<typeof streamSampleSchema>;

/** A stream in memory: the header and the samples in time order. */
export interface StreamDocument extends StreamHeader {
  readonly samples: readonly StreamSample[];
}
