// SPDX-License-Identifier: Apache-2.0
// The clipboard: copy entities of the generic fixture scene with their subtrees, and paste them as `add` scene ops with
// new IDs. A paste is one edit with one undo step. A reference inside the copy names the copy.
import { describe, expect, it } from "bun:test";
import { applyOps } from "@scenity/scene/ops";
import { writeDocument } from "@scenity/scene";
import { Clipboard, copyEntities, freeId, pasteOps } from "../src/index";
import { components, fixtureEditor, garden } from "./helpers";

describe("the clipboard", () => {
  it("copies an entity with its subtree once, in the order of the tree", () => {
    const doc = garden();
    const data = copyEntities(doc, ["lamp", "table", "sun", "pond"]);
    expect(data.roots).toEqual(["table", "sun"]);
    expect(Object.keys(data.entities).sort()).toEqual(["lamp", "sun", "table"]);
  });

  it("gives free IDs: the base ID, else the next free number suffix", () => {
    const taken = new Set(["cart", "cart-2"]);
    expect(freeId("cart", taken)).toBe("cart-3");
    expect(freeId("cart-2", taken)).toBe("cart-3");
    expect(freeId("pond", taken)).toBe("pond");
  });

  it("pastes as add ops under the roots; a reference inside the copy names the copy", () => {
    const doc = garden();
    const paste = pasteOps(doc, copyEntities(doc, ["table", "sun"]));
    expect(paste.roots).toEqual(["table-2", "sun-2"]);
    expect(paste.ops.map((op) => (op.op === "add" ? [op.id, op.entity.parent, op.entity.index] : op.op))).toEqual([
      ["table-2", null, 3],
      ["lamp-2", "table-2", 0],
      ["sun-2", null, 4],
    ]);
    const result = applyOps(doc, paste.ops, components);
    if (!result.ok) throw new Error(result.reason);
    expect((result.doc.entities["lamp-2"]?.components.light as { target: string }).target).toBe("entity:table-2#top");
    // The sun points at the bench. The bench is not in the copy, so the reference stays.
    expect((result.doc.entities["sun-2"]?.components.light as { target: string }).target).toBe("entity:bench");
  });

  it("is one edit with one undo step through the history of the editor", () => {
    const editor = fixtureEditor();
    const before = writeDocument(editor.scene.value);
    const clipboard = new Clipboard();
    expect(clipboard.paste(editor.scene.value)).toBeNull();
    expect(clipboard.copy(editor.scene.value, ["table"])).toBe(2);
    const paste = clipboard.paste(editor.scene.value, { parent: "bench" });
    if (paste === null) throw new Error("no paste");
    const ops = paste.ops.map((op) => ({ kind: "scene" as const, op }));
    expect(editor.history.apply({ id: "paste#1", title: "Paste", ops }, editor.kinds, editor.context).applied).toBe(
      true,
    );
    expect(editor.scene.value.entities["table-2"]?.parent).toBe("bench");
    editor.history.undo();
    expect(writeDocument(editor.scene.value)).toBe(before);
  });
});
