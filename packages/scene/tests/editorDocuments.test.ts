// SPDX-License-Identifier: Apache-2.0
// The editor documents: the editor settings (`scenity.editor/1`) and the key map (`scenity.keymap/1`). The
// fixtures read and write to the same bytes, the JSON Schemas accept them, and the reader refuses a bad value with
// its JSON Pointer.
import { describe, expect, test } from "bun:test";
import { editorJsonSchemas, readEditorDocument, writeDocument } from "../src/index";
import { fixtureText } from "./helpers";
import { validate } from "./jsonSchemaSubset";

const FIXTURES = [
  ["editor/showroom.editor.json", "editor"],
  ["editor/user.keymap.json", "keymap"],
] as const;

describe("the editor documents", () => {
  test.each(FIXTURES)("%s reads, writes to the same bytes, and the JSON Schema accepts it", (name, kind) => {
    const text = fixtureText(name);
    const read = kind === "editor" ? readEditorDocument(text, kind) : readEditorDocument(text, kind);
    if (!read.ok) throw new Error(JSON.stringify(read.errors));
    expect(writeDocument(read.doc)).toBe(text);
    expect(validate(editorJsonSchemas()[kind], JSON.parse(text))).toEqual([]);
  });

  test("the reader refuses a bad value, an unknown field and a newer version, with the path", () => {
    const grid = readEditorDocument('{"format":"scenity.editor/1","snaps":{"grid":0}}', "editor");
    expect(grid.ok ? [] : grid.errors.map((error) => error.path)).toEqual(["/snaps/grid"]);
    const extra = readEditorDocument('{"format":"scenity.editor/1","theme":"dark"}', "editor");
    expect(extra.ok ? [] : extra.errors.map((error) => error.path)).toEqual(["/theme"]);
    expect(readEditorDocument('{"format":"scenity.editor/2"}', "editor").ok).toBe(false);
    expect(readEditorDocument("{", "keymap").ok).toBe(false);
  });

  test("a key of the key map has the fixed form: the modifiers in order, then the key", () => {
    const keys = (list: string[]) =>
      readEditorDocument(JSON.stringify({ format: "scenity.keymap/1", keys: { "view.frame": list } }), "keymap").ok;
    expect(keys(["G", "Mod+Shift+Z", "Alt+F2", "Shift+,", "Delete", "Space", "0"])).toBe(true);
    expect(keys(["g"])).toBe(false);
    expect(keys(["Shift+Mod+Z"])).toBe(false);
    expect(keys(["Ctrl+S"])).toBe(false);
    const id = readEditorDocument(JSON.stringify({ format: "scenity.keymap/1", keys: { "View frame": [] } }), "keymap");
    expect(id.ok).toBe(false);
  });
});
