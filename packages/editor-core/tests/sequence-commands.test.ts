// SPDX-License-Identifier: Apache-2.0
// The commands of the sequencer on the generic garden scene: add, move and delete keys, add and remove tracks, add
// and move markers. Each command is one step of the one history. An undo returns the same bytes. A refused command
// changes nothing.
import { describe, expect, it } from "bun:test";
import { builtinRegistry, readDocument, writeDocument } from "@scenity/scene";
import { sampleTrack } from "@scenity/scene/sequence";
import { CommandError, applySequenceChange, EditError, trackGroups } from "../src/index";
import { emptySequence, sequenceEditor } from "./sequenceFixture";

/** The error of a command run that must fail. */
async function failure(run: Promise<unknown>): Promise<Error> {
  try {
    await run;
  } catch (error) {
    return error as Error;
  }
  throw new Error("The command did not fail.");
}

/** Run a command, check its one step, undo it to the same bytes, and redo it. */
async function stepAndUndo(editor: ReturnType<typeof sequenceEditor>, id: string, args: Record<string, unknown>) {
  const before = writeDocument(editor.sequence.doc);
  const steps = editor.channel.history.steps().steps.length;
  const run = await editor.run(id, args);
  expect(run).toMatchObject({ outcome: "applied", step: true });
  expect(editor.channel.history.steps().steps.length).toBe(steps + 1);
  const after = writeDocument(editor.sequence.doc);
  expect(after).not.toBe(before);
  expect(editor.channel.undo()).toBe(true);
  expect(writeDocument(editor.sequence.doc)).toBe(before);
  expect(editor.channel.redo()).toBe(true);
  expect(writeDocument(editor.sequence.doc)).toBe(after);
  return run;
}

