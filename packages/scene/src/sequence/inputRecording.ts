// SPDX-License-Identifier: Apache-2.0
/**
 * The reader and the writer of the input recording `*.input.json` (schema/input.ts). The writer is the
 * canonical writer of the documents, so a read then a write gives the same bytes. The reader checks the schema and
 * the time order of the events.
 */
import { canonicalJson } from "../canonical";
import { formatErrors, zodErrors, type DocError } from "../errors";
import { INPUT_FORMAT, inputRecordingSchema, type InputEvent, type InputRecording } from "../schema/input";
import { inputEvent } from "./input";

export type InputRecordingResult =
  { readonly ok: true; readonly doc: InputRecording } | { readonly ok: false; readonly errors: readonly DocError[] };

/** The parts of a new recording: the IDs, the events (in time order or not) and the notes. */
export interface InputRecordingParts {
  readonly id: string;
  readonly scene: string;
  readonly sequence?: string | undefined;
  readonly events: readonly InputEvent[];
  readonly meta?: InputRecording["meta"];
}

/** Make a recording. A stable sort puts the events in time order. Events at the same time keep their order. */
export function inputRecording(parts: InputRecordingParts): InputRecording {
  const events = parts.events.map(inputEvent).sort((a, b) => a.t - b.t);
  return {
    format: INPUT_FORMAT,
    id: parts.id,
    scene: parts.scene,
    ...(parts.sequence === undefined ? {} : { sequence: parts.sequence }),
    events,
    ...(parts.meta === undefined ? {} : { meta: parts.meta }),
  };
}

/** The canonical text of a recording. */
export function writeInputRecording(doc: InputRecording): string {
  return canonicalJson(doc);
}

/** Read a recording from its text or its parsed value. */
export function readInputRecording(source: unknown): InputRecordingResult {
  let value: unknown = source;
  if (typeof source === "string") {
    try {
      value = JSON.parse(source);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return { ok: false, errors: [{ path: "", message: `the text is not JSON: ${message}` }] };
    }
  }
  const parsed = inputRecordingSchema.safeParse(value);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const errors: DocError[] = [];
  parsed.data.events.forEach((event, index) => {
    if (index > 0 && event.t < (parsed.data.events[index - 1]?.t ?? 0)) {
      errors.push({ path: `/events/${String(index)}/t`, message: "the event is before the event above it" });
    }
  });
  return errors.length > 0 ? { ok: false, errors } : { ok: true, doc: parsed.data };
}

/** Read a recording, or throw an error with the problems. */
export function parseInputRecording(source: unknown): InputRecording {
  const result = readInputRecording(source);
  if (!result.ok) throw new Error(`not a ${INPUT_FORMAT} recording:\n${formatErrors(result.errors)}`);
  return result.doc;
}
