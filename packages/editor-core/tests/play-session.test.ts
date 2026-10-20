// SPDX-License-Identifier: Apache-2.0
// The play mode on the generic garden scene: the edit state and the play state are separate. An edit during the play
// mode changes only the play state. Stop restores the edit state and its steps exactly. Keep applies the chosen parts
// of the changes to the edit state as one step of the history.
import { describe, expect, it } from "bun:test";
import { writeDocument, type SceneOp } from "@scenity/scene";
import { componentPart, EditError, PlaySession, SEQUENCE_PART } from "../src/index";
import { sequenceEditor } from "./sequenceFixture";

const TABLE = "/entities/table/components/transform/position";
const BENCH = "/entities/bench/components/transform/position";
const SUN = "/entities/sun/components/light/intensity";

function set(path: string, value: number[] | number): SceneOp[] {
  return [{ op: "set", path, value }];
}

function setup() {
  const editor = sequenceEditor();
  const session = new PlaySession(editor.channel);
  return { ...editor, session };
}

describe("the play mode", () => {
  it("keeps the edits of the play mode out of the edit state, and stop puts the edit state back exactly", () => {
    const { channel, sequence, session, runtime } = setup();
    channel.edit(set(TABLE, [0.5, 0, 0]), "Edit before the play mode");
    const edit = channel.doc;
    const editText = writeDocument(edit);
    const editSequence = sequence.doc;
    session.enter();
    expect(session.active).toBe(true);
    channel.edit(set(TABLE, [2, 0, 0]), "Move in the play mode");
    channel.edit(set(SUN, 3), "Light in the play mode");
    expect(session.editDoc).toBe(edit);
    expect(channel.doc.entities.table?.components.transform).toEqual({ position: [2, 0, 0] });
    // An undo in the play mode moves back over the steps of the play mode.
    expect(channel.undo()).toBe(true);
    expect(channel.doc.entities.sun?.components.light).toEqual(edit.entities.sun?.components.light);
    expect(channel.doc.entities.table?.components.transform).toEqual({ position: [2, 0, 0] });
    const patches = runtime.scene.length;
    session.stop();
    expect(session.active).toBe(false);
    expect(channel.doc).toBe(edit);
    expect(writeDocument(channel.doc)).toBe(editText);
    expect(sequence.doc).toBe(editSequence);
    // The runtime gets the ops that restore the edit state.
    expect(runtime.scene.length).toBe(patches + 1);
    // The steps of the play mode go. One undo gives the state before the edit of the edit mode, then no step remains.
    expect(channel.history.canRedo).toBe(false);
    expect(channel.undo()).toBe(true);
    expect(channel.doc.entities.table?.components.transform).toEqual({ position: [0, 0, 0] });
    expect(channel.undo()).toBe(false);
  });

  it("keeps the redo steps of the edit mode over a play mode", () => {
    const { channel, session } = setup();
    channel.edit(set(TABLE, [1, 0, 0]), "Move");
    channel.undo();
    session.enter();
    channel.edit(set(BENCH, [0, 0, 0]), "Move the bench");
    session.stop();
    expect(channel.redo()).toBe(true);
    expect(channel.doc.entities.table?.components.transform).toEqual({ position: [1, 0, 0] });
  });

  it("lists the changes by part, and keep applies all of them as one undo step", () => {
    const { channel, session } = setup();
    const edit = channel.doc;
    session.enter();
    channel.edit(set(TABLE, [2, 0, 0]), "Move the table");
    channel.edit(set(BENCH, [0, 0, 3]), "Move the bench");
    const play = channel.doc;
    const changes = session.changes();
    expect(changes.map((change) => change.id)).toEqual([
      componentPart("bench", "transform"),
      componentPart("table", "transform"),
    ]);
    expect(changes.map((change) => change.label)).toEqual(["bench: transform", "table: transform"]);
    const result = session.keep();
    expect(result.applied).toBe(true);
    expect(session.active).toBe(false);
    expect(writeDocument(channel.doc)).toBe(writeDocument(play));
    expect(channel.undo()).toBe(true);
    expect(channel.doc).toBe(edit);
    expect(channel.undo()).toBe(false);
    expect(channel.redo()).toBe(true);
    expect(writeDocument(channel.doc)).toBe(writeDocument(play));
  });

  it("keeps only the chosen part (the transform of one entity)", () => {
    const { channel, session } = setup();
    const edit = channel.doc;
    session.enter();
    channel.edit(set(TABLE, [2, 0, 0]), "Move the table");
    channel.edit(set(BENCH, [0, 0, 3]), "Move the bench");
    expect(session.keep([componentPart("table", "transform")]).applied).toBe(true);
    expect(channel.doc.entities.table?.components.transform).toEqual({ position: [2, 0, 0] });
    expect(channel.doc.entities.bench?.components.transform).toEqual(edit.entities.bench?.components.transform);
    expect(channel.undo()).toBe(true);
    expect(channel.doc).toBe(edit);
  });

  it("puts back the sequence and keeps it as one part; the record mode does not apply to a kept step", () => {
    const { channel, sequence, session, recorder, time } = setup();
    const editSequence = sequence.doc;
    session.enter();
    recorder.on = true;
    time.value = 1000;
    channel.edit(set(TABLE, [1, 0, 0]), "Key the table");
    recorder.on = false;
    channel.edit(set(BENCH, [0, 0, 3]), "Move the bench");
    expect(sequence.doc.tracks).toHaveLength(1);
    const playSequence = sequence.doc;
    expect(session.changes().map((change) => change.id)).toEqual([componentPart("bench", "transform"), SEQUENCE_PART]);
    session.stop();
    expect(sequence.doc).toBe(editSequence);
    session.enter();
    recorder.on = true;
    channel.edit(set(BENCH, [0, 0, 3]), "Key the bench");
    recorder.on = false;
    channel.edit(set(SUN, 4), "Light");
    recorder.on = true;
    expect(session.keep([componentPart("sun", "light")]).applied).toBe(true);
    // The kept light value goes into the scene: no key of the record mode.
    expect(channel.doc.entities.sun?.components.light).toMatchObject({ intensity: 4 });
    expect(sequence.doc).toBe(editSequence);
    channel.undo();
    session.enter();
    recorder.on = false;
    sequence.channel.write(playSequence, sequence.doc);
    expect(session.keep([SEQUENCE_PART]).applied).toBe(true);
    expect(sequence.doc).toEqual(playSequence);
    expect(channel.undo()).toBe(true);
    expect(sequence.doc).toBe(editSequence);
  });

  it("refuses a second enter and an enter during a live drag; stop cancels a live drag", () => {
    const { channel, session } = setup();
    const edit = channel.doc;
    channel.begin();
    expect(() => session.enter()).toThrow(EditError);
    channel.end(true);
    session.enter();
    expect(() => session.enter()).toThrow(EditError);
    channel.begin();
    channel.move(set(TABLE, [3, 0, 0]));
    session.stop();
    expect(channel.live).toBe(false);
    expect(channel.doc).toBe(edit);
    expect(() => session.keep()).toThrow(EditError);
  });

  it("gives no step for a keep with no change", () => {
    const { channel, session } = setup();
    session.enter();
    expect(session.changes()).toEqual([]);
    expect(session.keep().applied).toBe(false);
    expect(channel.history.canUndo).toBe(false);
  });
});