describe("the sequence commands", () => {
  it("adds a track and keys with the value of the frame or a given value, each as one undo step", async () => {
    const editor = sequenceEditor();
    await stepAndUndo(editor, "sequence.track.add", { kind: "transform", entity: "table" });
    expect(editor.sequence.doc.tracks).toEqual([{ kind: "transform", entity: "table", keys: [] }]);
    const added = await stepAndUndo(editor, "sequence.key.add", { track: 0 });
    expect(added.title).toBe("Add a transform key at 0 ms");
    expect(editor.sequence.doc.tracks[0]?.keys).toEqual([
      { t: 0, position: [0, 0, 0], rotation: [0, 0, 0, 1], scale: [1, 1, 1] },
    ]);
    await stepAndUndo(editor, "sequence.key.add", { track: 0, t: 2000, value: '{"position":[2,0,0]}' });
    const track = editor.sequence.doc.tracks[0];
    if (track === undefined) throw new Error("no track");
    expect(track.keys.map((key) => key.t)).toEqual([0, 2000]);
    expect(sampleTrack(track, 1000)).toMatchObject({ position: [1, 0, 0] });
    // The page sends each change of the sequence to the runtime.
    expect(editor.runtime.sequences.at(-1)).toBe(editor.sequence.doc);
  });

  it("moves, changes and deletes keys, and keeps the keys in time order", async () => {
    const editor = sequenceEditor();
    await editor.run("sequence.track.add", { kind: "property", entity: "lamp", path: "light/intensity" });
    await editor.run("sequence.key.add", { track: 0, t: 500 });
    await editor.run("sequence.key.add", { track: 0, t: 1500, value: "4" });
    expect(editor.sequence.doc.tracks[0]?.keys).toEqual([
      { t: 500, value: 2 },
      { t: 1500, value: 4 },
    ]);
    await stepAndUndo(editor, "sequence.key.move", { track: 0, key: 0, t: 3000 });
    expect(editor.sequence.doc.tracks[0]?.keys).toEqual([
      { t: 1500, value: 4 },
      { t: 3000, value: 2 },
    ]);
    await stepAndUndo(editor, "sequence.key.value", { track: 0, key: 1, value: "3.5", ease: "inOut" });
    expect(editor.sequence.doc.tracks[0]?.keys[1]).toEqual({ t: 3000, value: 3.5, ease: "inOut" });
    await stepAndUndo(editor, "sequence.key.delete", { track: 0, key: 0 });
    expect(editor.sequence.doc.tracks[0]?.keys).toEqual([{ t: 3000, value: 3.5, ease: "inOut" }]);
    await stepAndUndo(editor, "sequence.track.remove", { track: 0 });
    expect(editor.sequence.doc.tracks).toEqual([]);
  });

  it("adds, moves and removes markers", async () => {
    const editor = sequenceEditor();
    editor.time.value = 1250;
    await stepAndUndo(editor, "sequence.marker.add", { name: "door-open" });
    expect(editor.sequence.doc.markers).toEqual({ "door-open": 1250 });
    await stepAndUndo(editor, "sequence.marker.move", { name: "door-open", t: 3000 });
    expect(editor.sequence.doc.markers).toEqual({ "door-open": 3000 });
    await stepAndUndo(editor, "sequence.marker.remove", { name: "door-open" });
    expect(editor.sequence.doc.markers).toBeUndefined();
  });

  it("refuses a bad command and changes nothing", async () => {
    const editor = sequenceEditor();
    const before = writeDocument(editor.sequence.doc);
    expect(await failure(editor.run("sequence.track.add", { kind: "transform", entity: "nobody" }))).toBeInstanceOf(
      CommandError,
    );
    expect(await failure(editor.run("sequence.key.add", { track: 3 }))).toBeInstanceOf(CommandError);
    expect(await failure(editor.run("sequence.marker.add", { name: "late", t: 9000 }))).toBeInstanceOf(CommandError);
    await editor.run("sequence.track.add", { kind: "transform", entity: "table" });
    expect(await failure(editor.run("sequence.track.add", { kind: "transform", entity: "table" }))).toBeInstanceOf(
      CommandError,
    );
    expect(() =>
      applySequenceChange(editor.sequence.doc, { type: "putKey", track: 0, key: { t: 5, position: [1, 2] } as never }),
    ).toThrow(EditError);
    editor.channel.undo();
    expect(writeDocument(editor.sequence.doc)).toBe(before);
  });

  it("gives the track groups by entity and a document that reads", async () => {
    const editor = sequenceEditor(emptySequence(6000));
    await editor.run("sequence.track.add", { kind: "transform", entity: "table" });
    await editor.run("sequence.track.add", { kind: "camera" });
    await editor.run("sequence.track.add", { kind: "visibility", entity: "table" });
    await editor.run("sequence.key.add", { track: 2, t: 100 });
    expect(trackGroups(editor.sequence.doc, editor.channel.doc)).toEqual([
      { entity: "table", label: "Table", tracks: [0, 2] },
      { entity: null, label: "Sequence", tracks: [1] },
    ]);
    const read = readDocument(writeDocument(editor.sequence.doc), "sequence", { registry: builtinRegistry() });
    expect(read.ok).toBe(true);
  });

  it("sets the duration, the loop and the initial state as one undo step each", async () => {
    const editor = sequenceEditor();
    const duration = editor.sequence.doc.duration;
    await stepAndUndo(editor, "sequence.settings", { duration: duration + 1000 });
    expect(editor.sequence.doc.duration).toBe(duration + 1000);
    await stepAndUndo(editor, "sequence.settings", { loop: true });
    expect(editor.sequence.doc.loop).toBe(true);
    await stepAndUndo(editor, "sequence.settings", { loop: false });
    expect(editor.sequence.doc.loop).toBeUndefined();
    await stepAndUndo(editor, "sequence.settings", { initial: '{"traffic":{"phase":"green"}}' });
    expect(editor.sequence.doc.initial).toEqual({ traffic: { phase: "green" } });
    await stepAndUndo(editor, "sequence.settings", { initial: "null" });
    expect(editor.sequence.doc.initial).toBeUndefined();
    expect((await failure(editor.run("sequence.settings", { loop: false }))).message).toContain("the same");
    expect((await failure(editor.run("sequence.settings", { initial: "[1]" }))).message).toContain("an object");
    // A duration before a key is a refusal of the schema.
    await editor.run("sequence.track.add", { kind: "visibility", entity: "table" });
    await editor.run("sequence.key.add", { track: 0, t: duration });
    expect((await failure(editor.run("sequence.settings", { duration: 10 }))).message).toContain("after the duration");
  });

  it("sets the rules of the sequence as one undo step", async () => {
    const editor = sequenceEditor();
    const rule = {
      id: "tableHigh",
      metric: "distance",
      args: { from: "table", to: "floor" },
      min: 0.5,
      level: "warn" as const,
    };
    await stepAndUndo(editor, "sequence.rules", { rules: JSON.stringify([rule]) });
    expect(editor.sequence.doc.rules).toEqual([rule]);
    expect((await failure(editor.run("sequence.rules", { rules: JSON.stringify([rule]) }))).message).toContain(
      "the same",
    );
    expect((await failure(editor.run("sequence.rules", { rules: "{" }))).message).toContain("not JSON");
    expect((await failure(editor.run("sequence.rules", { rules: '[{"id":"x"}]' }))).message).toContain("not valid");
    await stepAndUndo(editor, "sequence.rules", { rules: "[]" });
    expect(editor.sequence.doc.rules).toBeUndefined();
  });

  it("adds a track with its keys in one step (a camera move of an agent)", async () => {
    const editor = sequenceEditor();
    const keys = [
      { t: 1000, position: [0, 2, 4] },
      { t: 0, position: [0, 1, 5] },
    ];
    await stepAndUndo(editor, "sequence.track.add", { kind: "transform", entity: "table", keys: JSON.stringify(keys) });
    expect(editor.sequence.doc.tracks[0]?.keys.map((key) => key.t)).toEqual([0, 1000]);
    expect(
      (await failure(editor.run("sequence.track.add", { kind: "visibility", entity: "table", keys: "{}" }))).message,
    ).toContain("a JSON list");
  });
});
