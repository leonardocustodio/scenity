// SPDX-License-Identifier: Apache-2.0
/**
 * The animator driver. It poses the skinned model of each entity with an `animator` component at a time, with no
 * AnimationMixer and no clock. The pure animator of `@scenity/character/animator` gives the layer poses at the time.
 * The pose mixer puts them on the model, and the foot lock holds the feet in contact. The host calls `at(t)` after the
 * transforms of the time are in the graph, then draws.
 *
 * The frame at a time is a function of the documents, the parameters and the time: a seek gives the frame of a play.
 * The driver keeps one animator, mixer and foot lock for each entity. A new model instance, a new revision of the
 * component or `invalidate()` makes them again.
 *
 * An animator with a `clipSource` plays the clips of that model. The driver retargets them onto the model of the
 * entity through the rig profiles when it binds the animator. The `character` component of the entity gives its rig.
 *
 * The driver binds at the rest pose of the template of the model (restPose.ts). Thus a new driver of a new time line
 * can start while the model has the pose of the previous time line.
 */
import type { AnimationClip, Matrix4, Object3D } from "three";
import {
  createAnimator,
  defaultParameters,
  sequenceParameters,
  type Animator,
  type AnimatorEvent,
  type ParameterSource,
} from "@scenity/character/animator";
import { clipsFrom, type RigValue } from "@scenity/character/characterRig";
import { FootLock } from "@scenity/character/footLock";
import { PoseMixer, type ProceduralMotion } from "@scenity/character/poseMixer";
import type { AnimatorValue } from "@scenity/scene/components";
import type { SequenceDocument } from "@scenity/scene/sequence";
import { animatorHolder, type AnimatorHolder } from "./presenters/animator";
import { modelInstance } from "./presenters/model";
import { atRest, entityTemplate } from "./restPose";

export interface AnimatorDriverOptions {
  /**
   * The sequence that keys the parameters (the property tracks on `animator/parameters/<name>`). With no sequence
   * and no `parameters`, the parameters are the values of the component at each frame.
   */
  readonly sequence?: SequenceDocument;
  /** The parameters of an entity over time, in place of the sequence. */
  parameters?(entity: string, value: AnimatorValue): ParameterSource;
  /** The world matrix of an entity at an earlier time, for the foot lock (default: the current matrix). */
  worldAt?(entity: string, t: number): Matrix4 | null;
  /** The procedural motions of the plugins by ID (`<plugin>.<name>`). */
  procedural?: ReadonlyMap<string, ProceduralMotion>;
  /** The rig of the model of an entity (its `character` component), for the clips of a clip source. */
  rig?(entity: string): RigValue | undefined;
  /** A function that gets each problem of a bind (a clip source with no humanoid rig). */
  warn?(message: string): void;
}

/** The state of the animator of one entity at a time: the state of each layer and the events of a play step. */
export interface AnimatorReport {
  readonly entity: string;
  readonly layers: readonly { readonly name: string; readonly state: string; readonly from: string | null }[];
  readonly events: readonly AnimatorEvent[];
}

interface Bound {
  readonly revision: number;
  readonly generation: number;
  readonly instance: Object3D;
  readonly mixer: PoseMixer;
  readonly animator: Animator;
  readonly parameters: ParameterSource;
  readonly footLock: FootLock | null;
}

/** The model instance of an entity object: the instance of its `model` part, once it is loaded. */
export function entityModel(entity: Object3D): Object3D | undefined {
  for (const child of entity.children) {
    if (child.userData.component === "model") return modelInstance(child);
  }
  return undefined;
}

export class AnimatorDriver {
  readonly #root: Object3D;
  readonly #options: AnimatorDriverOptions;
  readonly #bound = new WeakMap<AnimatorHolder, Bound>();
  #generation = 0;

  /** `root` is the root of the scene graph (`SceneBuilder.root`). */
  constructor(root: Object3D, options: AnimatorDriverOptions = {}) {
    this.#root = root;
    this.#options = options;
  }

  /** Make the animators again at the next frame (after a change of the parameter source or of the sequence). */
  invalidate(): void {
    this.#generation += 1;
  }

  /**
   * Pose each animated model at `t` (an integer count of ms). With `since`, the reports hold the events in (since, t].
   */
  at(t: number, since?: number): AnimatorReport[] {
    const reports: AnimatorReport[] = [];
    const holders: { holder: AnimatorHolder; entity: Object3D }[] = [];
    this.#root.traverse((object) => {
      const holder = animatorHolder(object);
      if (holder !== undefined && object.parent !== null) holders.push({ holder, entity: object.parent });
    });
    for (const { holder, entity } of holders) {
      const bound = this.#bind(holder, entity);
      if (bound === null) continue;
      const frame = bound.animator.at(t, since);
      const params = bound.parameters.at(t);
      bound.mixer.apply(frame, params);
      if (bound.footLock !== null) {
        entity.updateMatrixWorld(true);
        const worldAt = (time: number) => this.#options.worldAt?.(holder.entity, time) ?? null;
        bound.footLock.apply(frame, bound.animator, entity, worldAt, params);
      }
      const layers = frame.layers.map((layer) => ({ name: layer.name, state: layer.state, from: layer.from }));
      reports.push({ entity: holder.entity, layers, events: frame.events });
    }
    return reports;
  }

  /** The animator, mixer and foot lock of an entity, made again when an input changed. Null before the model loads. */
  #bind(holder: AnimatorHolder, entity: Object3D): Bound | null {
    const instance = entityModel(entity);
    if (instance === undefined) return null;
    // An animator with a clip source waits for the end of its load.
    // After a failed load, it plays the clips of the model.
    if (holder.value.clipSource !== undefined && holder.source === undefined && holder.sourceFailed !== true)
      return null;
    const known = this.#bound.get(holder);
    if (known?.instance === instance && known.revision === holder.revision && known.generation === this.#generation)
      return known;
    known?.mixer.reset();
    const value = holder.value;
    const options = this.#options;
    const mixerOptions = {
      ...(value.rootBone === undefined ? {} : { rootBone: value.rootBone }),
      ...(options.procedural === undefined ? {} : { procedural: options.procedural }),
    };
    const mixer = atRest(
      instance,
      entityTemplate(entity),
      () => new PoseMixer(instance, this.#clips(holder, instance), mixerOptions),
    );
    // With no source, the parameters are the current values of the component (an op changes them, with no time line).
    const parameters =
      options.parameters?.(holder.entity, value) ??
      (options.sequence === undefined
        ? { at: () => defaultParameters(holder.value), changes: () => [] }
        : sequenceParameters(options.sequence, holder.entity, defaultParameters(value)));
    const bound: Bound = {
      revision: holder.revision,
      generation: this.#generation,
      instance,
      mixer,
      animator: createAnimator({ value, clips: mixer.lengths, parameters }),
      parameters,
      footLock: value.footLock === undefined ? null : new FootLock(mixer, value.footLock),
    };
    this.#bound.set(holder, bound);
    return bound;
  }

  /** The clips of an animator: the clips of its clip source retargeted onto the model, else the clips of the model. */
  #clips(holder: AnimatorHolder, instance: Object3D): AnimationClip[] {
    const source = holder.value.clipSource;
    if (source === undefined || holder.source === undefined) return instance.animations;
    const problems: string[] = [];
    const rig = this.#options.rig?.(holder.entity) ?? {};
    const clips = clipsFrom(holder.source, { rig: source.rig }, instance, rig, problems);
    for (const problem of problems) this.#options.warn?.(`${holder.entity}: ${problem}`);
    return clips.length > 0 ? clips : instance.animations;
  }
}
