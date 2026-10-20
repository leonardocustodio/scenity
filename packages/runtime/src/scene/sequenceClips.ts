// SPDX-License-Identifier: Apache-2.0
/**
 * The clips of the animation tracks (`kind: "animation"` of a sequence). The evaluator gives the active clips of each
 * entity at a time, and this driver poses the model of the entity with them, after the animator. A clip of
 * a track overrides the pose of the animator while it plays.
 *
 * - The clip of a key is a clip of a model, a skinned model or an animation asset (`clip`), by its `name` (default:
 *   the first clip of the asset). The clips of the model of the entity play as they are. The clips of another asset
 *   play retargeted through the rig profiles (the `character` component of the entity gives its rig).
 * - The driver loads another asset one time through the scene builder, so `ready()` waits for it. A clip of an asset
 *   that loads gives no pose for that frame. A failed load warns one time.
 * - The clip time is the time of the key in seconds. A loop wraps it, else it stops at the end of the clip.
 * - The mixer and the retarget read the rest pose of the model. The animator poses the model before this driver, so
 *   the driver reads the rest pose from the template of the model (restPose.ts). Before the animator of each frame,
 *   `restore()` returns the nodes of the clips to the rest pose, so a clip that stops leaves no pose.
 *
 * The pose is a function of the documents and the time, so a seek gives the frame of a play.
 */
import type { AnimationClip, Object3D } from "three";
import type { AnimatorFrame } from "@scenity/character/animator";
import { clipsFrom, type RigValue } from "@scenity/character/characterRig";
import { PoseMixer } from "@scenity/character/poseMixer";
import type { ActiveClip } from "@scenity/scene/sequence";
import { entityModel } from "./animate";
import { isModel } from "./assets";
import { atRest, entityTemplate } from "./restPose";
import type { AssetValue } from "./types";

/** The parts of the scene builder that the driver uses. */
export interface ClipModels {
  acquireModel(ref: string): Promise<AssetValue>;
  releaseModel(ref: string): void;
}

export interface SequenceClipOptions {
  /** The rig of the model of an entity (its `character` component), for the clips of another asset. */
  rig?(entity: string): RigValue | undefined;
  /** The rig of the skeleton of a clip asset (the `rig` of the clip source of the animator), else from the names. */
  sourceRig?(entity: string, ref: string): RigValue | undefined;
  /** A function that gets each problem (a clip that the asset does not hold, a failed load). */
  warn?(message: string): void;
}

interface Source {
  model?: Object3D;
}

/** A clip of an entity at a time: its key in the mixer, the clip and the active clip of the evaluator. */
interface Sample {
  readonly key: string;
  readonly clip: AnimationClip;
  readonly active: ActiveClip;
}

interface Bound {
  readonly keys: string;
  readonly mixer: PoseMixer;
}

/** The key of a clip in a mixer: the asset and the name of the clip. */
const clipKey = (ref: string, name: string): string => `${ref}#${name}`;

export class SequenceClipDriver {
  readonly #models: ClipModels;
  readonly #options: SequenceClipOptions;
  readonly #sources = new Map<string, Source>();
  /** The clips of each asset on each model instance (retargeted for another asset). */
  readonly #clips = new WeakMap<Object3D, Map<string, readonly AnimationClip[]>>();
  readonly #bound = new Map<Object3D, Bound>();
  readonly #warned = new Set<string>();

  constructor(models: ClipModels, options: SequenceClipOptions = {}) {
    this.#models = models;
    this.#options = options;
  }

