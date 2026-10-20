// SPDX-License-Identifier: Apache-2.0
// The note document of a scene with the replies of a thread.
import { describe, expect, test } from "bun:test";
import { notesPathOf, readNotesDocument } from "../src/schema/notes";

const note = (extra: object = {}): object => ({
  id: "note-1",
  text: "Move it",
  at: "entity:chair",
  status: "open",
  ...extra,
});
const doc = (notes: object[]): string => JSON.stringify({ format: "scenity.notes/1", scene: "main", notes });

describe("the note document", () => {
  test("reads a note with a thread of replies", () => {
    const replies = [
      { text: "I can move it", author: "Ana", at: "2026-10-19T10:00:00.000Z" },
      { text: "Thanks", at: "2026-10-19T10:05:00.000Z" },
    ];
    const read = readNotesDocument(doc([note({ author: "Bruno", replies })]));
    expect(read.ok && read.doc.notes[0]?.replies?.length).toBe(2);
  });

  test("refuses a reply with no text or no time, and a note ID twice", () => {
    expect(readNotesDocument(doc([note({ replies: [{ text: "", at: "2026-10-19T10:00:00Z" }] })])).ok).toBe(false);
    expect(readNotesDocument(doc([note({ replies: [{ text: "Hi" }] })])).ok).toBe(false);
    expect(readNotesDocument(doc([note(), note()])).ok).toBe(false);
  });

  test("names the note file beside the scene file", () => {
    expect(notesPathOf("scenes/main.scene.json")).toBe("scenes/main.notes.json");
  });
});
