// SPDX-License-Identifier: Apache-2.0
// Audio: the audio frames of a core (src/audio/frames.ts) and the audio player of the page
// (src/audio/player.ts) with a fake audio context. A seek starts a sound at the right position, or not at all after
// its end. A clock that stops stops each voice. Three.js runs in Bun with no renderer.
import { describe, expect, test } from "bun:test";
import { PerspectiveCamera } from "three";
import type { SceneDocument, SequenceDocument } from "@scenity/scene";
import { AudioFrames, audioAssets } from "../src/audio/frames";
import { AudioPlayer, type AudioClock, type AudioContextLike } from "../src/audio/player";
import type { AudioFrame, AudioVoice } from "../src/protocol";
import { SceneBuilder } from "../src";
import { FakeAssets } from "./sceneHelpers";

const CHIRP = "asset:01J9Z6Q3RB";

const scene: SceneDocument = {
  format: "scenity.scene/1",
  id: "workshop",
  entities: {
    bell: {
      parent: null,
      index: 0,
      components: { transform: { position: [1, 2, 0] }, audioSource: { asset: CHIRP, refDistance: 2 } },
    },
    lamp: { parent: null, index: 1, components: { transform: { position: [0, 3, 0] } } },
  },
};

const sequence: SequenceDocument = {
  format: "scenity.sequence/1",
  id: "shift",
  scene: "workshop",
  duration: 5000,
  tracks: [
    {
      kind: "audio",
      entity: "bell",
      keys: [
        { t: 1000, play: true },
        { t: 3000, play: true, offset: 200 },
      ],
    },
    { kind: "transform", entity: "bell", keys: [{ t: 0, position: [1, 2, 0] }] },
  ],
};

describe("the audio frames of a core", () => {
  const camera = new PerspectiveCamera();
  camera.position.set(0, 1.5, 4);

  test("a scene with no sound gives no frame", () => {
    const builder = new SceneBuilder({ assets: new FakeAssets() });
    builder.build({ ...scene, entities: { lamp: scene.entities.lamp! } });
    expect(new AudioFrames().next(builder, null, null, camera)).toBeNull();
  });

  test("a frame has the voices with the world place of their entity, and only a change sends a new frame", () => {
    const builder = new SceneBuilder({ assets: new FakeAssets() });
    builder.build(scene);
    builder.root.updateMatrixWorld(true);
    const frames = new AudioFrames();
    const first = frames.next(builder, sequence, 0, camera);
    expect(first).toMatchObject({ seq: 1, t: 0, voices: [], assets: [CHIRP] });
    expect(frames.next(builder, sequence, 500, camera)).toBeNull();
    const playing = frames.next(builder, sequence, 1000, camera);
    expect(playing?.voices).toEqual([
      {
        id: "track:0:0",
        entity: "bell",
        asset: CHIRP,
        start: 1000,
        volume: 1,
        loop: false,
        spatial: true,
        refDistance: 2,
        rolloff: 1,
        maxDistance: 10000,
        distanceModel: "inverse",
        position: [1, 2, 0],
      },
    ]);
    expect(playing?.listener).toEqual({ position: [0, 1.5, 4], forward: [0, 0, -1], up: [0, 1, 0] });
    // The time continues, but the start of the voice stays: no new frame.
    expect(frames.next(builder, sequence, 1300, camera)).toBeNull();
    expect(frames.next(builder, sequence, 3000, camera)?.voices[0]).toMatchObject({ id: "track:0:1", start: 2800 });
  });

  test("the assets of a scene and a sequence", () => {
    const other = "asset:01J9Z6Q3RC";
    const withSound: SequenceDocument = {
      ...sequence,
      tracks: [{ kind: "audio", entity: "lamp", keys: [{ t: 0, play: true, sound: other }] }],
    };
    expect(audioAssets(scene, withSound)).toEqual([CHIRP, other]);
  });
});

/** A fake audio context: the test sets the time, and each source keeps its start and stop. */
class FakeContext {
  currentTime = 0;
  state = "running";
  readonly sources: FakeSource[] = [];
  readonly destination = node();
  readonly listener = {
    positionX: { value: 0 },
    positionY: { value: 0 },
    positionZ: { value: 0 },
    forwardX: { value: 0 },
    forwardY: { value: 0 },
    forwardZ: { value: 0 },
    upX: { value: 0 },
    upY: { value: 0 },
    upZ: { value: 0 },
  };
  createBufferSource(): FakeSource {
    const source = new FakeSource();
    this.sources.push(source);
    return source;
  }
  createGain() {
    return { ...node(), gain: { value: 1 } };
  }
  createPanner() {
    return {
      ...node(),
      panningModel: "equalpower",
      distanceModel: "inverse",
      refDistance: 1,
      rolloffFactor: 1,
      maxDistance: 10000,
      positionX: { value: 0 },
      positionY: { value: 0 },
      positionZ: { value: 0 },
    };
  }
  decodeAudioData(bytes: ArrayBuffer): Promise<AudioBuffer> {
    // The fake file holds its duration in seconds as one number.
    return Promise.resolve({ duration: new Float64Array(bytes)[0] } as AudioBuffer);
  }
  resume(): Promise<void> {
    this.state = "running";
    return Promise.resolve();
  }
  close(): Promise<void> {
    return Promise.resolve();
  }
}

