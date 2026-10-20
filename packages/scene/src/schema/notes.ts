// SPDX-License-Identifier: Apache-2.0
/**
 * The note document of a scene: `scenity.notes/1` in the side file `<scene>.notes.json` beside the scene file. The
 * editor shows each note as a pin in the Scene view and in the Notes panel. The player never reads the file, so a note
 * never changes a frame. A note is on an entity (`entity:<id>`) or at a world point. It has a text, a status, an
 * optional author and a thread of replies.
 */
import { z } from "zod";
import { zodErrors, type DocError } from "../errors";
import { entityRefSchema, idSchema, vec3Schema } from "./common";

/** The format of a note document. */
export const NOTES_FORMAT = "scenity.notes/1";
/** The end of the name of the note file of a scene: `scenes/main.notes.json` for `scenes/main.scene.json`. */
export const NOTES_SUFFIX = ".notes.json";
/** The states of a note. */
export const NOTE_DOCUMENT_STATES = ["open", "done"] as const;

/** A reply in the thread of a note. */
export const noteReplySchema = z.strictObject({
  text: z.string().min(1).max(2000),
  author: z.string().min(1).max(80).optional(),
  /** The time of the reply: an ISO 8601 date and time. */
  at: z.string().min(1).max(40),
});
export type NoteReply = z.infer<typeof noteReplySchema>;

export const noteSchema = z.strictObject({
  id: idSchema,
  text: z.string().min(1).max(2000),
  /** The place of the note: an entity, or a world point. */
  at: z.union([entityRefSchema, vec3Schema]),
  status: z.enum(NOTE_DOCUMENT_STATES),
  author: z.string().min(1).max(80).optional(),
  /** The replies of the team, the oldest first. */
  replies: z.array(noteReplySchema).max(500).optional(),
});
export type Note = z.infer<typeof noteSchema>;

export const notesDocumentSchema = z.strictObject({
  format: z.literal(NOTES_FORMAT),
  /** The ID of the scene of the notes. */
  scene: idSchema,
  notes: z.array(noteSchema),
});
export type NotesDocument = z.infer<typeof notesDocumentSchema>;

/** The path of the note file of a scene file. */
export function notesPathOf(scenePath: string): string {
  return `${scenePath.replace(/\.scene\.json$/, "")}${NOTES_SUFFIX}`;
}

/** Read a note document from its text. */
export function readNotesDocument(
  text: string,
): { readonly ok: true; readonly doc: NotesDocument } | { readonly ok: false; readonly errors: readonly DocError[] } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    const message = `the file is not JSON: ${error instanceof Error ? error.message : String(error)}`;
    return { ok: false, errors: [{ path: "", message }] };
  }
  const parsed = notesDocumentSchema.safeParse(raw);
  if (!parsed.success) return { ok: false, errors: zodErrors(parsed.error) };
  const ids = parsed.data.notes.map((note) => note.id);
  const twice = ids.find((id, at) => ids.indexOf(id) !== at);
  if (twice !== undefined)
    return { ok: false, errors: [{ path: "/notes", message: `the note ID "${twice}" is there twice` }] };
  return { ok: true, doc: parsed.data };
}
