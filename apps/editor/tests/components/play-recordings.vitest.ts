// SPDX-License-Identifier: Apache-2.0
// The hints and the saved recordings of the play mode: the keys of the game from the input maps of the plugins, and the
// recordings of a project in the browser storage. A save with the same name replaces the old recording. A value that
// does not read gives no recording.
import type { InputRecording } from "@scenity/scene/sequence";
import { describe, expect, it } from "vitest";
import {
  inputHints,
  keyLabel,
  readRecordings,
  recordingsKey,
  withRecording,
  writeRecordings,
} from "../../src/scene/play/playRecordings";

const RECORDING: InputRecording = { format: "scenity.input/1", id: "play-1", scene: "spin", events: [] };

describe("the hints of the play mode", () => {
  it("lists each action with its keys and its pointer press", () => {
    expect(["ArrowUp", "KeyW", "Digit1", "Space"].map(keyLabel)).toEqual(["↑", "W", "1", "Space"]);
    const hints = inputHints([
      { keys: { "demo.faster": ["ArrowUp", "KeyW"], "demo.slower": ["ArrowDown"] } },
      { pointer: { "demo.toggle": { component: "shape" } }, keys: { "demo.faster": ["ArrowUp"] } },
    ]);
    expect(hints).toEqual([
      { action: "demo.faster", keys: ["↑", "W"], pointer: null },
      { action: "demo.slower", keys: ["↓"], pointer: null },
      { action: "demo.toggle", keys: [], pointer: { component: "shape" } },
    ]);
  });
});

describe("the saved recordings of a project", () => {
  it("keeps them by name, the newest first, and skips a value that does not read", () => {
    const items = new Map<string, string>();
    const storage = {
      getItem: (key: string) => items.get(key) ?? null,
      setItem: (key: string, value: string) => void items.set(key, value),
    };
    let list = withRecording([], "First", RECORDING, 1);
    list = withRecording(list, "Second", RECORDING, 2);
    list = withRecording(list, "First", RECORDING, 3);
    expect(list.map((item) => [item.name, item.savedAt])).toEqual([
      ["First", 3],
      ["Second", 2],
    ]);
    expect(writeRecordings(storage, "spin", list)).toBe(true);
    expect(readRecordings(storage, "spin")).toEqual(list);
    expect(readRecordings(storage, "other")).toEqual([]);
    items.set(
      recordingsKey("spin"),
      JSON.stringify([{ name: "Bad", savedAt: 1, recording: { format: "x" } }, ...list]),
    );
    expect(readRecordings(storage, "spin").map((item) => item.name)).toEqual(["First", "Second"]);
    expect(readRecordings(null, "spin")).toEqual([]);
  });
});