function node() {
  return { connect: () => undefined, disconnect: () => undefined };
}

class FakeSource {
  buffer: AudioBuffer | null = null;
  loop = false;
  onended: (() => void) | null = null;
  started: [number, number] | null = null;
  stopped = false;
  connect = () => undefined;
  disconnect = () => undefined;
  start(when: number, offset: number): void {
    this.started = [when, offset];
  }
  stop(): void {
    this.stopped = true;
  }
}

function voice(id: string, start: number, extra: Partial<AudioVoice> = {}): AudioVoice {
  const base = { id, entity: "bell", asset: CHIRP, start, volume: 1, loop: false, spatial: true };
  const spatial = { refDistance: 1, rolloff: 1, maxDistance: 10000, distanceModel: "inverse", position: [1, 2, 0] };
  return { ...base, ...spatial, ...extra } as AudioVoice;
}

function frameOf(voices: AudioVoice[], seq = 1): AudioFrame {
  const listener = { position: [0, 1.5, 4], forward: [0, 0, -1], up: [0, 1, 0] } as const;
  return { seq, t: 0, voices, listener, assets: [CHIRP] };
}

/** A player over a fake context with a 400 ms sound and a clock that the test sets. */
async function setup() {
  const context = new FakeContext();
  const clock: { -readonly [K in keyof AudioClock]: AudioClock[K] } = { t: 0, playing: true };
  const player = new AudioPlayer({
    clock: () => clock,
    fetch: () => Promise.resolve(new Float64Array([0.4]).buffer),
    context: () => context as unknown as AudioContextLike,
  });
  player.frame(frameOf([]));
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return { context, clock, player };
}

describe("the audio player of the page", () => {
  test("a voice starts at its position on the clock; the listener follows the frame", async () => {
    const { context, clock, player } = await setup();
    clock.t = 1000;
    player.frame(frameOf([voice("track:0:0", 1000)]));
    expect(player.started).toEqual([{ id: "track:0:0", entity: "bell", asset: CHIRP, t: 1000, position: 0 }]);
    expect(context.sources[0]?.started).toEqual([0, 0]);
    expect(context.listener.positionZ.value).toBe(4);
    expect(player.playing).toEqual(["track:0:0"]);
  });

  test("a seek in the sound starts it at the right position; a seek after its end starts nothing", async () => {
    const { context, clock, player } = await setup();
    player.frame(frameOf([voice("track:0:0", 1000)]));
    clock.t = 1250;
    player.sync();
    expect(player.started.at(-1)).toMatchObject({ t: 1250, position: 250 });
    expect(context.sources[0]?.started).toEqual([0, 0.25]);
    clock.t = 1500;
    player.sync();
    expect(player.playing).toEqual([]);
    expect(context.sources[0]?.stopped).toBe(true);
    expect(player.started).toHaveLength(1);
  });

  test("a voice in time stays; a drift over the tolerance starts it again", async () => {
    const { context, clock, player } = await setup();
    clock.t = 1000;
    player.frame(frameOf([voice("track:0:0", 1000)]));
    context.currentTime = 0.1;
    clock.t = 1100;
    player.sync();
    expect(player.started).toHaveLength(1);
    clock.t = 1300;
    player.sync();
    expect(player.started).toHaveLength(2);
    expect(player.started.at(-1)).toMatchObject({ position: 300 });
  });

  test("a clock that stops stops each voice; a context that does not run plays nothing", async () => {
    const { context, clock, player } = await setup();
    clock.t = 1100;
    player.frame(frameOf([voice("track:0:0", 1000)]));
    clock.playing = false;
    player.sync();
    expect(player.playing).toEqual([]);
    context.state = "suspended";
    clock.playing = true;
    player.sync();
    expect(player.playing).toEqual([]);
    await player.resume();
    expect(player.playing).toEqual(["track:0:0"]);
  });

  test("a loop wraps; with no sequence a voice plays once from its start", async () => {
    const { clock, player } = await setup();
    clock.t = 1900;
    player.frame(frameOf([voice("loop", 1000, { loop: true })]));
    expect(player.started.at(-1)).toMatchObject({ position: 100 });
    clock.t = null;
    player.frame(frameOf([voice("auto:bell", 0)], 2));
    expect(player.started.at(-1)).toMatchObject({ id: "auto:bell", t: null, position: 0 });
  });
});
