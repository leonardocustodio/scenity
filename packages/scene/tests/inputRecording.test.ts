// SPDX-License-Identifier: Apache-2.0
// The input events of a play session and their recording. The track keeps the events in time order and gives the
// events of each step at its boundary. The recording reads and writes the same bytes. The reader refuses events out of
// order, and the JSON Schema accepts a recording. A simulation gets the events as action keys.
import { describe, expect, test } from "bun:test";
import {
  InputTrack,
  inputJsonSchema,
  inputRecording,
  NO_INPUTS,
  readInputRecording,
  withInputs,
  writeInputRecording,
  type InputEvent,
  type SequenceDocument,
} from "../src/index";
import { validate } from "./jsonSchemaSubset";

const EVENTS: readonly InputEvent[] = [
  { t: 1200, kind: "press", action: "demo.toggle", entity: "spinner", point: [-0.9, 0.9, 0.3000000004] },
  { t: 1250, kind: "release", action: "demo.toggle", entity: "spinner" },
  { t: 2000, kind: "press", action: "demo.faster" },
  { t: 2000, kind: "press", action: "demo.slower" },
  { t: 2600, kind: "release", action: "demo.faster" },
];

describe("the input track", () => {
  test("keeps the time order, and events at the same time keep their arrival order", () => {
    const track = new InputTrack();
    expect(track.add([EVENTS[2]!, EVENTS[4]!])).toBe(2000);
    expect(track.add([EVENTS[0]!, EVENTS[3]!, EVENTS[1]!])).toBe(1200);
    expect(track.events.map((event) => [event.t, event.action])).toEqual([
      [1200, "demo.toggle"],
      [1250, "demo.toggle"],
      [2000, "demo.faster"],
      [2000, "demo.slower"],
      [2600, "demo.faster"],
    ]);
    // The point goes on the number grid of the documents, so a replay gets the same value.
    expect(track.events[0]?.point).toEqual([-0.9, 0.9, 0.3]);
    expect(track.replace([])).toBe(0);
    expect(track.replace([])).toBeNull();
  });

  test("gives each step the events after the step before it, and the held actions", () => {
    const track = new InputTrack();
    track.add(EVENTS);
    expect(track.step(-1, 0).events).toEqual([]);
    expect(track.step(1183, 1200).pressed("demo.toggle")).toHaveLength(1);
    expect(track.step(1200, 1217).events).toEqual([]);
    const both = track.step(1983, 2000);
    expect(both.pressed("demo.faster")).toHaveLength(1);
    expect(both.pressed("demo.slower")).toHaveLength(1);
    expect(track.step(2583, 2600).held("demo.faster")).toBe(false);
    expect(track.step(2567, 2583).held("demo.faster")).toBe(true);
    expect(track.step(2567, 2583).held("demo.slower")).toBe(true);
    expect(track.step(1217, 1233).held("demo.toggle")).toBe(true);
    expect(track.step(1250, 1267).held("demo.toggle")).toBe(false);
    expect(new InputTrack().step(0, 17)).toBe(NO_INPUTS);
  });
});

describe("the input recording", () => {
  test("reads and writes the same bytes, and the JSON Schema accepts it", () => {
    const doc = inputRecording({ id: "play-1", scene: "spin", sequence: "spin", events: [...EVENTS].reverse() });
    expect(doc.events.map((event) => event.t)).toEqual([1200, 1250, 2000, 2000, 2600]);
    const text = writeInputRecording(doc);
    const read = readInputRecording(text);
    expect(read.ok).toBe(true);
    if (read.ok) expect(writeInputRecording(read.doc)).toBe(text);
    expect(validate(inputJsonSchema(), JSON.parse(text))).toEqual([]);
  });

  test("refuses events out of order, a bad action and an unknown field", () => {
    const doc = inputRecording({ id: "play-1", scene: "spin", events: EVENTS });
    const late = { ...doc, events: [EVENTS[2], EVENTS[0]] };
    expect(readInputRecording(late)).toEqual({
      ok: false,
      errors: [{ path: "/events/1/t", message: "the event is before the event above it" }],
    });
    const bad = { ...doc, events: [{ t: 0, kind: "press", action: "toggle" }] };
    expect(readInputRecording(bad).ok).toBe(false);
    expect(readInputRecording({ ...doc, extra: 1 }).ok).toBe(false);
    expect(validate(inputJsonSchema(), bad).length).toBeGreaterThan(0);
    expect(readInputRecording("{").ok).toBe(false);
  });

  test("gives a simulation the events as action keys of one more track", () => {
    const sequence: SequenceDocument = {
      format: "scenity.sequence/1",
      id: "spin",
      scene: "spin",
      duration: 2500,
      tracks: [],
    };
    expect(withInputs(sequence, [])).toBe(sequence);
    const merged = withInputs(sequence, EVENTS);
    expect(merged.tracks).toEqual([
      {
        kind: "action",
        keys: [
          {
            t: 1200,
            action: "demo.toggle",
            args: { kind: "press", entity: "spinner", point: [-0.9, 0.9, 0.3000000004] },
          },
          { t: 1250, action: "demo.toggle", args: { kind: "release", entity: "spinner" } },
          { t: 2000, action: "demo.faster", args: { kind: "press" } },
          { t: 2000, action: "demo.slower", args: { kind: "press" } },
        ],
      },
    ]);
  });
});
