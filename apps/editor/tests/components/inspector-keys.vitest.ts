// SPDX-License-Identifier: Apache-2.0
// The keys of the inspector: the track that drives a field (a property track, or a part of the transform track), and
// the key mark of the field at a time.
import type { SequenceDocument } from "@scenity/scene/sequence";
import { describe, expect, it } from "vitest";
import { fieldTrack, keyMark } from "../../src/scene/sequencer/sequenceKeys";

const SEQUENCE = {
  format: "scenity.sequence/1",
  id: "s",
  scene: "room",
  duration: 4000,
  tracks: [
    { kind: "property", entity: "sun", path: "light/intensity", keys: [{ t: 0, value: 2 }] },
    { kind: "transform", entity: "box", keys: [{ t: 1000, position: [1, 0, 0] }] },
  ],
} as unknown as SequenceDocument;

describe("the keys of the inspector", () => {
  it("names the track of a field", () => {
    expect(fieldTrack("sun", "light", ["intensity"])).toEqual({
      kind: "property",
      entity: "sun",
      path: "light/intensity",
    });
    expect(fieldTrack("sun", "light", ["colour", 0])).toEqual({
      kind: "property",
      entity: "sun",
      path: "light/colour/0",
    });
    expect(fieldTrack("box", "transform", ["position"])).toEqual({ kind: "transform", entity: "box" });
    expect(fieldTrack("box", "transform", ["position", 0])).toBeNull();
    expect(fieldTrack("box", "light", [])).toBeNull();
  });

  it("marks a field with no track, a track, or a key at the time", () => {
    expect(keyMark(SEQUENCE, "sun", "light", ["intensity"], 0)).toBe("key");
    expect(keyMark(SEQUENCE, "sun", "light", ["intensity"], 500)).toBe("track");
    expect(keyMark(SEQUENCE, "sun", "light", ["range"], 0)).toBe("none");
    expect(keyMark(SEQUENCE, "box", "transform", ["position"], 1000)).toBe("key");
    // The transform key at 1000 ms holds no rotation.
    expect(keyMark(SEQUENCE, "box", "transform", ["rotation"], 1000)).toBe("track");
  });
});
