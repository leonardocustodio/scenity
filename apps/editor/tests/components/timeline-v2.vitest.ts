// SPDX-License-Identifier: Apache-2.0
// The Timeline v2: the zoom, the pan and the snaps of the time line, and the first value of a new key of each track
// kind. Also the segments and the peaks of the waveform of an audio track.
import type { EntityDocument } from "@scenity/scene";
import type { SequenceDocument, Track } from "@scenity/scene/sequence";
import { describe, expect, it } from "vitest";
import { actionNames, cameraRefs, firstKeyFields, keyFields, sequenceKind } from "../../src/scene/sequencer/keyForms";
import {
  fullWindow,
  MIN_SPAN,
  panWindow,
  snapTime,
  windowShare,
  windowTicks,
  windowTimeAt,
  zoomWindow,
} from "../../src/scene/sequencer/timeWindow";
import { peakBuckets, soundSegments } from "../../src/scene/sequencer/waveform";

const SCENE = {
  format: "scenity.scene/1",
  id: "room",
  entities: {
    door: { parent: null, index: 0, components: { audioSource: { asset: "asset:01CREAK" } } },
    eye: { parent: null, index: 1, components: { camera: { fov: 50 } } },
  },
} as unknown as EntityDocument;

describe("the time window of the Timeline", () => {
  it("zooms at a time, pans inside the time line, and gives the time under a pointer", () => {
    const full = fullWindow(10_000);
    expect(full).toEqual({ from: 0, to: 10_000 });
    const closer = zoomWindow(full, 0.5, 2000, 10_000);
    expect(closer.to - closer.from).toBe(5000);
    // The time at the pointer keeps its place: 2000 ms stays at 20 % of the lane.
    expect(windowShare(2000, closer)).toBeCloseTo(20);
    expect(panWindow(closer, -9999, 10_000)).toEqual({ from: 0, to: 5000 });
    expect(panWindow(closer, 99_999, 10_000)).toEqual({ from: 5000, to: 10_000 });
    const tiny = zoomWindow(full, 0.0001, 5000, 10_000);
    expect(tiny.to - tiny.from).toBe(MIN_SPAN);
    expect(windowTimeAt(50, 100, { from: 1000, to: 3000 }, 10_000)).toBe(2000);
    expect(windowTicks({ from: 1000, to: 2000 }).every((tick) => tick >= 1000 && tick <= 2000)).toBe(true);
  });

  it("snaps a drag to a near time, else to the grid; Alt gives the exact time", () => {
    // 10 ms for each px: a time within 60 ms snaps to it.
    expect(snapTime(1530, [1500, 2000], 10, false)).toBe(1500);
    expect(snapTime(1740, [1500, 2000], 10, false)).toBe(1700);
    expect(snapTime(1740, [1500, 2000], 10, true)).toBe(1740);
  });
});

describe("the keys of each track kind", () => {
  const track = (kind: string, more: Record<string, unknown> = {}) => ({ kind, keys: [], ...more }) as unknown as Track;
  const sequence = {
    tracks: [track("action", { keys: [{ t: 0, action: "traffic.button" }] })],
  } as unknown as SequenceDocument;

  it("gives a first value to the kinds with no value of the frame", () => {
    expect(sequenceKind("camera") && sequenceKind("event") && sequenceKind("action")).toBe(true);
    expect(sequenceKind("transform")).toBe(false);
    expect(cameraRefs(SCENE)).toEqual(["entity:eye"]);
    expect(actionNames(sequence, ["demo.toggle"])).toEqual(["demo.toggle", "traffic.button"]);
    expect(firstKeyFields(track("camera"), SCENE, [])).toEqual({ camera: "entity:eye" });
    expect(firstKeyFields(track("event"), SCENE, [])).toEqual({ name: "event" });
    expect(firstKeyFields(track("action"), SCENE, ["traffic.button"])).toEqual({ action: "traffic.button" });
    expect(firstKeyFields(track("animation"), SCENE, [])).toEqual({ clip: null });
    expect(firstKeyFields(track("attach"), SCENE, [])).toEqual({ to: null });
    expect(firstKeyFields(track("transform"), SCENE, [])).toBeUndefined();
    expect(keyFields({ t: 5, ease: "in", value: 2 })).toEqual({ value: 2 });
  });
});

describe("the waveform of an audio track", () => {
  it("plays the sound of the entity from each play key to its end or to the next key", () => {
    const audio = {
      kind: "audio",
      entity: "door",
      keys: [
        { t: 0, play: true },
        { t: 3000, play: false },
        { t: 5000, play: true, sound: "asset:01BELL", offset: 500 },
      ],
    } as unknown as Track;
    const lengths: Record<string, number> = { "asset:01CREAK": 2000, "asset:01BELL": 1500 };
    expect(soundSegments(audio, SCENE, 10_000, (sound) => lengths[sound] ?? null)).toEqual([
      { sound: "asset:01CREAK", from: 0, to: 2000, offset: 0 },
      { sound: "asset:01BELL", from: 5000, to: 6000, offset: 500 },
    ]);
    // A sound of no known length plays to the next key.
    expect(soundSegments(audio, SCENE, 10_000, () => null)[0]).toMatchObject({ from: 0, to: 3000 });
    expect([...peakBuckets(new Float32Array([0.1, -0.8, 0.2, 0.4]), 2)].map((value) => Math.round(value * 10))).toEqual(
      [8, 4],
    );
  });
});
