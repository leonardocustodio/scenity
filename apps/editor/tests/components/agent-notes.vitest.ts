// SPDX-License-Identifier: Apache-2.0
// Notes as tasks: the task of a note entity, its prompt, and the ops that mark it done.
import { describe, expect, it } from "vitest";
import { doneOps, notePrompt, noteTask } from "../../src/scene/agent/noteTasks";
import type { ScenePageEditor } from "../../src/scene/sceneEditor";

const DOC = {
  entities: {
    chair: { name: "Chair", parent: null, components: {} },
    note: { name: "Note", parent: "chair", components: { annotation: { text: "Turn it" } } },
    pin: { name: "Pin", parent: null, components: { annotation: { text: "A lamp here" } } },
  },
} as unknown as ScenePageEditor["doc"];

describe("notes as tasks", () => {
  it("read the text and the target of a note", () => {
    expect(noteTask(DOC, "note")).toEqual({ text: "Turn it", target: "chair" });
    expect(noteTask(DOC, "pin")).toEqual({ text: "A lamp here", target: null });
    expect(noteTask(DOC, "chair")).toBeNull();
    expect(noteTask(DOC, "gone")).toBeNull();
  });

  it("give a prompt and the ops of a done note", () => {
    expect(notePrompt("Turn it", "Chair")).toBe('Do the task of the note "Turn it" on Chair.');
    expect(notePrompt("A lamp here", null)).toBe('Do the task of the note "A lamp here".');
    expect(doneOps("note", "s1#2")).toEqual([
      { op: "set", path: "/entities/note/components/annotation/status", value: "done" },
      { op: "set", path: "/entities/note/components/annotation/task", value: "s1#2" },
    ]);
  });
});
