// SPDX-License-Identifier: Apache-2.0
// The record mode of the sequencer on the generic garden scene. While the mode is on, an edit of a value that a track
// can key writes a key at the time of the clock. That edit does not change the base scene. An edit of another value
// changes the base scene. A live drag shows its keys at once, and its end is one step.
import { describe, expect, it } from "bun:test";
import { writeDocument, type SceneOp } from "@scenity/scene";
import { sampleTrack, type SequenceDocument } from "@scenity/scene/sequence";
import { sequenceEditor } from "./sequenceFixture";

const TABLE = "/entities/table/components/transform/position";

function moveTable(x: number): SceneOp[] {
  return [{ op: "set", path: TABLE, value: [x, 0, 0] }];
}

function close(a: readonly number[] | undefined, b: readonly number[]): void {
  expect(a?.length).toBe(b.length);
  b.forEach((value, index) => expect(a?.[index] ?? Number.NaN).toBeCloseTo(value, 6));
}

function trackKeys(doc: SequenceDocument, index = 0) {
  return doc.tracks[index]?.keys ?? [];
}

describe("the record mode", () => {
  it("changes the base scene while it is off", () => {
    const editor = sequenceEditor();
    editor.channel.edit(moveTable(1), "Move the table");
    expect(editor.channel.doc.entities.table?.components.transform).toEqual({ position: [1, 0, 0] });
    expect(editor.sequence.doc.tracks).toEqual([]);
  });

  it("keys a transform at two times; the frame between them is the mix, and each key is one undo step", () => {
    const editor = sequenceEditor();
    const base = writeDocument(editor.channel.doc);
    editor.recorder.on = true;
    editor.channel.edit(moveTable(1), "Move the table");
    expect(writeDocument(editor.channel.doc)).toBe(base);
    expect(editor.sequence.doc.tracks).toEqual([
      { kind: "transform", entity: "table", keys: [{ t: 0, position: [1, 0, 0] }] },
    ]);
    // At 2000 ms the edit moves the table by 2 m from the base place: the key adds that change to the frame value.
    editor.time.value = 2000;
    editor.channel.edit(moveTable(2), "Move the table");
    expect(trackKeys(editor.sequence.doc).map((key) => key.t)).toEqual([0, 2000]);
    const track = editor.sequence.doc.tracks[0];
    if (track?.kind !== "transform") throw new Error("no transform track");
    close(track.keys[1]?.position, [3, 0, 0]);
    const middle = sampleTrack(track, 1000);
    close(middle.kind === "transform" ? middle.position : undefined, [2, 0, 0]);
    expect(writeDocument(editor.channel.doc)).toBe(base);
    expect(editor.channel.undo()).toBe(true);
    expect(trackKeys(editor.sequence.doc)).toEqual([{ t: 0, position: [1, 0, 0] }]);
    expect(editor.channel.undo()).toBe(true);
    expect(editor.sequence.doc.tracks).toEqual([]);
  });

  it("keys a live drag at its end as one step, shows the keys during the drag, and a cancel keys nothing", () => {
    const editor = sequenceEditor();
    editor.recorder.on = true;
    editor.time.value = 500;
    const base = editor.channel.doc;
    editor.channel.begin();
    editor.channel.move(moveTable(0.5));
    editor.channel.move(moveTable(1.5));
    // The runtime shows the key of the drag before the end of the drag.
    expect(trackKeys(editor.runtime.sequences.at(-1)!)).toEqual([{ t: 500, position: [1.5, 0, 0] }]);
    const steps = editor.channel.history.steps().steps.length;
    editor.channel.end();
    expect(editor.channel.doc).toEqual(base);
    expect(trackKeys(editor.sequence.doc)).toEqual([{ t: 500, position: [1.5, 0, 0] }]);
    expect(editor.channel.history.steps().steps.length).toBe(steps + 1);
    editor.time.value = 1000;
    editor.channel.begin();
    editor.channel.move(moveTable(4));
    editor.channel.end(true);
    expect(editor.channel.doc).toEqual(base);
    expect(trackKeys(editor.sequence.doc)).toEqual([{ t: 500, position: [1.5, 0, 0] }]);
  });

  it("keys a property and a turn, and an edit of another value changes the base scene", () => {
    const editor = sequenceEditor();
    editor.recorder.on = true;
    editor.time.value = 300;
    editor.channel.edit([{ op: "set", path: "/entities/lamp/components/light/intensity", value: 5 }], "Light");
    expect(editor.sequence.doc.tracks.at(-1)).toEqual({
      kind: "property",
      entity: "lamp",
      path: "light/intensity",
      keys: [{ t: 300, value: 5 }],
    });
    const turn = [0, 0.7071068, 0, 0.7071068];
    editor.channel.edit([{ op: "set", path: "/entities/bench/components/transform/rotation", value: turn }], "Turn");
    const bench = editor.sequence.doc.tracks.at(-1);
    expect(bench).toMatchObject({ kind: "transform", entity: "bench" });
    close((bench?.keys[0] as { rotation?: number[] }).rotation, turn);
    editor.channel.edit([{ op: "set", path: "/entities/table/name", value: "Desk" }], "Rename");
    expect(editor.channel.doc.entities.table?.name).toBe("Desk");
    expect(editor.sequence.doc.tracks).toHaveLength(2);
  });
});
