// SPDX-License-Identifier: Apache-2.0
/**
 * The post-processing of a document core. The host keeps the effect values of the `environment` component, the
 * quality tier and the selection. It gives the effects of each frame (`frameEffects` of `@scenity/scene/effects`, with
 * the caps of the tier). When an effect draws, the host loads the pipeline of the backend (a lazy chunk:
 * `@scenity/render/postWebgl` or `postWebgpu`), and the frame draws through it. With no effect, the frame draws
 * directly with the renderer, so the frames of a scene with no effect value do not change.
 *
 * A pipeline holds its scene, its camera and the structure of its passes. A change of a value or of the camera makes a
 * new pipeline. While the new pipeline loads, the previous pipeline draws when it has the same camera, else the frame draws
 * with no effect. The selection outline is in the structure only while the frame has a selection.
 */
import type { Object3D, PerspectiveCamera, Scene } from "three";
import { activeEffects, frameEffects, type EffectsValue, type FrameEffects } from "@scenity/scene/effects";
import type { PostFactory, PostPipeline, PostSettings } from "@scenity/render/postTypes";
import type { SceneRenderer } from "@scenity/render/types";
import type { Tier } from "../protocol";
import { toColor } from "../scene/colour";

/** The loader of the pipeline factory of a backend: a dynamic import of its chunk. */
export type PostLoader = () => Promise<PostFactory>;

/** A pipeline and the key of its settings and camera. */
interface Built {
  readonly key: string;
  readonly camera: PerspectiveCamera;
  readonly pipeline: PostPipeline;
}

/** The settings of a pipeline from the effects of a frame. The outline draws only with a selection. */
function postSettings(effects: FrameEffects, selection: boolean): PostSettings {
  const outline = effects.outline;
  const colour = outline === null ? null : toColor(outline.colour);
  return {
    ao: effects.ao,
    bloom: effects.bloom,
    antialias: effects.antialias,
    outline:
      outline === null || colour === null || !selection
        ? null
        : { colour: [colour.r, colour.g, colour.b], thickness: outline.thickness, strength: outline.strength },
  };
}

export class EffectsHost {
  #value: EffectsValue = {};
  #tier: Tier;
  #selection: readonly string[] = [];
  #factory: Promise<PostFactory> | null = null;
  #built: Built | null = null;
  /** The key and the promise of the pipeline that loads. */
  #loading: { readonly key: string; readonly done: Promise<void> } | null = null;
  /** The key of a pipeline that did not load: the frames of that key draw with no effect. */
  #failed: string | null = null;
  #disposed = false;

  /**
   * @param loader - the chunk of the backend, or null for a core that draws no effect (a test backend)
   * @param changed - the host draws a new frame when a pipeline is ready
   * @param failed - a pipeline did not load
   */
  constructor(
    private readonly loader: PostLoader | null,
    tier: Tier,
    private readonly changed: () => void,
    private readonly failed: (error: unknown) => void,
  ) {
    this.#tier = tier;
  }

  setValue(value: EffectsValue): void {
    this.#value = value;
  }

  setTier(tier: Tier): void {
    this.#tier = tier;
  }

  /** Set the selected entity IDs: the outline draws their objects. */
  select(ids: readonly string[]): void {
    this.#selection = [...ids];
  }

  selection(): readonly string[] {
    return this.#selection;
  }

  /** The names of the effects of the next frame (`activeEffects`); empty for a core with no loader. */
  active(objects: (id: string) => Object3D | undefined): string[] {
    if (this.loader === null) return [];
    return activeEffects(frameEffects(this.#value, this.#tier), this.#selected(objects).length > 0);
  }

  /**
   * Start the load of the pipeline of the next frame when it is not there. The promise resolves when that pipeline
   * can draw, so an answer of the core comes after the first frame with the effects.
   */
  prepare(
    renderer: SceneRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    objects: (id: string) => Object3D | undefined,
  ): Promise<void> {
    const wanted = this.#wanted(camera, objects);
    if (wanted === null || this.#built?.key === wanted.key || this.#failed === wanted.key) return Promise.resolve();
    if (this.#loading?.key === wanted.key) return this.#loading.done;
    const done = this.#load(wanted.key, renderer, scene, camera, wanted.settings);
    this.#loading = { key: wanted.key, done };
    return done;
  }

  /** Draw the frame through the pipeline of its effects. False: the caller draws the frame with no effect. */
  render(
    renderer: SceneRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    objects: (id: string) => Object3D | undefined,
  ): boolean {
    const wanted = this.#wanted(camera, objects);
    if (wanted === null) return false;
    const built = this.#built;
    if (built?.key !== wanted.key && this.#failed !== wanted.key) void this.prepare(renderer, scene, camera, objects);
    if (built?.camera !== camera) return false;
    built.pipeline.render(this.#selected(objects));
    return true;
  }

  dispose(): void {
    this.#disposed = true;
    this.#built?.pipeline.dispose();
    this.#built = null;
  }

  /** The key and the settings of the pipeline of a frame, or null when the frame draws no effect. */
  #wanted(
    camera: PerspectiveCamera,
    objects: (id: string) => Object3D | undefined,
  ): { readonly key: string; readonly settings: PostSettings } | null {
    if (this.loader === null) return null;
    const selection = this.#selected(objects).length > 0;
    const effects = frameEffects(this.#value, this.#tier);
    if (activeEffects(effects, selection).length === 0) return null;
    const settings = postSettings(effects, selection);
    return { key: `${camera.uuid} ${JSON.stringify(settings)}`, settings };
  }

  /** The objects of the selected entities that the scene has. */
  #selected(objects: (id: string) => Object3D | undefined): Object3D[] {
    return this.#selection.map(objects).filter((object): object is Object3D => object !== undefined);
  }

  /**
   * Load the factory and make the pipeline. Keep it when it is the last pipeline that a frame asked for, else drop it.
   * A failure goes to `failed` one time per key, and the frames of that key draw with no effect.
   */
  async #load(
    key: string,
    renderer: SceneRenderer,
    scene: Scene,
    camera: PerspectiveCamera,
    settings: PostSettings,
  ): Promise<void> {
    const loader = this.loader;
    if (loader === null) return;
    let pipeline: PostPipeline;
    try {
      this.#factory ??= loader();
      pipeline = await (await this.#factory)(renderer, scene, camera, settings);
    } catch (error) {
      this.#factory = null;
      this.#failed = key;
      if (this.#loading?.key === key) this.#loading = null;
      this.failed(error);
      return;
    }
    if (this.#disposed || this.#loading?.key !== key) {
      pipeline.dispose();
      return;
    }
    this.#loading = null;
    this.#built?.pipeline.dispose();
    this.#built = { key, camera, pipeline };
    this.changed();
  }
}
