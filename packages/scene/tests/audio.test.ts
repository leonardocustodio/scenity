// SPDX-License-Identifier: Apache-2.0
// The sounds of a sequence: which sounds play at a time and at which position, with a seek that gives the sound of a
// play. The scene is a workshop with a bell and a radio (the neutral test plugin).
import { describe, expect, test } from "bun:test";
import {
  audibleAt,
  createEvaluator,
  readDocument,
  sampleTrack,
  soundCues,
  soundPosition,
  type SceneDocument,
  type SequenceDocument,
} from "../src/index";
import { deepFreeze, registry } from "./helpers";

const BELL = "asset:01J9Z6Q3RB";
const CHIME = "asset:01J9Z6Q3RC";
const RADIO = "asset:01J9Z6Q3RD";
/** The durations of the sounds in ms: the player reads them from the decoded files. */
const DURATIONS: Readonly<Record<string, number>> = { [BELL]: 400, [CHIME]: 1500, [RADIO]: 2000 };
const durationOf = (asset: string) => DURATIONS[asset];

const scene: SceneDocument = deepFreeze({
  format: "scenity.scene/1",
  id: "workshop",
  entities: {
    bell: {
      parent: null,
      index: 0,
      components: { transform: { position: [1, 2, 0] }, audioSource: { asset: BELL, refDistance: 2 } },
    },
    radio: {
      parent: null,
      index: 1,
      components: { audioSource: { asset: RADIO, autoplay: true, loop: true, spatial: false, volume: 0.5 } },
    },
  },
});

const sequence: SequenceDocument = deepFreeze({
  format: "scenity.sequence/1",
  id: "shift",
  scene: "workshop",
  duration: 6000,
  tracks: [
    {
      kind: "audio",
      entity: "bell",
      keys: [
        { t: 1000, play: true },
        { t: 2000, play: true, sound: CHIME, offset: 500 },
        { t: 2600, play: false },
        { t: 4000, play: true, offset: 100 },
      ],
    },
    { kind: "audio", entity: "ghost", keys: [{ t: 0, play: true, sound: BELL }] },
  ],
});

/** The voice IDs and positions at `t`, in the stable order. */
function playing(t: number, frameScene: SceneDocument = scene): [string, string, number][] {
  return audibleAt(soundCues(frameScene, sequence, t, registry), t, durationOf).map((item) => [
    item.cue.id,
    item.cue.asset,
    item.position,
  ]);
}

describe("the audio track", () => {
  test("the document reads, and the schema refuses a key with no play field", () => {
    const text = JSON.stringify(sequence);
    expect(readDocument(text, "sequence").ok).toBe(true);
    const bad = JSON.parse(text) as { tracks: { keys: Record<string, unknown>[] }[] };
    delete bad.tracks[0]!.keys[0]!.play;
    expect(readDocument(JSON.stringify(bad), "sequence").ok).toBe(false);
  });

  test("the sample is the last play key with its start; a stop key gives no cue", () => {
    const track = sequence.tracks[0]!;
    expect(sampleTrack(track, 999)).toEqual({ kind: "audio", entity: "bell", cue: undefined });
    expect(sampleTrack(track, 1200)).toEqual({
      kind: "audio",
      entity: "bell",
      cue: { sound: undefined, key: 0, start: 1000 },
    });
    expect(sampleTrack(track, 2100)).toEqual({
      kind: "audio",
      entity: "bell",
      cue: { sound: CHIME, key: 1, start: 1500 },
    });
    expect(sampleTrack(track, 3000)).toEqual({ kind: "audio", entity: "bell", cue: undefined });
  });

  test("which sounds play at which position for a given time", () => {
    // The radio plays from t = 0 with a loop. The track of an entity that the scene does not hold plays nothing.
    expect(playing(0)).toEqual([["auto:radio", RADIO, 0]]);
    expect(playing(1000)).toEqual([
      ["track:0:0", BELL, 0],
      ["auto:radio", RADIO, 1000],
    ]);
    expect(playing(1250)).toEqual([
      ["track:0:0", BELL, 250],
      ["auto:radio", RADIO, 1250],
    ]);
    // The bell is 400 ms long: at 1400 ms, it is at its end. The radio loops at 2000 ms.
    expect(playing(1400)).toEqual([["auto:radio", RADIO, 1400]]);
    // The second key plays the chime from 500 ms into it. The stop key at 2600 ms stops it.
    expect(playing(2000)).toEqual([
      ["track:0:1", CHIME, 500],
      ["auto:radio", RADIO, 0],
    ]);
    expect(playing(2599)[0]).toEqual(["track:0:1", CHIME, 1099]);
    expect(playing(2600)).toEqual([["auto:radio", RADIO, 600]]);
    // The last key plays the bell from 100 ms. It stops 300 ms later.
    expect(playing(4000)[0]).toEqual(["track:0:3", BELL, 100]);
    expect(playing(4299)[0]).toEqual(["track:0:3", BELL, 399]);
    expect(playing(4300)).toEqual([["auto:radio", RADIO, 300]]);
  });

  test("the cue carries the component values with the defaults", () => {
    const [bell, radio] = soundCues(scene, sequence, 1000, registry);
    expect(bell?.source).toMatchObject({ asset: BELL, refDistance: 2, spatial: true, volume: 1, loop: false });
    expect(radio?.source).toMatchObject({ spatial: false, volume: 0.5, loop: true, autoplay: true });
    // With no sequence, only the autoplay sounds play, from the start of the scene.
    expect(soundCues(scene, null, 0, registry).map((cue) => [cue.id, cue.start])).toEqual([["auto:radio", 0]]);
  });

  test("the position: before the start and after the end there is no sound; a loop wraps", () => {
    expect(soundPosition(-1, 400, false)).toBeNull();
    expect(soundPosition(399, 400, false)).toBe(399);
    expect(soundPosition(400, 400, false)).toBeNull();
    expect(soundPosition(900, 400, true)).toBe(100);
    expect(soundPosition(900, undefined, false)).toBe(900);
  });

  test("seek equals play: the sounds at each time of a play are the sounds of a seek to that time", () => {
    const evaluator = createEvaluator({ scene, sequence, registry });
    const played = new Map<number, ReturnType<typeof playing>>();
    for (let t = 0; t <= sequence.duration; t += 16) played.set(t, playing(t, evaluator.at(t, t - 16).scene));
    const seeks = [...played.keys()].sort((a, b) => ((a * 7919) % 6007) - ((b * 7919) % 6007));
    const fresh = createEvaluator({ scene, sequence, registry });
    for (const t of seeks) expect(playing(t, fresh.at(t).scene)).toEqual(played.get(t)!);
  });

  test("a property track changes the values of a source at its time", () => {
    const louder: SequenceDocument = {
      ...sequence,
      tracks: [
        ...sequence.tracks,
        { kind: "property", entity: "bell", path: "audioSource/volume", keys: [{ t: 0, value: 0.2 }] },
      ],
    };
    const frame = createEvaluator({ scene, sequence: louder, registry }).at(1000);
    expect(soundCues(frame.scene, louder, 1000, registry)[0]?.source.volume).toBe(0.2);
  });
});
