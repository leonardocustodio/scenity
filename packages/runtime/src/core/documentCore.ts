// SPDX-License-Identifier: Apache-2.0
/**
 * The document core: a scene core that draws the scene documents of `@scenity/scene` with the scene builder. The same
 * class runs in the generic scene worker (worker/sceneWorker.ts) and on the main thread (documentCoreGl.ts), so the
 * "load" and "patch" messages give the same frames on both paths.
 *
 * - "load" builds the graph of the scene document over the assets of the manifest; "patch" applies ops with no full
 *   rebuild. Each answer comes after the frame that shows the change with each asset that loads.
 * - The core draws with a camera of the document (`useCamera`, the "camera" message). Without a document camera, it
 *   draws with the camera of SceneCore. Before each frame, the safe frame of the camera sets its field of view. The
 *   bounds of the scene give the clip planes that the document does not give (scene/cameraFrame.ts). A "camera"
 *   message with a view puts the editor camera at that view (cameraChoice.ts). The pick, the projected points and the
 *   audio listener also use it.
 * - Before each frame, the tier limits the lights and their shadows, and each shadow camera fits the shadow casters
 *   (scene/lighting.ts). The scene-level values of the document (background, fog, tone mapping, exposure, the
 *   environment map from an equirectangular or a cube texture) go to the scene and the renderer.
 * - The asset report has the load state of each asset by its reference (`asset:<id>`).
 * - A "load" with `reload` (hot reload in dev) loads those assets again from its manifest and swaps them into
 *   each entity and the environment map. The camera, the clock and the document stay.
 * - The pick hits the pickable entities with their hit test and layers, and can name a sub-target (scene/pick.ts).
 *   `setPoints` sets references (`entity:<id>`, `entity:<id>#<sub>`): after each frame, the "anchors" event sends their
 *   projected points from the camera of the frame when a point moves, for HTML overlays.
 * - With a sequence in "load", each frame shows the scene of the sequence at the time of the clock and the animated
 *   models at that time (scene/timeline.ts). A patch then changes the base scene of the sequence. With no sequence,
 *   nothing moves with the time: the core draws a frame for each change. A "load" with only `sequence` (the
 *   sequencer) puts a new sequence over the base scene.
 * - The `plugins` option gives the runtime faces of the project plugins (documentPlugins.ts): their components and
 *   presenters, their simulations in the time line, and their systems in fixed steps. `setInputs` gives them the
 *   input events of the play mode.
 * - Before each draw, the builder selects the level of detail of each model, draws the repeated models as instance
 *   batches and counts the entities in the view (SceneBuilder.frame). The stats carry the counts.
 * - After each frame, the core gives the sounds of the frame to its `audio` event when a value changes
 *   (audio/frames.ts): the voices of the `audioSource` components and the audio tracks, and the camera as the listener.
 * - The effect values of the `environment` component (ambient occlusion, bloom, anti-aliasing, the outline of the
 *   selection of `select`) draw through the pipeline of the backend, under the caps of the tier (effectsHost.ts). A
 *   scene with no effect value draws with no effect. The stats give the names of the effects of the last frame.
 * - With the prefabs of a "load", the core draws and picks the expanded scene (documentPrefabs.ts). A patch changes
 *   the scene before the expansion, and a "load" with only `prefabs` expands it again.
 */
import type { CubeTexture, Object3D, PerspectiveCamera, Texture, ToneMapping } from "three";
import type { SceneRenderer, TextureSupport } from "@scenity/render/types";
import { SceneBuilder } from "../scene/builder";
import { frameLighting } from "../scene/lighting";
import { GraphPicker } from "../scene/pick";
import { refPoint } from "../scene/subTargets";
import type { SceneTimeline } from "../scene/timeline";
import type { AnimatorReport } from "../scene/animate";
import { AudioFrames } from "../audio/frames";
import type { PresenterRegistry } from "../scene/registry";
import type { ManifestFiles } from "../scene/manifestAssets";
import type { AssetSource } from "../scene/types";
import type { ComponentRegistry } from "@scenity/scene/components";
import type { SequenceDocument } from "@scenity/scene/sequence";
import type { InputEvent } from "@scenity/scene/input";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type {
  AssetReport,
  EditorView,
  LoadResult,
  PatchOps,
  PatchResult,
  PickHit,
  PickOptions,
  PointerKind,
  SceneCoreOptions,
  SceneLoad,
  SceneStats,
} from "../protocol";
import { CameraChoice } from "./cameraChoice";
import { DocumentPlugins, type DocumentPluginSource } from "./documentPlugins";
import { DocumentPrefabs } from "./documentPrefabs";
import { stateOf, TrackedAssets } from "./trackedAssets";
import { EffectsHost, type PostLoader } from "./effectsHost";
import { SceneCore, type AnchorPoint } from "./sceneCore";
import { TIERS } from "./tiers";

