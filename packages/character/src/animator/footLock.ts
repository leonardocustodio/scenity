// SPDX-License-Identifier: Apache-2.0
/**
 * The foot lock of the animator. A foot in contact with the floor keeps the floor place (x and z) where its contact
 * started; its height comes from the pose. A two-bone IK of the leg moves the foot there.
 *
 * - The contacts come from the clip: the end node of the leg is in contact when its height in the model frame is in
 *   the lowest `contact` share of its range in the clip. A foot that does not move in the clip (an idle) has no lock:
 *   the clip holds it, and the body can turn over it.
 * - The lock reads the dominant clip of the current state of the first layer. The contact starts at a normalized time
 *   of that state; the animator gives the time of it (`timeAtPhase`), so the place is a function of the time: a seek
 *   gives the place of a play. A contact that starts in a crossfade starts at the end of the crossfade, when the pose
 *   is the pose of the state alone. There is no lock during a crossfade.
 * - The lock fades in and out over the first and last `fade` share of a contact.
 */
import { Matrix4, Vector3, type Object3D } from "three";
import type { FootLockLeg, FootLockValue } from "@scenity/scene/components";
import { solveTwoBone } from "../ik";
import type { Animator, AnimatorFrame, LayerPose } from "./animator";
import type { Parameters } from "./parameters";
import type { PoseMixer } from "./poseMixer";

/** The number of samples of a clip for the contacts. */
const CONTACT_SAMPLES = 48;
/** The height range of a foot (model units) under which the foot does not move in the clip. */
const STILL_RANGE = 1e-4;

/** A contact in normalized clip time: `end` can be above 1 for a contact over the end of the clip. */
export interface Contact {
  readonly start: number;
  readonly end: number;
}

/**
 * The contacts of a foot from its heights at equal steps over one cycle (the first sample at time 0, the last before
 * the end). The lowest `share` of the height range is a contact. A foot with no height range has one full contact.
 */
