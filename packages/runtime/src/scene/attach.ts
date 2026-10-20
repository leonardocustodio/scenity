// SPDX-License-Identifier: Apache-2.0
/**
 * The attach keys of a sequence on the scene graph. An attach track puts its entity under a parent over a time range.
 * The parent is `entity:<id>` (the entity), `entity:<id>#<socket>` (a socket point of the entity) or
 * `entity:<id>#<bone>`. A bone is a canonical humanoid bone through the rig of its `character` component, else a node
 * name of its model.
 *
 * - Before the first key, the entity is at its place in the scene of the time.
 * - From a key with a parent, the entity follows the parent. With `position` or `rotation`, the key gives the local
 *   place under the parent frame (metres, with no scale of the parent). With neither, the entity keeps its world place
 *   of the key time: the offset is the place of the entity at that time in the frame of the parent at that time.
 * - From a key with no parent (null), the entity stays at its world place of the key time.
 *
 * The place at a time is a function of the key times and the poses at those times, so a seek gives the frame of a
 * play. The offsets come from the poses at the key times: the time line poses the scene at a key time one time and
 * keeps the result until an edit or a new model load.
 */
import { Matrix4, Quaternion, Vector3, type Object3D } from "three";
import { attachTarget } from "@scenity/character/attach";
import type { AttachKey, SequenceDocument } from "@scenity/scene/sequence";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { localTransform, worldTransform } from "@scenity/scene/world";

/** The parts of the time line that the attach needs. */
export interface AttachHost {
  /** Pose the whole graph at a time (the scene, the animators and the IK). */
  poseAt(t: number): SceneDocument;
  /** The object of an entity in the graph. */
  objectOf(id: string): Object3D | undefined;
  /** The world frame of `entity:<id>#<sub>` in the posed graph (no scale), or null when it does not resolve. */
  frameOf(scene: SceneDocument, entity: string, sub: string | null): Matrix4 | null;
  /** A number that changes when a model loads (a failed resolve is tried again after a load). */
  loads(): number;
}

interface Track {
  readonly entity: string;
  readonly keys: readonly AttachKey[];
}

/** A key result: the world matrix of the entity just before the key, and the offset under the parent of the key. */
interface KeyPlace {
  readonly before: Matrix4;
  readonly offset: Matrix4 | null;
}

const ONE = new Vector3(1, 1, 1);

/** The world matrix of an entity in a scene document, or null. */
function documentWorld(scene: SceneDocument, id: string): Matrix4 | null {
  const world = worldTransform(scene, id);
  return world === undefined ? null : new Matrix4().fromArray(world.matrix);
}

/** The attach tracks of a sequence: one list of keys for each entity, in time order (a stable sort of the tracks). */
function attachTracks(sequence: SequenceDocument): Track[] {
  const byEntity = new Map<string, AttachKey[]>();
  for (const track of sequence.tracks) {
    if (track.kind !== "attach") continue;
    byEntity.set(track.entity, [...(byEntity.get(track.entity) ?? []), ...track.keys]);
  }
  return [...byEntity].map(([entity, keys]) => ({ entity, keys: keys.sort((a, b) => a.t - b.t) }));
}

export class SceneAttach {
  readonly #tracks: readonly Track[];
  readonly #places = new Map<string, KeyPlace>();
  /** The keys that did not resolve, with the load count of the try. */
  readonly #failed = new Map<string, number>();

  constructor(sequence: SequenceDocument) {
    this.#tracks = attachTracks(sequence);
  }

  /** True when the sequence has no attach track. */
  get empty(): boolean {
    return this.#tracks.length === 0;
  }

  /** Forget the key places (after an edit of the scene). */
  invalidate(): void {
    this.#places.clear();
    this.#failed.clear();
  }

