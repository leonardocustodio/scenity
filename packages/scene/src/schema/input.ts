// SPDX-License-Identifier: Apache-2.0
/**
 * The zod schema of the input recording `*.input.json`: the input events of a play session with
 * their simulation times. A replay gives the events to the document core at their times, so the frames of the replay
 * are the frames of the live session. Time is an integer count of milliseconds. The events are in time order. Events
 * at the same time apply in the order of the file.
 */
import { z } from "zod";
import { idSchema, vec3Schema } from "./common";
import { ACTION_PATTERN, timeSchema } from "./sequence";

/** The format of an input recording. */
export const INPUT_FORMAT = "scenity.input/1";

/** The kinds of an input event: a key or a pointer button goes down (`press`) or up (`release`). */
export const INPUT_KINDS = ["press", "release"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** One input event: the time, the kind, the action of the input map, and the entity and world point of a pointer. */
export const inputEventSchema = z.strictObject({
  t: timeSchema,
  kind: z.enum(INPUT_KINDS),
  /** The action name `<plugin ID>.<name>` of the input map of a plugin (`demo.toggle`). */
  action: z.string().regex(ACTION_PATTERN, "an action is <plugin>.<name>"),
  /** The entity under the pointer at the press. Absent for a key, and for a pointer press on no entity. */
  entity: idSchema.optional(),
  /** The world point of the pointer hit in metres, on the number grid of the documents. */
  point: vec3Schema.optional(),
});

/** The input recording document. */
export const inputRecordingSchema = z.strictObject({
  format: z.literal(INPUT_FORMAT),
  id: idSchema,
  /** The ID of the scene document of the session. */
  scene: idSchema,
  /** The ID of the sequence document of the session, when it has one. */
  sequence: idSchema.optional(),
  events: z.array(inputEventSchema),
  /** Free notes of the recorder. The engine does not read them. */
  meta: z.record(z.string(), z.json()).optional(),
});

export type InputEvent = z.infer<typeof inputEventSchema>;
export type InputRecording = z.infer<typeof inputRecordingSchema>;
