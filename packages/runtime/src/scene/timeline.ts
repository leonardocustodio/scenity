// SPDX-License-Identifier: Apache-2.0
/**
 * The time line of a scene: a sequence over a scene document in a scene builder. The frame at a time `t` is the scene
 * of the evaluator of `@scenity/scene` at `t`. The builder puts it into the graph by reference compare (only the
 * touched parts change). Then the animator driver poses the skinned models at `t`. The frame is a function of the
 * documents and `t`, so a seek gives the frame of a play. A core calls `at(sim)` in its update.
 *
 * An entity with a `locomotion` component walks to its stand points around the `obstacle` components. The walk plan
 * comes from the base scene (`@scenity/character/sceneWalks`). Each frame puts the transform of the walk at `t` over
 * the scene of the evaluator, and the animator gets the walk speed in its speed parameter. The walk has fixed times,
 * so a seek gives the frame of a play. A footprint `bounds` of a model gives no obstacle here. The bounds come only
 * after the load, and an asset load must not change a walk.
 *
 * After the animators, the clips of the animation tracks pose their models (scene/sequenceClips.ts). A
 * preview clip of the editor (`previewClip`) plays on its entity at the time of the frame, over the tracks.
 *
 * After the animators, the IK goals of the `character` components pose the hands and the heads
 * (`scene/characters.ts`), and the attach keys of the sequence put their entities under bones and sockets
 * (`scene/attach.ts`). The active variant of a character merges into the material overrides of its model.
 *
 * The evaluator replays the action keys of the plugin simulations, and the plugin systems change the scene of
 * the evaluator before the build (`SceneTimelineOptions.systems`).
 *
 * The time line has no separate edit state and play state: an edit changes the base scene of the evaluator.
 */
import { Matrix4, Quaternion, Vector3 } from "three";
import { defaultParameters, sequenceParameters } from "@scenity/character/animator";
import { boneNode } from "@scenity/character/characterRig";
import type { ProceduralMotion } from "@scenity/character/poseMixer";
import { sceneWalkers, withWalkers, type SceneWalker } from "@scenity/character/sceneWalks";
import { walkParameters } from "@scenity/character/walkPlan";
import { applyOps } from "@scenity/scene/ops";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { AnimatorValue, CharacterValue } from "@scenity/scene/components";
import type { SceneOp } from "@scenity/scene/schema/entity";
import {
  createEvaluator,
  type ActiveClip,
  type Evaluator,
  type FrameState,
  type SequenceDocument,
  type SimulationPlugin,
} from "@scenity/scene/sequence";
import { socketWorld, worldTransform } from "@scenity/scene/world";
import { AnimatorDriver, entityModel, type AnimatorReport } from "./animate";
import { frameWithoutScale, SceneAttach, type AttachHost } from "./attach";
import type { ApplyOutcome, SceneBuilder } from "./builder";
import { CharacterPoser, withVariants } from "./characters";
import { SequenceClipDriver } from "./sequenceClips";

export interface SceneTimelineOptions {
  /** The procedural motions of the plugins by ID (`<plugin>.<name>`). */
  readonly procedural?: ReadonlyMap<string, ProceduralMotion>;
  /** The simulations of the plugins. The evaluator replays their action keys. */
  readonly simulations?: readonly SimulationPlugin[];
  /**
   * The systems of the plugins (core/documentPlugins.ts). They change the scene of the evaluator at `t` before the
   * build. `frameAt` gives the frame state of the evaluator at a time.
   */
  readonly systems?: (scene: SceneDocument, t: number, frameAt: (t: number) => FrameState) => SceneDocument;
}

/** A clip that plays on an entity at the time of each frame (the preview of the clip browser). */
export interface ClipPreview {
  readonly entity: string;
  /** The model, skinned model or animation asset of the clip (`asset:<id>`). */
  readonly clip: string;
  /** The name of the clip in the asset (default: its first clip). */
  readonly name?: string;
}

export class SceneTimeline {
  readonly sequence: SequenceDocument;
  readonly #builder: SceneBuilder;
  readonly #driver: AnimatorDriver;
  readonly #clips: SequenceClipDriver;
  #preview: ClipPreview | null = null;
  readonly #poser: CharacterPoser;
  readonly #attach: SceneAttach;
  readonly #host: AttachHost;
  #base: SceneDocument;
  #evaluator: Evaluator;
  #walkers: readonly SceneWalker[];
  #t: number | null = null;
  #reports: AnimatorReport[] = [];
  readonly #plugins: Pick<SceneTimelineOptions, "simulations" | "systems">;
  readonly #warned = new Set<string>();