  /**
   * Pose the model of each entity with active clips. `objectOf` gives the object of an entity. `modelOf` gives the
   * model asset of an entity (its own clips play with no retarget).
   */
  at(
    animations: Readonly<Record<string, readonly ActiveClip[]>>,
    objectOf: (id: string) => Object3D | undefined,
    modelOf: (id: string) => string | undefined,
  ): void {
    const posed = new Set<Object3D>();
    for (const entity of Object.keys(animations).sort()) {
      const active = animations[entity] ?? [];
      const object = active.length === 0 ? undefined : objectOf(entity);
      const instance = object === undefined ? undefined : entityModel(object);
      if (object === undefined || instance === undefined) continue;
      const template = entityTemplate(object);
      const own = modelOf(entity);
      const samples: Sample[] = [];
      for (const item of active) {
        const clips = this.#clipsOf(entity, instance, template, item.clip, item.clip === own);
        if (clips === undefined) continue;
        const clip = item.name === undefined ? clips[0] : clips.find((each) => each.name === item.name);
        if (clip === undefined) {
          this.#warn(`${entity}: the asset "${item.clip}" has no clip "${item.name ?? ""}"`);
          continue;
        }
        samples.push({ key: clipKey(item.clip, clip.name), clip, active: item });
      }
      if (samples.length === 0) continue;
      this.#apply(instance, template, samples);
      posed.add(instance);
    }
    // A model that has no clip at this time keeps the rest pose of `restore()`: remove its mixer.
    for (const instance of [...this.#bound.keys()]) if (!posed.has(instance)) this.#bound.delete(instance);
  }

  /** Return the nodes that the clips posed to the rest pose. The time line calls it before the animator. */
  restore(): void {
    for (const bound of this.#bound.values()) bound.mixer.reset();
  }

  /** Return the posed nodes to the rest pose and release the assets that the driver loaded. */
  dispose(): void {
    this.restore();
    this.#bound.clear();
    for (const ref of this.#sources.keys()) this.#models.releaseModel(ref);
    this.#sources.clear();
  }

  /** Put the clips on the model: one override layer with the weight of each clip. */
  #apply(instance: Object3D, template: Object3D | undefined, samples: readonly Sample[]): void {
    const keys = [...new Set(samples.map((sample) => sample.key))].sort().join("|");
    let bound = this.#bound.get(instance);
    if (bound?.keys !== keys) {
      bound?.mixer.reset();
      const named = new Map<string, AnimationClip>();
      for (const sample of samples) {
        const copy = sample.clip.clone();
        copy.name = sample.key;
        named.set(sample.key, copy);
      }
      const clips = [...named.values()];
      bound = { keys, mixer: atRest(instance, template, () => new PoseMixer(instance, clips)) };
      this.#bound.set(instance, bound);
    }
    const layerSamples = samples.map(({ key, clip, active }) => {
      const seconds = Math.max(0, active.time) / 1000;
      const time = active.loop && clip.duration > 0 ? seconds % clip.duration : Math.min(seconds, clip.duration);
      return { kind: "clip" as const, clip: key, time, weight: active.weight };
    });
    const layer: AnimatorFrame["layers"][number] = {
      name: "sequence",
      weight: 1,
      blend: "override",
      mask: null,
      state: "",
      phase: 0,
      from: null,
      fromPhase: 0,
      fade: 1,
      enter: 0,
      fadeEnd: 0,
      samples: layerSamples,
    };
    const frame: AnimatorFrame = { t: 0, rootMotion: "clip", events: [], layers: [layer] };
    bound.mixer.apply(frame);
  }

  /** The clips of an asset on a model instance, or undefined while the asset loads or after a failed load. */
  #clipsOf(
    entity: string,
    instance: Object3D,
    template: Object3D | undefined,
    ref: string,
    own: boolean,
  ): readonly AnimationClip[] | undefined {
    let byRef = this.#clips.get(instance);
    const known = byRef?.get(ref);
    if (known !== undefined) return known;
    if (own) return instance.animations;
    const source = this.#source(ref);
    if (source.model === undefined) return undefined;
    const problems: string[] = [];
    const rig = this.#options.rig?.(entity) ?? {};
    const model = source.model;
    const from = this.#options.sourceRig?.(entity, ref) ?? {};
    const clips = atRest(instance, template, () => clipsFrom(model, from, instance, rig, problems));
    for (const problem of problems) this.#warn(`${entity}: the clips of "${ref}": ${problem}`);
    if (byRef === undefined) {
      byRef = new Map();
      this.#clips.set(instance, byRef);
    }
    byRef.set(ref, clips);
    return clips;
  }

  /** The load of an asset for its clips, started at the first use. */
  #source(ref: string): Source {
    const known = this.#sources.get(ref);
    if (known !== undefined) return known;
    const source: Source = {};
    this.#sources.set(ref, source);
    this.#models.acquireModel(ref).then(
      (value) => {
        if (isModel(value)) source.model = value;
        else this.#warn(`the clip asset "${ref}" is not a model`);
      },
      (error: unknown) => {
        this.#warn(`the clip asset "${ref}" did not load: ${error instanceof Error ? error.message : String(error)}`);
      },
    );
    return source;
  }

  #warn(message: string): void {
    if (this.#warned.has(message)) return;
    this.#warned.add(message);
    this.#options.warn?.(message);
  }
}