export function contactsOf(heights: readonly number[], share: number): Contact[] {
  const count = heights.length;
  if (count === 0) return [];
  const low = Math.min(...heights);
  const high = Math.max(...heights);
  if (high - low < STILL_RANGE) return [{ start: 0, end: 1 }];
  const limit = low + share * (high - low);
  const down = heights.map((height) => height <= limit);
  const out: Contact[] = [];
  // Start at an index where the foot is up, so that a contact over the end of the clip stays one contact.
  const first = down.findIndex((item) => !item);
  for (let step = 0; step < count; step += 1) {
    const index = (first + step) % count;
    const before = (index + count - 1) % count;
    if (down[index] !== true || down[before] === true) continue;
    let length = 0;
    while (down[(index + length) % count] === true) length += 1;
    out.push({ start: index / count, end: (index + length) / count });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** The two-bone IK of the leg; `@scenity/character/ik` has it with the IK of the hands. */
export { solveTwoBone };

interface BoundLeg {
  readonly leg: FootLockLeg;
  readonly upper: Object3D;
  readonly lower: Object3D;
  readonly end: Object3D;
  readonly follow: Object3D | undefined;
}

/** The plant of one leg at a frame: the time of the contact start and the weight of the lock now. */
interface Plant {
  readonly leg: BoundLeg;
  readonly time: number;
  readonly weight: number;
}

/** The entity world matrix at a time (the entity moves on a sequence track); null: the matrix of now. */
export type WorldAt = (t: number) => Matrix4 | null;

export class FootLock {
  readonly #legs: BoundLeg[] = [];
  readonly #contacts = new Map<string, Contact[]>();
  /** The floor place of each plant by leg and time. The places are a function of the time: a cache. */
  readonly #places = new Map<string, Vector3>();
  readonly #share: number;
  readonly #fade: number;

  constructor(
    private readonly mixer: PoseMixer,
    value: FootLockValue,
  ) {
    this.#share = value.contact ?? 0.2;
    this.#fade = value.fade ?? 0.15;
    for (const leg of value.legs) {
      const [upper, lower, end] = [mixer.node(leg.upper), mixer.node(leg.lower), mixer.node(leg.end)];
      if (upper === undefined || lower === undefined || end === undefined) continue;
      this.#legs.push({
        leg,
        upper,
        lower,
        end,
        follow: leg.follow === undefined ? undefined : mixer.node(leg.follow),
      });
    }
    // Measure the contacts of each clip now: a measure poses the model, so it must not run in a frame.
    for (const clip of Object.keys(mixer.lengths)) this.#legs.forEach((_, index) => this.contacts(index, clip));
    mixer.reset();
  }

  /** The number of legs with all their nodes in the model. */
  get size(): number {
    return this.#legs.length;
  }

  /** The contacts of a leg in a clip, from the clip alone over the rest pose (the constructor measures them). */
  contacts(leg: number, clip: string): Contact[] {
    const bound = this.#legs[leg];
    const length = this.mixer.lengths[clip];
    if (bound === undefined || length === undefined) return [];
    const key = `${String(leg)}\n${clip}`;
    let found = this.#contacts.get(key);
    if (found === undefined) {
      const root = this.mixer.root;
      const toModel = new Matrix4();
      const heights: number[] = [];
      for (let index = 0; index < CONTACT_SAMPLES; index += 1) {
        this.mixer.sampleClip(clip, (index / CONTACT_SAMPLES) * length);
        root.updateMatrixWorld(true);
        toModel.copy(root.matrixWorld).invert().multiply(bound.end.matrixWorld);
        heights.push(new Vector3().setFromMatrixPosition(toModel).y);
      }
      found = contactsOf(heights, this.#share);
      this.#contacts.set(key, found);
    }
    return found;
  }

  /** Drop the cache of the floor places (after a change of the scene or of the parameters). */
  clear(): void {
    this.#places.clear();
  }

  /** The plants of the legs at a frame: the contact of the dominant clip of the first layer. */
  #plants(frame: AnimatorFrame, animator: Animator): Plant[] {
    const layer: LayerPose | undefined = frame.layers[0];
    if (layer?.from !== null || frame.t < layer.fadeEnd) return [];
    let dominant: { clip: string; weight: number } | undefined;
    for (const sample of layer.samples) {
      if (sample.kind === "clip" && (dominant === undefined || sample.weight > dominant.weight)) dominant = sample;
    }
    if (dominant === undefined) return [];
    const cycle = layer.phase - Math.floor(layer.phase);
    const out: Plant[] = [];
    this.#legs.forEach((leg, index) => {
      for (const contact of this.contacts(index, dominant.clip)) {
        // A foot that does not move in the clip has no lock: the clip holds it, and the body can turn over it.
        if (contact.start === 0 && contact.end === 1) break;
        const at = cycle >= contact.start ? cycle : cycle + 1;
        if (at > contact.end) continue;
        const startPhase = Math.floor(layer.phase) + contact.start - (at === cycle ? 0 : 1);
        const found = startPhase < 0 ? layer.enter : animator.timeAtPhase(0, "current", startPhase);
        if (found === null) continue;
        const time = Math.max(layer.fadeEnd, Math.round(found));
        if (time > frame.t) continue;
        const share = (at - contact.start) / Math.max(1e-6, contact.end - contact.start);
        const weight = this.#fade <= 0 ? 1 : Math.min(1, share / this.#fade, (1 - share) / this.#fade);
        if (weight > 0) out.push({ leg, time, weight });
        break;
      }
    });
    return out;
  }

  /**
   * Lock the feet of a frame that the mixer put on the model. `entity` is the entity object over the model;
   * `worldAt` gives its world matrix at an earlier time. The call can pose the model at the contact times, so it puts
   * the frame on the model again at the end.
   */
  apply(frame: AnimatorFrame, animator: Animator, entity: Object3D, worldAt: WorldAt, params: Parameters = {}): void {
    const plants = this.#plants(frame, animator);
    if (plants.length === 0) return;
    const places = plants.map((plant) => this.#place(plant, animator, entity, worldAt));
    this.mixer.apply(frame, params);
    this.mixer.root.updateMatrixWorld(true);
    plants.forEach((plant, index) => {
      const place = places[index];
      if (place === undefined) return;
      const { upper, lower, end, follow } = plant.leg;
      const before = end.getWorldPosition(new Vector3());
      const target = new Vector3(place.x, before.y, place.z);
      solveTwoBone(upper, lower, end, target, plant.weight);
      if (follow !== undefined) moveWorld(follow, end.getWorldPosition(new Vector3()).sub(before));
    });
  }

  /** The world floor place of the end of a leg at the start of its contact. */
  #place(plant: Plant, animator: Animator, entity: Object3D, worldAt: WorldAt): Vector3 {
    const key = `${plant.leg.leg.end}\n${String(plant.time)}`;
    let place = this.#places.get(key);
    if (place === undefined) {
      this.mixer.apply(animator.at(plant.time));
      entity.updateMatrixWorld(true);
      const local = plant.leg.end.getWorldPosition(new Vector3()).applyMatrix4(entity.matrixWorld.clone().invert());
      place = local.applyMatrix4(worldAt(plant.time) ?? entity.matrixWorld);
      if (this.#places.size > 64) this.#places.clear();
      this.#places.set(key, place);
    }
    return place;
  }
}

/** Move a node by a world offset. */
function moveWorld(node: Object3D, offset: Vector3): void {
  const parent = node.parent;
  if (parent === null) {
    node.position.add(offset);
    return;
  }
  const world = node.getWorldPosition(new Vector3()).add(offset);
  node.position.copy(parent.worldToLocal(world));
  node.updateMatrixWorld(true);
}
