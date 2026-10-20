// SPDX-License-Identifier: Apache-2.0
// One history for all edits: the scene ops, the tune values and the scratch list of the generic fixture scene are
// channels of one history. An edit is one step for all of its ops. A change outside an edit is one step, and a drag is
// one step. An undo restores every channel, and a refused op changes nothing.
import { describe, expect, it } from "bun:test";
import { writeDocument } from "@scenity/scene";
import { EditError } from "../src/index";
import { fixtureEditor, garden } from "./helpers";

describe("the edit history", () => {
  it("applies an edit of scene, tune and source ops as one step, and an undo restores the same bytes", () => {
    const editor = fixtureEditor();
    const before = writeDocument(editor.scene.value);
    const result = editor.history.apply(
      {
        id: "e1",
        title: "Move the table, dim the light, save",
        ops: [
          {
            kind: "scene",
            op: { op: "set", path: "/entities/table/components/transform/position", value: [0.5, 0, 0] },
          },
          { kind: "scene", op: { op: "move", id: "lamp", parent: "bench", index: 0 } },
          { kind: "tune", path: "light.share", value: 0.4 },
          { kind: "source", tool: "scene save", args: { scene: "garden" } },
        ],
      },
      editor.kinds,
      editor.context,
    );
    expect(result).toEqual({ applied: true, pending: [{ edit: "e1", tool: "scene save", args: { scene: "garden" } }] });
    expect(editor.scene.value.entities.lamp?.parent).toBe("bench");
    expect(editor.tunes.value).toEqual({ "light.share": 0.4 });
    expect(editor.history.steps().steps.map((step) => step.label?.title ?? "start")).toEqual([
      "start",
      "Move the table, dim the light, save",
    ]);
    expect(editor.history.undo()).toBe(true);
    expect(writeDocument(editor.scene.value)).toBe(before);
    expect(editor.tunes.value).toEqual({});
    expect(editor.history.redo()).toBe(true);
    expect(editor.scene.value.entities.lamp?.parent).toBe("bench");
  });

  it("gives no step for an edit that changes nothing, and keeps the state after a refused op", () => {
    const editor = fixtureEditor();
    const none = editor.history.apply(
      { id: "e0", title: "Same", ops: [{ kind: "tune", path: "light.share", value: 1 }] },
      editor.kinds,
      editor.context,
    );
    expect(none.applied).toBe(false);
    const doc = editor.scene.value;
    expect(() =>
      editor.history.apply(
        {
          id: "e2",
          title: "Bad",
          ops: [
            { kind: "tune", path: "light.share", value: 0.2 },
            { kind: "scene", op: { op: "remove", id: "pond" } },
          ],
        },
        editor.kinds,
        editor.context,
      ),
    ).toThrow(EditError);
    expect(editor.scene.value).toBe(doc);
    expect(editor.tunes.value).toEqual({});
    expect(editor.history.canUndo).toBe(false);
  });

  it("keeps a change of the scratch list outside an edit as a step (scratch too), and a drag as one step", () => {
    const editor = fixtureEditor();
    editor.scratch.value = ["chair@1,0,1,0"];
    editor.history.note();
    editor.history.hold();
    for (const x of [0.1, 0.2, 0.3]) {
      editor.tunes.value = { "light.share": x };
      editor.history.note();
    }
    editor.history.release();
    const titles = editor.history.steps().steps.map((step) => step.label?.title ?? "start");
    expect(titles).toEqual(["start", "scratch props", "tune values"]);
    editor.history.undo();
    expect(editor.tunes.value).toEqual({});
    expect(editor.scratch.value).toEqual(["chair@1,0,1,0"]);
    editor.history.undo();
    expect(editor.scratch.value).toEqual([]);
    expect(editor.history.undo()).toBe(false);
  });

  it("keeps at most the number of steps that it was made with", () => {
    const editor = fixtureEditor();
    for (let step = 1; step <= 120; step += 1) {
      editor.tunes.value = { "light.share": step / 1000 };
      editor.history.note();
    }
    expect(editor.history.steps().steps).toHaveLength(100);
    expect(garden().entities.table?.name).toBe("Table");
  });

  it("goes to a step in one action that one redo cancels", () => {
    const editor = fixtureEditor();
    let changes = 0;
    const stop = editor.history.listen(() => (changes += 1));
    for (let step = 1; step <= 9; step += 1) {
      editor.tunes.value = { "light.share": step / 10 };
      editor.history.note();
    }
    const share = (): unknown => (editor.tunes.value as Record<string, unknown>)["light.share"];
    expect(editor.history.steps().index).toBe(9);
    expect(changes).toBe(9);
    stop();
    // Step 3 of 10 (index 2): seven steps back as one action.
    expect(editor.history.goTo(2)).toBe(true);
    expect(editor.history.steps().index).toBe(2);
    expect(share()).toBe(0.2);
    expect(editor.history.steps().steps).toHaveLength(10);
    expect(editor.history.redo()).toBe(true);
    expect(editor.history.steps().index).toBe(9);
    expect(share()).toBe(0.9);
    // After a jump back, an undo is one step. The next redo is also one step.
    editor.history.goTo(4);
    editor.history.undo();
    expect(editor.history.steps().index).toBe(3);
    editor.history.redo();
    expect(editor.history.steps().index).toBe(4);
    // One undo cancels a jump forward. An index out of the list or the current step changes nothing.
    editor.history.goTo(8);
    editor.history.undo();
    expect(editor.history.steps().index).toBe(4);
    expect(editor.history.goTo(4)).toBe(false);
    expect(editor.history.goTo(40)).toBe(false);
    // A new step after a jump removes the redo steps, as after an undo.
    editor.history.goTo(1);
    editor.tunes.value = { "light.share": 0.55 };
    editor.history.note();
    expect(editor.history.steps().steps).toHaveLength(3);
    expect(editor.history.redo()).toBe(false);
  });
});
