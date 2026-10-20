// SPDX-License-Identifier: Apache-2.0
/**
 * The note tools. `note_list` gives the notes of the open scene (the entities with the `annotation` component).
 * `note_resolve` links the turn of the session to a note and marks the note done. The resolve is two `component.set`
 * steps as one change, so in Review mode it waits with the other changes of the turn.
 */
import { COMMAND_BATCH_CALL, SCENE_QUERY_CALL, type SceneQueryEntity } from "@scenity/bridge";
import { z } from "zod";
import { editLines } from "./edit";
import { callTyped, defineTool, frameUrl, textResult } from "./kit";

/** The line of one note. */
export function noteLine(entity: SceneQueryEntity): string {
  const note = (entity.values?.annotation ?? {}) as { text?: unknown; status?: unknown; task?: unknown };
  const target = entity.parent === null ? "at a point" : `on ${entity.parent}`;
  const status = note.status === "done" ? "done" : "open";
  const task = typeof note.task === "string" ? ` · task ${note.task}` : "";
  return `${entity.id} (${target}) · ${status}${task} · ${JSON.stringify(note.text ?? "")}`;
}

export const noteList = defineTool({
  name: "note_list",
  description:
    "List the notes of the open scene: the entities with the annotation component, each with its target (the parent " +
    "entity, or a point), its state (open or done), the turn that did it and its text. A note is a task of the person.",
  input: z.object({
    open: z.boolean().optional().describe("true: only the open notes (default: all)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const query = { component: "annotation", values: ["annotation"], limit: 500 };
    const answer = await callTyped(ctx.surface("visible"), SCENE_QUERY_CALL, [query]);
    const notes = answer.entities.filter(
      (entity) => input.open !== true || (entity.values?.annotation as { status?: unknown }).status !== "done",
    );
    if (notes.length === 0) return textResult([input.open === true ? "No open note." : "No note."]);
    return textResult([`${String(notes.length)} notes:`, ...notes.map(noteLine)]);
  },
});

export const noteResolve = defineTool({
  name: "note_resolve",
  description:
    "Mark a note of the open scene done and link it to this turn (its change set): the note gets the status 'done' " +
    "and the key '<session>#<turn>' in its task field. Use it after the changes that do the task of the note.",
  input: z.object({
    note: z.string().min(1).describe("The entity ID of the note (note_list gives them)."),
  }),
  alwaysLoad: false,
  async handler(input, ctx) {
    const port = ctx.surface("visible");
    const session = ctx.session;
    const task = session === undefined ? "" : `${session.id}#${String(session.turn ?? 0)}`;
    const set = (field: string, value: string) => ({
      command: "component.set",
      args: { entity: input.note, component: "annotation", field, value: JSON.stringify(value) },
    });
    const steps = [set("status", "done"), ...(task === "" ? [] : [set("task", task)])];
    const how = { by: "claude", ...(session === undefined ? {} : { session }) };
    const result = await callTyped(port, COMMAND_BATCH_CALL, [steps, "Resolve the note", how]);
    return textResult(editLines(result, await frameUrl(port), "the editor"));
  },
});