/** The PMREM maker of a backend: it turns an equirectangular or a cube map into the environment map of the scene. */
export interface EnvironmentMaps {
  fromEquirectangular(texture: Texture): Texture;
  fromCubemap(texture: CubeTexture): Texture;
  dispose(): void;
}

export interface DocumentCoreOptions extends SceneCoreOptions {
  /**
   * The asset source over the records of a manifest and the URLs of their files (scene/manifestAssets.ts). `support`
   * gives the KTX2 target of the backend when the backend is ready.
   */
  readonly assetSource: (manifest: ManifestFiles, support: Promise<TextureSupport>) => AssetSource;
  /** The PMREM maker of the backend. Absent: the scene has no environment map. */
  readonly environmentMaps?: (renderer: SceneRenderer) => EnvironmentMaps;
  /** The component and presenter registries of the plugin host. The default: the built-in ones. */
  readonly registry?: ComponentRegistry;
  readonly presenters?: PresenterRegistry;
  /** The chunk of the effect pipeline of the backend. Absent: the core draws no effect. */
  readonly postEffects?: PostLoader;
  /** The runtime faces of the project plugins (documentPlugins.ts). Absent: no plugins and no plugin cost. */
  readonly plugins?: DocumentPluginSource;
}

/** The renderer values of the tone mapping: both renderers of three.js have them. */
type ToneRenderer = SceneRenderer & { toneMapping: ToneMapping; toneMappingExposure: number };

export class DocumentCore extends SceneCore<unknown, null, AssetReport> {
  readonly builder: SceneBuilder;
  readonly #assets: TrackedAssets;
  readonly #picker = new GraphPicker();
  readonly #maps: EnvironmentMaps | null;
  /** The camera of the frames: a document camera or the editor camera. */
  readonly #camera = new CameraChoice();
  #loaded = false;
  /** The sequence over the scene, or null. */
  #timeline: SceneTimeline | null = null;
  #envRevision = -1;
  #envRef: string | null = null;
  /** True when a reload names the environment map. */
  #envStale = false;
  #envTexture: Texture | null = null;
  /** The manifest, the file URLs and the LOD tier of the loads so far. */
  #manifest: ManifestFiles = { manifest: null, files: {}, tier: "high" };
  /** The answers that wait for the next frame. */
  readonly #drawn: (() => void)[] = [];
  /** The references of the projected points: `entity:<id>` or `entity:<id>#<sub>`. */
  #points: readonly string[] = [];
  /** The audio frames of the core. */
  readonly #audio = new AudioFrames();
  /** The post-processing of the frames. */
  readonly #effects: EffectsHost;
  /** The project plugins and the time lines (the dev core sets the preview clip through them). */
  protected readonly plugins: DocumentPlugins;
  /** The base scene and the prefab set of the instances. */
  readonly #prefabs = new DocumentPrefabs(() => this.builder.registry);
  /**
   * The size of the main view in CSS pixels, or null for the size of the surface. The split view of the dev
   * core sets the box of each pane before its draw, and the box of the main pane after the frame (for the picks).
   */
  protected viewSize: { readonly width: number; readonly height: number } | null = null;
  /** True while the dev core draws the panes of a split view. These frames draw with no effect. */
  protected plainFrames = false;

