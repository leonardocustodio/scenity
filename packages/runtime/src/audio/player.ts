// SPDX-License-Identifier: Apache-2.0
/**
 * The audio player of a page: it plays the sounds of the audio frames of a core (the "audio" message of protocol 2)
 * with Web Audio on the main thread. A spatial voice goes through a `PannerNode` at the world place of its entity; the
 * listener is the camera of the frame.
 *
 * The position in a sound comes from the page clock: `clock.t - voice.start` (`soundPosition` of
 * `@scenity/scene/sequence`), so a seek starts a sound at the right position, or not at all after its end. A voice
 * that drifts more than the tolerance from its position starts again at the right position. A clock that stops
 * stops each voice. With no sequence (`t` null), a voice plays from its start one time, and a loop continues.
 *
 * A browser makes an audio context "suspended" until a user gesture: the page calls `resume()` in a pointer or key
 * handler. The player starts no voice while the context does not run. `started` is the debug list of the starts.
 *
 *     const player = new AudioPlayer({ clock: () => ({ t: clock.now(), playing: clock.playing }), fetch: urlOf });
 *     createDocumentClient(canvas, { ..., onAudio: (frame) => player.frame(frame) });
 */
import { soundPosition } from "@scenity/scene/sequence";
import type { AudioFrame, AudioVoice } from "../protocolAudio";
import { applyListener, makeVoiceNodes, setVoiceNodes, type AudioContextLike, type VoiceNodes } from "./nodes";

export type { AudioContextLike } from "./nodes";

/** The time of the page clock: `t` in ms (null: a scene with no sequence) and whether it runs. */
export interface AudioClock {
  readonly t: number | null;
  readonly playing: boolean;
}

export interface AudioPlayerOptions {
  readonly clock: () => AudioClock;
  /** The bytes of an `audio` asset (`asset:<id>`). */
  readonly fetch: (asset: string) => Promise<ArrayBuffer>;
  /** Make the audio context at the first need. The default: `new AudioContext()`. A test can give a fake one. */
  readonly context?: () => AudioContextLike;
  /** The largest drift of a voice from its position on the time line before a new start, in ms (default 150). */
  readonly tolerance?: number;
}

/** One start of a voice, for the debug list. */
export interface StartedSound {
  readonly id: string;
  readonly entity: string;
  readonly asset: string;
  /** The clock time of the start in ms, or null with no sequence. */
  readonly t: number | null;
  /** The position in the sound at the start in ms. */
  readonly position: number;
}

/** A voice that plays: its nodes, and the context time and the position of its start. */
interface Playing {
  readonly voice: AudioVoice;
  readonly nodes: VoiceNodes;
  readonly at: number;
  readonly position: number;
  readonly duration: number;
}

/** The longest debug list of the starts. */
const MAX_STARTED = 200;
/** The shortest rest of a sound with no loop that a start plays, in ms. */
const MIN_START_MS = 40;

export class AudioPlayer {
  readonly #options: AudioPlayerOptions;
  readonly #tolerance: number;
  #context: AudioContextLike | null = null;
  #frame: AudioFrame | null = null;
  readonly #buffers = new Map<string, AudioBuffer | null>();
  readonly #loads = new Map<string, Promise<void>>();
  readonly #playing = new Map<string, Playing>();
  /** The voices with no sequence that played to their end: they do not play again. */
  readonly #ended = new Set<string>();
  readonly #started: StartedSound[] = [];
  #disposed = false;

  constructor(options: AudioPlayerOptions) {
    this.#options = options;
    this.#tolerance = options.tolerance ?? 150;
  }

  /** The starts of the voices, oldest first (at most 200). */
  get started(): readonly StartedSound[] {
    return this.#started;
  }

