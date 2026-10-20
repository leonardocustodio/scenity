// SPDX-License-Identifier: Apache-2.0
/**
 * The audio part of protocol 2: the "audio" message from the core to the page. A render worker cannot play a sound.
 * Thus the core tells the page which sounds play, where they are and where the listener is. The page plays them with
 * Web Audio (audio/player.ts). protocol.ts has the message and re-exports these types. This module has only types.
 *
 * The core sends a frame only when a value changes: the voices, their places, the listener or the assets. A voice
 * has the time of its start on the time line, not a position in the sound, so the page computes the position from its
 * own clock. Thus a frame stays true while the clock runs, and a seek needs no new frame.
 */

/** A point or a direction in world space, in metres. */
export type AudioVector = readonly [number, number, number];

/** A sound that plays (`soundCues` of `@scenity/scene/sequence`) with the world place of its entity. */
export interface AudioVoice {
  /** The ID of the voice: `track:<track index>:<key index>` or `auto:<entity>`. */
  readonly id: string;
  readonly entity: string;
  /** The `audio` asset (`asset:<id>`). */
  readonly asset: string;
  /** The time on the time line in ms where the position in the sound is 0 (it can be below 0). */
  readonly start: number;
  readonly volume: number;
  readonly loop: boolean;
  /** True: the sound comes from `position`. False: the sound has no place. */
  readonly spatial: boolean;
  readonly refDistance: number;
  readonly rolloff: number;
  readonly maxDistance: number;
  readonly distanceModel: "linear" | "inverse" | "exponential";
  /** The world place of the entity. */
  readonly position: AudioVector;
}

/** The listener: the world place of the camera and its forward and up directions. */
export interface AudioListenerPose {
  readonly position: AudioVector;
  readonly forward: AudioVector;
  readonly up: AudioVector;
}

/** The sounds of a frame. */
export interface AudioFrame {
  /** The count of the frames that the core sent. */
  readonly seq: number;
  /** The time of the frame on the time line in ms, or null for a scene with no sequence. */
  readonly t: number | null;
  readonly voices: readonly AudioVoice[];
  readonly listener: AudioListenerPose;
  /** The audio assets of the scene and of its sequence, in sorted order: the page loads them before a play. */
  readonly assets: readonly string[];
}