  constructor(private readonly documentOptions: DocumentCoreOptions) {
    super(documentOptions, null);
    this.#assets = new TrackedAssets(documentOptions.assetSource(this.#manifest, this.#textureSupport()), () => {
      this.invalidate();
    });
    this.builder = new SceneBuilder({
      assets: this.#assets,
      ...(documentOptions.registry === undefined ? {} : { registry: documentOptions.registry }),
      ...(documentOptions.presenters === undefined ? {} : { presenters: documentOptions.presenters }),
    });
    this.plugins = new DocumentPlugins(this.builder, documentOptions.plugins, this);
    this.#maps = documentOptions.environmentMaps?.(this.renderer) ?? null;
    this.#effects = new EffectsHost(
      documentOptions.postEffects ?? null,
      this.tier,
      () => {
        this.invalidate();
      },
      (error) => {
        this.assetFailed("the effect pipeline did not load", error);
      },
    );
    this.scene.add(this.builder.root);
    this.initView();
  }

  /** The built assets of a plugin core: a document core takes its assets from the manifest of "load". */
  override setAssets(): void {
    // The records of the manifest give the assets of the documents.
  }

  /** Load the manifest, then build the scene document; the result comes after the frame that shows them. */
  async load(load: SceneLoad): Promise<LoadResult> {
    const failed = await this.plugins.ready();
    if (failed !== null) return { ok: false, reason: failed };
    this.#useManifest(load);
    this.#reload(load.reload ?? []);
    // The edited material documents of the material editor.
    if (load.materials !== undefined) this.builder.editMaterials(load.materials);
    const before = this.builder.warnings().length;
    const scene = load.documents?.scene;
    if (scene !== undefined) {
      try {
        const shown = this.#prefabs.load(scene, load.documents?.prefabs);
        this.builder.build(shown);
        const sequence = load.documents?.sequence;
        this.#timeline = this.plugins.sceneTimeline(shown, sequence ?? null, () => this.input);
      } catch (error) {
        return { ok: false, reason: error instanceof Error ? error.message : String(error) };
      }
      this.#loaded = true;
    } else if (load.sequence !== undefined && this.#loaded) this.#useSequence(load.sequence);
    else if (load.prefabs !== undefined && this.#loaded) this.#rebase(this.#prefabs.use(load.prefabs, this.#base()));
    await this.#settle();
    return {
      ok: true,
      entities: this.#loaded ? this.builder.entityIds().length : 0,
      warnings: this.builder.warnings().slice(before),
    };
  }

  /** Use a new sequence over the base scene, or null for no sequence; the next frame shows it. */
  #useSequence(sequence: SequenceDocument | null, base = this.#base()): void {
    this.#timeline = this.plugins.sceneTimeline(base, sequence, () => this.input);
    if (this.#timeline === null) this.builder.build(base);
    this.invalidate();
  }

  /** Add input events of the play mode, or replace all of them (documentPlugins.ts); the next frame shows them. */
  setInputs(events: readonly InputEvent[], replace = false): void {
    if (this.plugins.setInputs(events, replace) && this.#timeline !== null) this.#useSequence(this.#timeline.sequence);
    this.invalidate();
  }

  /** The simulation states and the animator layer states of the last frame (none: no sequence). */
  readonly simulations = (): Record<string, unknown> => this.#timeline?.simulations() ?? {};
  readonly animators = (): readonly AnimatorReport[] => this.#timeline?.reports ?? [];

  /** The base scene under the sequence, else the scene of the builder. */
  #base(): SceneDocument {
    return this.#timeline?.base ?? this.builder.document();
  }

  /** Show a new base scene (an expansion of the prefabs), under the sequence when there is one. */
  #rebase(base: SceneDocument): void {
    this.#useSequence(this.#timeline?.sequence ?? null, base);
  }

  /** Apply ops as one transaction; the result comes after the frame that shows the change. */
  async patch(ops: PatchOps): Promise<PatchResult> {
    if (!this.#loaded) return { ok: false, index: 0, reason: "no scene document: load one first" };
    // New documents give new system memory: the steps run again from 0 ms.
    if (ops.length > 0) this.plugins.reset();
    const result =
      this.#prefabs.patch(ops, this.#base(), (shown) => this.#rebase(shown)) ??
      this.#timeline?.edit(ops) ??
      this.builder.apply(ops);
    if (!result.ok) return { ok: false, index: result.index, reason: result.reason };
    await this.#settle();
    return { ok: true, warnings: result.warnings };
  }

  /**
   * Use a document camera by entity ID or name; null for the first one. False when the document has no such camera.
   * With `view`, the editor camera draws at that view; the name stays for a later call without a view.
   */
  useCamera(name: string | null, view?: EditorView): boolean {
    if (name !== null && this.builder.camera(name) === undefined) return false;
    this.#camera.name = name;
    this.#camera.view = view ?? null;
    this.invalidate();
    return true;
  }

  /** Call `draw` with a document camera, then set the camera before it again (the preview); it asks for no frame. */
  protected withDocumentCamera<T>(name: string | null, draw: () => T): T {
    const { name: before, view } = this.#camera;
    this.#camera.name = name !== null && this.builder.camera(name) === undefined ? before : name;
    this.#camera.view = null;
    try {
      return draw();
    } finally {
      this.#camera.name = before;
      this.#camera.view = view;
    }
  }

  /** Call `draw` with the editor camera at `view`, then set the camera before it again (no frame request). */
  protected withEditorView<T>(view: EditorView, draw: () => T): T {
    const { view: before } = this.#camera;
    this.#camera.view = view;
    try {
      return draw();
    } finally {
      this.#camera.view = before;
    }
  }

  /** The pickable entity under a point of the canvas (CSS pixels), or null (with layers and sub-targets). */
  pickEntity(x: number, y: number, options?: PickOptions): PickHit | null {
    if (!this.#loaded) return null;
    const { width, height } = this.viewSize ?? this.surface;
    return this.#picker.pick(this.builder, this.#frameCamera(), x, y, width, height, options);
  }

  /** Set the references of the projected points. The "anchors" event sends their points when they move. */
  setPoints(refs: readonly string[]): void {
    this.#points = [...refs];
    this.invalidate();
  }

  /**
   * Select entities by ID: the outline of the `environment` component draws their objects. The editor
   * selection is not a document value: it is not an op. Use `patch([])` to wait for the frame that shows it.
   */
  select(ids: readonly string[]): void {
    this.#effects.select(ids);
    this.invalidate();
  }

  /** The pointer hit test: the ID of the entity under the pointer. */
  override pointerAt(x: number, y: number, kind: PointerKind): void {
    const id = kind === "leave" ? null : (this.pickEntity(x, y)?.entity ?? null);
    this.hovered = id;
    this.options.events.hit(id, kind);
  }

  override stats(reset: boolean): SceneStats & AssetReport {
    const entities = this.#loaded ? this.builder.entityIds().length : 0;
    // The instance batches and the entities in the view of the last frame.
    const { instances, visibleEntities } = this.builder.view();
    const effects = this.#effects.active(this.#objectOf);
    return { ...super.stats(reset), memory: this.backend.memory(), entities, instances, visibleEntities, effects };
  }

  protected override assetReport(): AssetReport {
    const keys = [...this.#assets.states.keys()].sort();
    const loads = Object.fromEntries(keys.map((key) => [key, this.#assets.states.get(key) ?? "loading"]));
    return { assets: stateOf(this.#loaded, Object.values(loads)), loads };
  }

  /** The scene of the sequence at the time of the clock; a scene with no sequence does not move. */
  protected override updateScene(_input: unknown, simOrNull: number | null): void {
    if (this.#timeline === null) return;
    this.#timeline.at(simOrNull ?? 0);
    // The attach keys move objects in place: the boxes of the builder are stale.
    this.builder.invalidateBounds();
  }

  /** The world point of each reference of `setPoints`, in order. A reference that does not resolve does not show. */
  protected override anchorPoints(): AnchorPoint[] {
    return this.#points.map((id) => {
      const point = this.#loaded ? refPoint(this.builder, id) : null;
      if (point === null) return { id, at: [0, 0, 0], visible: false };
      return { id, at: [point.at.x, point.at.y, point.at.z], visible: point.visible };
    });
  }

  /** The projected points use the camera of the frames. */
  protected override anchorCamera(): PerspectiveCamera {
    return this.#frameCamera();
  }

  protected override saveMemory(): null {
    return null;
  }

  protected override restoreMemory(): void {
    // A document core keeps no frame memory.
  }

  /**
   * Draw with the document camera at the aspect of the canvas. The lights of the tier and the shadow cameras come
   * first, then the safe frame and the clip planes of the camera from the boxes of the frame.
   */
  protected override renderPasses(): void {
    const lighting = frameLighting(this.builder.root, TIERS[this.tier]);
    const camera = this.#frameCamera();
    const { width, height } = this.viewSize ?? this.surface;
    this.#camera.aim(camera, this.#loaded ? this.builder : null, lighting.scene, width / Math.max(1, height));
    // The levels of detail, the instance batches and the count of the entities in the view. A camera of the documents
    // is fixed, so the levels use no hysteresis: a seek gives the frame of a play. Only the editor camera uses the
    // hysteresis, while the user moves it.
    this.builder.frame(camera, this.#camera.userCamera);
    // The effects of the frame, else the frame with no effect.
    if (this.plainFrames || !this.#effects.render(this.renderer, this.scene, camera, this.#objectOf))
      this.backend.render(this.scene, camera);
  }

  /** The tier caps the effects. */
  protected override tierChanged(): void {
    this.#effects.setTier(this.tier);
  }

  /** The object of a loaded entity, for the selection outline. */
  readonly #objectOf = (id: string): Object3D | undefined => (this.#loaded ? this.builder.entityObject(id) : undefined);

  protected override afterFrame(): void {
    this.#sendAudio();
    for (const resolve of this.#drawn.splice(0)) resolve();
  }

  /** Give the sounds of the frame to the `audio` event when a value changed. */
  #sendAudio(): void {
    const events = this.options.events;
    if (events.audio === undefined || !this.#loaded) return;
    const timeline = this.#timeline;
    const frame = this.#audio.next(
      this.builder,
      timeline?.sequence ?? null,
      timeline?.time ?? null,
      this.#frameCamera(),
    );
    if (frame !== null) events.audio(frame);
  }

  protected override disposeScene(): void {
    this.builder.dispose();
    this.#effects.dispose();
    this.#envTexture?.dispose();
    this.#maps?.dispose();
    for (const resolve of this.#drawn.splice(0)) resolve();
  }

  /** Load the assets of `refs` again from the new manifest, in each entity and in the environment map. */
  #reload(refs: readonly string[]): void {
    if (refs.length === 0) return;
    this.builder.reload(refs);
    if (this.#envRef === null || !refs.includes(this.#envRef)) return;
    this.#envStale = true;
    this.#envRevision = -1;
  }

  /** Take the manifest, the file URLs, the tier and the decoders of a load; an absent field keeps its value. */
  #useManifest({ manifest, files, tier, decoders }: SceneLoad): void {
    if (manifest === undefined && files === undefined && tier === undefined && decoders === undefined) return;
    const before = this.#manifest;
    const kept = decoders ?? before.decoders;
    this.#manifest = {
      manifest: manifest === undefined ? before.manifest : manifest,
      files: files ?? before.files,
      tier: tier ?? before.tier,
      ...(kept === undefined ? {} : { decoders: kept }),
    };
    this.#assets.source = this.documentOptions.assetSource(this.#manifest, this.#textureSupport());
  }

  /**
   * The KTX2 target of the backend. The WebGPU device gives its features only when it is ready, so the asset source
   * gets a promise and not the features of a device that does not exist yet.
   */
  #textureSupport(): Promise<TextureSupport> {
    return this.backend.ready.then(() => this.backend.textureSupport());
  }

  /** The camera of the frames: the editor camera, the chosen document camera, the first one, or that of SceneCore. */
  #frameCamera(): PerspectiveCamera {
    return this.#camera.camera(this.builder, this.camera);
  }

  /** Wait for the pending loads, apply the scene-level values, then wait for the frame that shows them. */
  async #settle(): Promise<void> {
    this.invalidate();
    await this.builder.ready();
    await this.#applyEnvironment();
    // The effect pipeline of the next frame loads before the answer.
    this.#effects.setValue(this.builder.environment().effects);
    await this.#effects.prepare(this.renderer, this.scene, this.#frameCamera(), this.#objectOf);
    if (this.disposed) return;
    await new Promise<void>((resolve) => {
      this.#drawn.push(resolve);
      this.invalidate();
    });
  }

  /** The background, the fog, the tone mapping, the exposure and the environment map of the document. */
  async #applyEnvironment(): Promise<void> {
    const environment = this.builder.environment();
    if (environment.revision === this.#envRevision) return;
    this.#envRevision = environment.revision;
    this.scene.background = environment.background;
    this.scene.fog = environment.fog;
    const renderer = this.renderer as ToneRenderer;
    renderer.toneMapping = environment.toneMapping;
    renderer.toneMappingExposure = environment.exposure;
    if (environment.map !== this.#envRef || this.#envStale) await this.#loadEnvironmentMap(environment.map);
    this.scene.environment = this.#envTexture;
    this.scene.environmentIntensity = environment.mapIntensity;
  }

  /**
   * Load the environment map of a reference and make its PMREM. The core removes the map before it only after the new
   * map is ready (a reload shows no frame without a map).
   */
  async #loadEnvironmentMap(ref: string | null): Promise<void> {
    if (this.#envRef !== null && this.#envRef !== ref) this.#assets.states.delete(this.#envRef);
    const old = this.#envTexture;
    this.#envRef = ref;
    this.#envStale = false;
    this.#envTexture = null;
    if (ref !== null && this.#maps !== null) {
      try {
        const source = (await this.#assets.load(ref, "environment")) as Texture;
        // The PMREM generator of WebGPU needs the device (the WebGPU document core).
        await this.backend.ready;
        // An HDR file gives an equirectangular texture; a KTX2 file can give a cube texture.
        this.#envTexture =
          "isCubeTexture" in source
            ? this.#maps.fromCubemap(source as CubeTexture)
            : this.#maps.fromEquirectangular(source);
        source.dispose();
      } catch (error) {
        this.assetFailed(`the environment map ${ref} did not load`, error);
      }
    }
    this.scene.environment = this.#envTexture;
    old?.dispose();
  }
}