  /** The IDs of the voices that play at this time, in sorted order. */
  get playing(): string[] {
    return [...this.#playing.keys()].sort();
  }

  /** The state of the audio context, or "none" before the first need. */
  get state(): string {
    return this.#context?.state ?? "none";
  }

  /** Take a new frame of the core, load its assets and play its voices. */
  frame(frame: AudioFrame): void {
    this.#frame = frame;
    for (const asset of frame.assets) this.#load(asset);
    this.sync();
  }

  /** Start the audio context after a user gesture, then play the voices. */
  async resume(): Promise<void> {
    const context = this.#contextOrNull();
    if (context === null || context.state === "running") return;
    await context.resume();
    this.sync();
  }

  /** Put the voices at the clock time: call it after each seek, play and pause of the page clock. */
  sync(): void {
    const frame = this.#frame;
    if (frame === null || this.#disposed) return;
    const clock = this.#options.clock();
    const context = this.#contextOrNull();
    if (!clock.playing || context?.state !== "running") {
      this.#stopAll();
      return;
    }
    applyListener(context, frame.listener);
    const wanted = new Set<string>();
    for (const voice of frame.voices) {
      if (this.#syncVoice(context, voice, clock.t)) wanted.add(voice.id);
    }
    for (const id of [...this.#playing.keys()]) if (!wanted.has(id)) this.#stop(id);
  }

  /** Stop each voice and close the audio context. */
  dispose(): void {
    this.#disposed = true;
    this.#stopAll();
    void this.#context?.close();
    this.#context = null;
  }

  /** Play, keep or stop one voice. True when the voice plays after the call. */
  #syncVoice(context: AudioContextLike, voice: AudioVoice, t: number | null): boolean {
    const buffer = this.#buffers.get(voice.asset);
    if (buffer === undefined) {
      this.#load(voice.asset);
      return false;
    }
    if (buffer === null) return false;
    const duration = buffer.duration * 1000;
    const current = this.#playing.get(voice.id);
    if (t === null) return this.#syncFree(context, voice, buffer, current);
    const position = soundPosition(t - voice.start, duration, voice.loop);
    if (position === null) return false;
    if (current !== undefined && this.#drift(context, current, position) <= this.#tolerance) {
      setVoiceNodes(current.nodes, voice);
      return true;
    }
    if (current !== undefined) this.#stop(voice.id);
    // A sound with almost no time left does not start: its end is near, and the start can come after it.
    if (!voice.loop && duration - position < MIN_START_MS) return false;
    this.#start(context, voice, buffer, position, t);
    return true;
  }

  /** A voice with no sequence: it plays from its start one time; a loop continues. */
  #syncFree(context: AudioContextLike, voice: AudioVoice, buffer: AudioBuffer, current: Playing | undefined): boolean {
    if (current !== undefined) {
      setVoiceNodes(current.nodes, voice);
      return true;
    }
    if (this.#ended.has(voice.id)) return false;
    this.#start(context, voice, buffer, 0, null);
    return true;
  }

  /** The distance in ms from the position of a voice that plays to the position on the time line. */
  #drift(context: AudioContextLike, current: Playing, position: number): number {
    const elapsed = (context.currentTime - current.at) * 1000;
    let actual = current.position + elapsed;
    if (current.voice.loop && current.duration > 0) actual %= current.duration;
    const distance = Math.abs(actual - position);
    return current.voice.loop ? Math.min(distance, current.duration - distance) : distance;
  }

  #start(context: AudioContextLike, voice: AudioVoice, buffer: AudioBuffer, position: number, t: number | null): void {
    const nodes = makeVoiceNodes(context, voice, buffer);
    const playing: Playing = { voice, nodes, at: context.currentTime, position, duration: buffer.duration * 1000 };
    nodes.source.onended = () => {
      if (this.#playing.get(voice.id) !== playing) return;
      this.#playing.delete(voice.id);
      if (t === null) this.#ended.add(voice.id);
    };
    nodes.source.start(0, position / 1000);
    this.#playing.set(voice.id, playing);
    this.#started.push({ id: voice.id, entity: voice.entity, asset: voice.asset, t, position });
    if (this.#started.length > MAX_STARTED) this.#started.shift();
  }

  #stop(id: string): void {
    const current = this.#playing.get(id);
    if (current === undefined) return;
    this.#playing.delete(id);
    current.nodes.source.onended = null;
    try {
      current.nodes.source.stop();
    } catch {
      // A source that ended has nothing to stop.
    }
    for (const node of current.nodes.chain) node.disconnect();
  }

  #stopAll(): void {
    for (const id of [...this.#playing.keys()]) this.#stop(id);
  }

  #contextOrNull(): AudioContextLike | null {
    if (this.#disposed) return null;
    if (this.#context === null) {
      try {
        this.#context = (this.#options.context ?? (() => new AudioContext() as unknown as AudioContextLike))();
      } catch {
        return null;
      }
    }
    return this.#context;
  }

  /** Load and decode an asset one time; a failure keeps null (no sound), with one warning. */
  #load(asset: string): void {
    if (this.#buffers.has(asset) || this.#loads.has(asset)) return;
    const context = this.#contextOrNull();
    if (context === null) return;
    const load = this.#options
      .fetch(asset)
      .then((bytes) => context.decodeAudioData(bytes))
      .then(
        (buffer) => {
          this.#buffers.set(asset, buffer);
        },
        (error: unknown) => {
          this.#buffers.set(asset, null);
          console.warn(`audio: the sound ${asset} did not load`, error);
        },
      )
      .finally(() => {
        this.#loads.delete(asset);
        this.sync();
      });
    this.#loads.set(asset, load);
  }
}
