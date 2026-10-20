// SPDX-License-Identifier: Apache-2.0
// The notes of a scene: the note file `<scene>.notes.json` (`scenity.notes/1`) and the note entities as one list with
// their places. Also the filter, the counts of the hierarchy, and the writes of the file.
import { notesPathOf, readNotesDocument } from "@scenity/scene/schema/notes";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { describe, expect, it } from "vitest";
import { noteCounts, noteItems, PageNotes, shownBy } from "../../src/scene/notes/pageNotes";
import type { SceneFilePort } from "../../src/scene/sceneFiles";

const DOC = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    table: { parent: null, index: 0, components: { transform: { position: [1, 0, 2] } } },
    memo: {
      parent: "table",
      index: 0,
      components: { transform: { position: [0, 1, 0] }, annotation: { text: "Polish it", status: "done" } },
    },
  },
} as unknown as SceneDocument;

/** A file port over a map of texts. */
function memoryFiles(): SceneFilePort & { readonly texts: Map<string, string> } {
  const texts = new Map<string, string>();
  return {
    texts,
    read: (path) => {
      const text = texts.get(path);
      return text === undefined ? Promise.reject(new Error("no file")) : Promise.resolve({ path, text, hash: "h" });
    },
    save: (params) => {
      texts.set(params.path, params.text);
      return Promise.resolve({
        ok: true,
        path: params.path,
        hash: `h${String(texts.size)}`,
        text: params.text,
        changed: true,
      });
    },
  };
}

describe("the notes of a scene", () => {
  it("read the note file and list the file notes and the note entities with their places", () => {
    expect(notesPathOf("scenes/main.scene.json")).toBe("scenes/main.notes.json");
    const read = readNotesDocument(
      JSON.stringify({
        format: "scenity.notes/1",
        scene: "room",
        notes: [
          { id: "a", text: "Too dark", at: "entity:table", status: "open" },
          { id: "b", text: "A plant here", at: [4, 0, 4], status: "open" },
        ],
      }),
    );
    if (!read.ok) throw new Error("no notes");
    const items = noteItems(DOC, read.doc);
    expect(items.map((item) => [item.key, item.status, item.entity, item.at])).toEqual([
      ["file:a", "open", "table", [1, 0, 2]],
      ["file:b", "open", null, [4, 0, 4]],
      ["entity:memo", "done", "table", [1, 1, 2]],
    ]);
    expect([...noteCounts(items)]).toEqual([["table", 1]]);
    expect(items.filter((item) => shownBy("open", item)).map((item) => item.key)).toEqual(["file:a", "file:b"]);
    expect(items.filter((item) => shownBy("none", item))).toEqual([]);
    expect(
      readNotesDocument(
        '{"format":"scenity.notes/1","scene":"room","notes":[{"id":"a","text":"x","at":[0,0,0],"status":"open"},{"id":"a","text":"y","at":[0,0,0],"status":"open"}]}',
      ).ok,
    ).toBe(false);
  });

  it("add, close and remove a note of the file, which the port writes at once", async () => {
    const files = memoryFiles();
    const notes = new PageNotes(files, "scenes/main.scene.json", "room");
    await notes.load();
    expect(notes.file.value).toBeNull();
    const id = await notes.add("Move the lamp", "entity:table");
    await notes.add("A rug", [0, 0, 1]);
    await notes.setStatus(id, "done");
    const written = readNotesDocument(files.texts.get("scenes/main.notes.json") ?? "");
    if (!written.ok) throw new Error("bad file");
    expect(written.doc.notes.map((note) => [note.id, note.status])).toEqual([
      ["note-1", "done"],
      ["note-2", "open"],
    ]);
    await notes.remove("note-2");
    expect(notes.file.value?.notes.map((note) => note.id)).toEqual(["note-1"]);
  });
});