  constructor(
    builder: SceneBuilder,
    scene: SceneDocument,
    sequence: SequenceDocument,
    options: SceneTimelineOptions = {},
  ) {
    this.sequence = sequence;
    this.#builder = builder;
    this.#base = scene;
    this.#plugins = options;
    this.#evaluator = this.#evaluate(scene);
    this.#walkers = sceneWalkers(scene);
    this.#driver = new AnimatorDriver(builder.root, {
      sequence,
      parameters: (entity, value) => {
        const base = sequenceParameters(sequence, entity, defaultParameters(value));
        const walker = this.#walkers.find((item) => item.entity === entity);
        return walker === undefined ? base : walkParameters(walker.plan, walker.parameter, base);
      },
      worldAt: (entity, t) => this.#worldAt(entity, t),
      rig: (entity) => this.#base.entities[entity]?.components.character as CharacterValue | undefined,
      warn: (message) => this.#warn(message),
      ...(options.procedural === undefined ? {} : { procedural: options.procedural }),
    });
    this.#clips = new SequenceClipDriver(builder, {
      rig: (entity) => this.#base.entities[entity]?.components.character as CharacterValue | undefined,
      sourceRig: (entity, ref) => {
        const source = (this.#base.entities[entity]?.components.animator as AnimatorValue | undefined)?.clipSource;
        return source?.asset === ref ? { rig: source.rig } : undefined;
      },
      warn: (message) => this.#warn(message),
    });
    this.#poser = new CharacterPoser((message) => this.#warn(message));
    this.#attach = new SceneAttach(sequence);
    this.#host = {
      poseAt: (t) => this.#poseAt(t),
      objectOf: (id) => this.#builder.entityObject(id),
      frameOf: (doc, entity, sub) => this.#frameOf(doc, entity, sub),
      loads: () => this.#loads(),
    };
  }

  /** The base scene under the sequence (the scene of the load with the patches after it). */
  get base(): SceneDocument {
    return this.#base;
  }

  /** The time of the last frame in ms, or null before the first frame. */
  get time(): number | null {
    return this.#t;
  }

  /** The simulation states of the plugins at the time of the last frame, by plugin ID (none before it). */
  simulations(): Record<string, unknown> {
    return this.#t === null ? {} : this.#evaluator.simulationsAt(this.#t);
  }

  /** The animator reports of the last frame. */
  get reports(): readonly AnimatorReport[] {
    return this.#reports;
  }

  /**
   * Put the scene at `t` ms (rounded to a whole ms and clamped to the time line). With `since`, the reports hold the
   * events of a play step in (since, t].
   */
  at(t: number, since?: number): readonly AnimatorReport[] {
    const time = Math.min(Math.max(0, Math.round(t)), this.sequence.duration);
    if (!this.#attach.empty) this.#attach.prepare(time, this.#host);
    const scene = this.#poseAt(time, since);
    if (!this.#attach.empty) this.#attach.apply(time, scene, this.#host);
    this.#t = time;
    return this.#reports;
  }

  /**
   * Play a clip on an entity at the time of each frame, in a loop, over the tracks of the sequence (the
   * preview of the clip browser). The sequence does not change. Null stops the preview.
   */
  previewClip(preview: ClipPreview | null): void {
    this.#preview = preview;
    if (this.#t !== null) this.at(this.#t);
  }

  /** Release the assets of the clips of the animation tracks. */
  dispose(): void {
    this.#clips.dispose();
  }

  /** Apply ops to the base scene as one transaction, then show the frame of the same time again. */
  edit(ops: readonly SceneOp[]): ApplyOutcome {
    // An empty patch asks only for the next frame: the evaluator and the animators stay.
    if (ops.length === 0) return { ok: true, inverse: [], warnings: [] };
    const result = applyOps(this.#base, ops, this.#builder.registry);
    if (!result.ok) return result;
    this.#base = result.doc;
    this.#evaluator = this.#evaluate(this.#base);
    this.#walkers = sceneWalkers(this.#base);
    this.#driver.invalidate();
    this.#attach.invalidate();
    this.at(this.#t ?? 0);
    return { ok: true, inverse: result.inverse, warnings: result.warnings };
  }

  /** The evaluator of the sequence over a base scene, with the simulations of the plugins. */
  #evaluate(scene: SceneDocument): Evaluator {
    const { simulations } = this.#plugins;
    const registry = this.#builder.registry;
    return createEvaluator({ scene, sequence: this.sequence, registry, ...(simulations ? { simulations } : {}) });
  }

  /** The scene of the evaluator at a time, with the transform of each walker and the variant of each character. */
  #sceneAt(t: number, frame = this.#evaluator.at(t)): SceneDocument {
    return withVariants(withWalkers(frame.scene, this.#walkers, t));
  }

  /** Build the scene of a time into the graph, then pose the animators and the IK goals at that time. */
  #poseAt(t: number, since?: number): SceneDocument {
    const systems = this.#plugins.systems;
    const frame = this.#evaluator.at(t);
    const own = this.#sceneAt(t, frame);
    const scene = systems === undefined ? own : systems(own, t, (at) => this.#evaluator.at(at));
    const objectOf = (id: string) => this.#builder.entityObject(id);
    this.#builder.build(scene);
    this.#builder.root.updateMatrixWorld(true);
    this.#poser.restore(scene, objectOf);
    this.#clips.restore();
    this.#reports = this.#driver.at(t, since);
    const modelOf = (id: string) => (scene.entities[id]?.components.model as { asset?: string } | undefined)?.asset;
    this.#clips.at(this.#animationsAt(frame.animations, t), objectOf, modelOf);
    this.#poser.solve(scene, objectOf);
    this.#builder.root.updateMatrixWorld(true);
    return scene;
  }

  /** The active clips of the animation tracks at a time, with the preview clip of the editor. */
  #animationsAt(
    animations: Readonly<Record<string, readonly ActiveClip[]>>,
    t: number,
  ): Readonly<Record<string, readonly ActiveClip[]>> {
    const preview = this.#preview;
    if (preview === null) return animations;
    const { entity, clip, name } = preview;
    const active: ActiveClip = {
      clip,
      ...(name === undefined ? {} : { name }),
      start: 0,
      time: t,
      speed: 1,
      loop: true,
      weight: 1,
    };
    return { ...animations, [entity]: [active] };
  }

  /**
   * The world frame (no scale) of an entity, of a socket point of it, or of a bone of its model. Null when not found.
   */
  #frameOf(scene: SceneDocument, id: string, sub: string | null) {
    const object = this.#builder.entityObject(id);
    if (object === undefined) return null;
    if (sub === null) return frameWithoutScale(object);
    const socket = socketWorld(scene, `entity:${id}#${sub}`);
    if (socket !== undefined) {
      const [x, y, z] = socket.position;
      return new Matrix4().compose(new Vector3(x, y, z), new Quaternion(...socket.rotation), new Vector3(1, 1, 1));
    }
    const model = entityModel(object);
    const character = scene.entities[id]?.components.character as CharacterValue | undefined;
    const node = model === undefined ? undefined : boneNode(model, this.#poser.bonesOf(id, model, character), sub);
    return node === undefined ? null : frameWithoutScale(node);
  }

  /** The number of loaded models of the base scene (a failed attach tries again after a load). */
  #loads(): number {
    let count = 0;
    for (const id of Object.keys(this.#base.entities)) {
      const object = this.#builder.entityObject(id);
      if (object !== undefined && entityModel(object) !== undefined) count += 1;
    }
    return count;
  }

  #warn(message: string): void {
    if (this.#warned.has(message)) return;
    this.#warned.add(message);
    console.warn(`[scenity] ${message}`);
  }

  /** The world matrix of an entity at a time, from the scene of the evaluator (the foot lock asks for it). */
  #worldAt(entity: string, t: number): Matrix4 | null {
    const world = worldTransform(this.#sceneAt(Math.round(t)), entity);
    if (world === undefined) return null;
    const [x, y, z] = world.position;
    const [sx, sy, sz] = world.scale;
    return new Matrix4().compose(new Vector3(x, y, z), new Quaternion(...world.rotation), new Vector3(sx, sy, sz));
  }
}
