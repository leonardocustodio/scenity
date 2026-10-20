// SPDX-License-Identifier: Apache-2.0
/**
 * The audio frames of a document core: the sounds of the frame (`soundCues` of `@scenity/scene/sequence`)
 * with the world place of each entity, and the camera as the listener. The core runs in a worker or on the main
 * thread; both give the frames to the page, which plays them (audio/player.ts). `next` gives a frame only when a
 * value changes, so a scene with no sound sends no frame.
 */
import { Quaternion, Vector3, type Camera } from "three";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { soundCues, type SequenceDocument } from "@scenity/scene/sequence";
import type { ComponentRegistry } from "@scenity/scene/components";
import type { AudioFrame, AudioListenerPose, AudioVector, AudioVoice } from "../protocolAudio";

/** The part of the scene builder that the audio frames read. */
export interface AudioScene {
  readonly registry: ComponentRegistry;
  document(): SceneDocument;
  entityObject(id: string): { getWorldPosition(target: Vector3): Vector3 } | undefined;
}

/** The grid of the places and directions of a frame: a smaller move sends no frame. */
const GRID = 1000;

function round(value: number): number {
  return Math.round(value * GRID) / GRID + 0;
}

function vector(value: Vector3): AudioVector {
  return [round(value.x), round(value.y), round(value.z)];
}

const position = new Vector3();
const direction = new Vector3();
const rotation = new Quaternion();

/** The listener pose of a camera: its world place, its -Z axis and its +Y axis. */
export function listenerOf(camera: Camera): AudioListenerPose {
  camera.updateWorldMatrix(true, false);
  camera.matrixWorld.decompose(position, rotation, direction);
  const place = vector(position);
  const forward = vector(direction.set(0, 0, -1).applyQuaternion(rotation));
  return { position: place, forward, up: vector(direction.set(0, 1, 0).applyQuaternion(rotation)) };
}

/** The audio assets of a scene and of a sequence, in sorted order. */
export function audioAssets(scene: SceneDocument, sequence: SequenceDocument | null): string[] {
  const assets = new Set<string>();
  for (const entity of Object.values(scene.entities)) {
    const source = entity.components.audioSource as { asset?: unknown } | undefined;
    if (typeof source?.asset === "string") assets.add(source.asset);
  }
  for (const track of sequence?.tracks ?? []) {
    if (track.kind !== "audio") continue;
    for (const key of track.keys) if (key.sound !== undefined) assets.add(key.sound);
  }
  return [...assets].sort();
}

/** The voices of the scene at `t`, with the world place of each entity. */
function voicesAt(scene: AudioScene, sequence: SequenceDocument | null, t: number): AudioVoice[] {
  return soundCues(scene.document(), sequence, t, scene.registry).map((cue) => {
    const object = scene.entityObject(cue.entity);
    const place = object === undefined ? ([0, 0, 0] as const) : vector(object.getWorldPosition(position));
    const { volume, loop, spatial, refDistance, rolloff, maxDistance, distanceModel } = cue.source;
    const base = { id: cue.id, entity: cue.entity, asset: cue.asset, start: cue.start };
    return { ...base, volume, loop, spatial, refDistance, rolloff, maxDistance, distanceModel, position: place };
  });
}

/** The frames of one core. */
export class AudioFrames {
  #seq = 0;
  /** The text of the last frame with no `seq`, or "" before the first frame. */
  #last = "";
  /** The assets of the last scene and sequence (a cache by reference). */
  #assets: { scene: SceneDocument | null; sequence: SequenceDocument | null; list: string[] } = {
    scene: null,
    sequence: null,
    list: [],
  };

  /**
   * The frame of the scene at `t` (null: a scene with no sequence), or null when no value changed. With no voice, the
   * listener is not part of the compare: a camera move with no sound sends no frame.
   */
  next(scene: AudioScene, sequence: SequenceDocument | null, t: number | null, camera: Camera): AudioFrame | null {
    const assets = this.#assetsOf(scene.document(), sequence);
    const voices = voicesAt(scene, sequence, t ?? 0);
    if (this.#last === "" && voices.length === 0 && assets.length === 0) return null;
    const listener = listenerOf(camera);
    const text = JSON.stringify([t === null, voices, voices.length === 0 ? null : listener, assets]);
    if (text === this.#last) return null;
    this.#last = text;
    this.#seq += 1;
    return { seq: this.#seq, t, voices, listener, assets };
  }

  #assetsOf(scene: SceneDocument, sequence: SequenceDocument | null): string[] {
    const cache = this.#assets;
    if (cache.scene?.entities !== scene.entities || cache.sequence !== sequence) {
      this.#assets = { scene, sequence, list: audioAssets(scene, sequence) };
    }
    return this.#assets.list;
  }
}