  /**
   * Find the key places that the frame at `t` needs and that are not known: pose the graph at each key time, in time
   * order. Call it before the pose of the frame.
   */
  prepare(t: number, host: AttachHost): void {
    const missing: { readonly track: Track; readonly index: number }[] = [];
    for (const track of this.#tracks) {
      track.keys.forEach((key, index) => {
        const id = `${track.entity}\n${String(index)}`;
        if (key.t > t || this.#places.has(id) || this.#failed.get(id) === host.loads()) return;
        missing.push({ track, index });
      });
    }
    missing.sort((a, b) => (a.track.keys[a.index]?.t ?? 0) - (b.track.keys[b.index]?.t ?? 0));
    for (const { track, index } of missing) {
      const key = track.keys[index];
      if (key === undefined) continue;
      const scene = host.poseAt(key.t);
      const place = this.#keyPlace(track, index, scene, host);
      const id = `${track.entity}\n${String(index)}`;
      if (place === null) this.#failed.set(id, host.loads());
      else this.#places.set(id, place);
    }
  }

  /** Put each entity of an attach track at its place of the time `t` (the graph holds the pose of `t`). */
  apply(t: number, scene: SceneDocument, host: AttachHost): void {
    for (const track of this.#tracks) {
      const object = host.objectOf(track.entity);
      if (object === undefined) continue;
      const world = this.#worldAt(track, t, scene, host);
      if (world === null) {
        const local = localTransform(scene.entities[track.entity] ?? { parent: null, index: 0, components: {} });
        object.position.fromArray(local.position);
        object.quaternion.fromArray(local.rotation);
        object.scale.fromArray(local.scale);
      } else {
        const parent = object.parent?.matrixWorld ?? new Matrix4();
        new Matrix4().copy(parent).invert().multiply(world).decompose(object.position, object.quaternion, object.scale);
      }
      object.updateMatrixWorld(true);
    }
  }

  /** The world matrix of the entity of a track at `t`, or null for its place in the scene. */
  #worldAt(track: Track, t: number, scene: SceneDocument, host: AttachHost): Matrix4 | null {
    let index = -1;
    track.keys.forEach((key, i) => {
      if (key.t <= t) index = i;
    });
    const key = track.keys[index];
    if (key === undefined) return null;
    const place = this.#places.get(`${track.entity}\n${String(index)}`);
    if (place === undefined) return null;
    if (key.to === null) return place.before;
    const target = attachTarget(key.to);
    const frame = target === null ? null : host.frameOf(scene, target.entity, target.socket);
    if (frame === null) return null;
    return frame.multiply(place.offset ?? new Matrix4());
  }

  /**
   * The place of a key from the graph posed at its time: the world matrix before it and the offset under its parent.
   */
  #keyPlace(track: Track, index: number, scene: SceneDocument, host: AttachHost): KeyPlace | null {
    const key = track.keys[index];
    if (key === undefined) return null;
    const before = this.#before(track, index, scene, host);
    if (before === null) return null;
    if (key.to === null) return { before, offset: null };
    const target = attachTarget(key.to);
    const frame = target === null ? null : host.frameOf(scene, target.entity, target.socket);
    if (frame === null) return null;
    if (key.position === undefined && key.rotation === undefined)
      return { before, offset: frame.clone().invert().multiply(before) };
    // A local place: the scale of the entity stays (its world scale in the scene of the key time).
    const scale = new Vector3();
    before.decompose(new Vector3(), new Quaternion(), scale);
    const position = new Vector3(...(key.position ?? [0, 0, 0]));
    const rotation = new Quaternion(...(key.rotation ?? [0, 0, 0, 1]));
    return { before, offset: new Matrix4().compose(position, rotation, scale) };
  }

  /** The world matrix of the entity of a track just before a key (the graph holds the pose of the key time). */
  #before(track: Track, index: number, scene: SceneDocument, host: AttachHost): Matrix4 | null {
    const previous = track.keys[index - 1];
    if (previous === undefined) return documentWorld(scene, track.entity);
    const place = this.#places.get(`${track.entity}\n${String(index - 1)}`);
    if (place === undefined) return null;
    if (previous.to === null) return place.before;
    const target = attachTarget(previous.to);
    const frame = target === null ? null : host.frameOf(scene, target.entity, target.socket);
    return frame === null ? null : frame.multiply(place.offset ?? new Matrix4());
  }
}

/** The world frame of an object with no scale: its world position and world rotation. */
export function frameWithoutScale(object: Object3D, local?: Matrix4): Matrix4 {
  object.updateWorldMatrix(true, false);
  const world = local === undefined ? object.matrixWorld.clone() : object.matrixWorld.clone().multiply(local);
  const position = new Vector3();
  const rotation = new Quaternion();
  world.decompose(position, rotation, new Vector3());
  return new Matrix4().compose(position, rotation, ONE);
}
