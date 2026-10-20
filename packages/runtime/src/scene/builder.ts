// SPDX-License-Identifier: Apache-2.0
/**
 * The scene builder. It changes a scene document of `@scenity/scene` into a three.js graph and applies ops to it with
 * no full rebuild.
 *
 * `build` and `apply` are synchronous. They start the model loads and do not wait for them. `ready()` resolves when
 * each pending load has ended. A model appears under its entity at the end of its load. The builder uses no random
 * numbers and no wall clock.
 *
 * The host calls `frame(camera)` before each draw. It picks the level of detail of each model (scene/lod.ts),
 * draws the entities that show the same model as instance batches (scene/instancing.ts) and counts the entities in the
 * view. `bounds` keeps the boxes in a cache until the graph changes.
 *
 * `editMaterials` changes the shared material of material assets (the material editor, scene/materials.ts).
 */
import { Box3, type Group, type PerspectiveCamera } from "three";
import { builtinRegistry, type ComponentRegistry } from "@scenity/scene/components";
import { applyOps } from "@scenity/scene/ops";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SceneOp } from "@scenity/scene/schema/entity";
import type { MaterialDocument } from "@scenity/scene/schema/material";
import { AssetCache, disposeResources } from "./assets";
import { readEnvironment, type SceneEnvironment } from "./environment";
import { countVisible } from "./frameView";
import { EntityGraph, type EntityMap } from "./graph";
import { Instancer } from "./instancing";
import { LodSwitcher } from "./lod";
import { materialCache } from "./materials";
import { builtinPresenters } from "./presenters/index";
import type { PresenterRegistry } from "./registry";
import type { AssetKind, AssetSource, AssetValue } from "./types";

export interface SceneBuilderOptions {
  /** The source of the model, texture and environment assets. */
  readonly assets: AssetSource;
  /** The component registry. The default is a registry of the built-in components. */
  readonly registry?: ComponentRegistry;
  /** The presenter registry. The default is a registry of the built-in presenters. */
  readonly presenters?: PresenterRegistry;
  /** A function that gets each warning (a failed load, a failed presenter). */
  readonly onWarning?: (message: string) => void;
}

/** The result of `apply`: the inverse ops and the warnings, or the index of the first bad op and the reason. */
export type ApplyOutcome =
  | { readonly ok: true; readonly inverse: SceneOp[]; readonly warnings: string[] }
  | { readonly ok: false; readonly index: number; readonly reason: string };

/** The view numbers of the last frame. */
export interface FrameView {
  /** The entities that draw through an instance batch. */
  readonly instances: number;
  /** The instance batches: one draw call for each mesh part of each batch. */
  readonly batches: number;
  /** The shown entities with a model or a shape in the view of the camera. */
  readonly visibleEntities: number;
}

const NO_ENTITIES: EntityMap = {};

export class SceneBuilder {
  readonly registry: ComponentRegistry;
  readonly presenters: PresenterRegistry;
  readonly #assets: AssetCache;
  readonly #graph: EntityGraph;
  readonly #pending = new Set<Promise<unknown>>();
  readonly #warnings: string[] = [];
  readonly #onWarning: ((message: string) => void) | undefined;
  #doc: SceneDocument | undefined;
  #environment: SceneEnvironment;
  #revision = 0;
  readonly #instancer: Instancer;
  readonly #lods: LodSwitcher;
  /** A count of the changes of the graph: an apply, the end of a load, a reload, a level change. */
  #changes = 0;
  /** True when the batches and the levels must see the graph again. */
  #dirty = true;
  readonly #boxes = new Map<string, Box3>();
  #boxesAt = -1;
  #view: FrameView = { instances: 0, batches: 0, visibleEntities: 0 };

  constructor(options: SceneBuilderOptions) {
    this.registry = options.registry ?? builtinRegistry();
    this.presenters = options.presenters ?? builtinPresenters();
    this.#onWarning = options.onWarning;
    const track = (work: Promise<unknown>) => this.#track(work);
    this.#assets = new AssetCache(options.assets, track);
    this.#graph = new EntityGraph({
      registry: this.registry,
      presenters: this.presenters,
      assets: this.#assets,
      track,
      warn: (message) => this.#warn(message),
    });
    this.#environment = readEnvironment(undefined, this.registry, 0);
    this.#instancer = new Instancer(this.#graph.root);
    this.#lods = new LodSwitcher(this.#assets, track);
  }

  /** The scene graph: one `Group` for each root entity under it. The host adds it to its scene. */
  get root(): Group {
    return this.#graph.root;
  }

  /**
   * Build the graph of a document that the reader of `@scenity/scene` checked. After a first build, a second build
   * changes only the entities and the components that differ by reference.
   */
  build(doc: SceneDocument): void {
    this.#commit(this.#doc, doc);
  }

  /** Apply ops to the current document and change only the touched entities. A bad op changes nothing. */
  apply(ops: readonly SceneOp[]): ApplyOutcome {
    const doc = this.document();
    const result = applyOps(doc, ops, this.registry);
    if (!result.ok) return { ok: false, index: result.index, reason: result.reason };
    this.#commit(doc, result.doc);
    return { ok: true, inverse: result.inverse, warnings: result.warnings };
  }

  /**
   * Load the assets of `refs` again and put the new values into each entity that uses them (hot reload in dev). The
   * previous objects stay until the new values are in, so no frame shows a gap. Then the cache disposes the previous
   * geometries, materials and textures. `ready()` waits for the change. A failed load keeps the previous value and
   * warns.
   */
  reload(refs: readonly string[]): void {
    // The levels of detail of a model load again with it.
    const set = new Set(refs.flatMap((ref) => [ref, ...this.#assets.lods(ref)]));
    const swap = this.#assets.renew(set).then(({ old, failed }) => {
      for (const reason of failed) this.#warn(`the asset did not load again: ${reason}`);
      if (this.#doc === undefined) {
        for (const value of old) disposeResources(value);
        return;
      }
      this.#graph.reload(set, this.#doc.entities);
      for (const value of old) disposeResources(value);
      this.#graph.layout();
    });
    this.#track(swap);
  }

  /**
   * Use the edited documents of `docs` (by asset reference) in place of the documents of their material assets. Each
   * entity that uses one of them shows the new values. `ready()` waits for them. A failure warns.
   */
  editMaterials(docs: Readonly<Record<string, MaterialDocument>>): void {
    const cache = materialCache(this.#assets);
    for (const [ref, doc] of Object.entries(docs)) {
      const edit = cache.edit(ref, doc).catch((error: unknown) => {
        this.#warn(`the material ${ref} did not change: ${error instanceof Error ? error.message : String(error)}`);
      });
      this.#track(edit);
    }
  }

  /**
   * Load a model asset for its clips (an animation key of a sequence). `ready()` waits for the load. Each
   * call needs one `releaseModel` later.
   */
  acquireModel(ref: string): Promise<AssetValue> {
    const load = this.#assets.acquire(ref, "model");
    this.#track(load);
    return load;
  }

  /** Remove one user of a model that `acquireModel` loaded. */
  releaseModel(ref: string): void {
    this.#assets.release(ref, "model");
  }

  /** Resolves when each pending load and each pending dispose has ended (also after a failed load). */
  async ready(): Promise<void> {
    while (this.#pending.size > 0) await Promise.all([...this.#pending]);
  }

  /** The current document: the document of `build` with the ops of each `apply` on it. */
  document(): SceneDocument {
    if (this.#doc === undefined) throw new Error("the scene builder has no document: call build first");
    return this.#doc;
  }

  /** The object of an entity, or undefined for an entity that the document does not hold. */
  entityObject(id: string): Group | undefined {
    return this.#graph.nodes.get(id)?.group;
  }

  /** The IDs of the entities in the graph, in sorted order. */
  entityIds(): string[] {
    return [...this.#graph.nodes.keys()].sort();
  }

  /** The component IDs of an entity that the builder holds, in sorted order. */
  componentIds(id: string): string[] {
    return [...(this.#graph.nodes.get(id)?.parts.keys() ?? [])].sort();
  }

  /** The object that the presenter of a component made, or null when the presenter made none. */
  componentObject(id: string, component: string) {
    return this.#graph.nodes.get(id)?.parts.get(component)?.object ?? null;
  }

  /** The document cameras by entity ID, in ID order. */
  cameras(): ReadonlyMap<string, PerspectiveCamera> {
    return new Map([...this.#graph.cameras].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
  }

  /** A document camera by entity ID, or else by the name of the entity. */
  camera(idOrName: string): PerspectiveCamera | undefined {
    const byId = this.#graph.cameras.get(idOrName);
    if (byId !== undefined || this.#doc === undefined) return byId;
    const entities = this.#doc.entities;
    const id = Object.keys(entities).find((key) => entities[key]?.name === idOrName);
    return id === undefined ? undefined : this.#graph.cameras.get(id);
  }

  /** The scene-level values for the host: background, fog, tone mapping, exposure and the environment map. */
  environment(): SceneEnvironment {
    return this.#environment;
  }

  /**
   * The world box of an entity and its subtree, or of the whole scene. A model counts after the end of its load. The
   * box stays in a cache until the graph changes. A host that moves objects in place calls `invalidateBounds`.
   */
  bounds(id?: string): Box3 {
    if (this.#boxesAt !== this.#changes) {
      this.#boxes.clear();
      this.#boxesAt = this.#changes;
      this.root.updateMatrixWorld(true);
    }
    const key = id ?? "";
    let box = this.#boxes.get(key);
    if (box === undefined) {
      const target = id === undefined ? this.root : this.entityObject(id);
      box = target === undefined ? new Box3() : new Box3().setFromObject(target);
      this.#boxes.set(key, box);
    }
    return box.clone();
  }

  /** Clear the cache of the boxes: the host moved objects of the graph in place (the attach keys of a sequence). */
  invalidateBounds(): void {
    this.#changes += 1;
  }

  /**
   * The work of the builder before a draw with `camera`: the level of each model, the instance batches and
   * the count of the entities in the view. The projection of the camera must be current. `userCamera` is true only
   * for a camera under the control of the user. Then the levels use hysteresis, and the frame is not only a
   * function of the documents, the camera and the time (scene/lod.ts).
   */
  frame(camera: PerspectiveCamera, userCamera = false): FrameView {
    const nodes = () => this.#graph.nodes.values();
    this.root.updateMatrixWorld();
    if (this.#dirty) this.#lods.prepare(nodes());
    if (this.#lods.update(camera, userCamera)) this.#changed();
    if (this.#dirty) {
      this.#dirty = false;
      this.#instancer.regroup(nodes());
      this.root.updateMatrixWorld();
    }
    this.#instancer.sync();
    this.#view = { ...this.#instancer.stats(), visibleEntities: countVisible(nodes(), camera) };
    return this.#view;
  }

  /** The view numbers of the last `frame`. */
  view(): FrameView {
    return this.#view;
  }

  /** The level of detail of each model with a `lod` value, by entity ID. */
  lodLevels(): Record<string, number> {
    return this.#lods.levels();
  }

  /** The number of entities that use an asset at this time. */
  assetUsers(ref: string, kind: AssetKind = "model"): number {
    return this.#assets.users(ref, kind);
  }

  /** The warnings since the construction, in order. */
  warnings(): readonly string[] {
    return this.#warnings;
  }

  /** Dispose each object of the graph and release each asset. The builder can build a document again after it. */
  dispose(): void {
    this.#instancer.clear();
    this.#graph.sync(this.#doc?.entities ?? NO_ENTITIES, NO_ENTITIES);
    this.#lods.clear();
    this.#doc = undefined;
    this.#changed();
  }

  #commit(prev: SceneDocument | undefined, next: SceneDocument): void {
    this.#graph.sync(prev?.entities ?? NO_ENTITIES, next.entities);
    if (prev === undefined || prev.environment !== next.environment) {
      this.#revision += 1;
      this.#environment = readEnvironment(next.environment, this.registry, this.#revision);
    }
    this.#doc = next;
    this.#graph.layout();
    this.#changed();
    // The levels of a new model start to load with it, so `ready()` waits for them.
    this.#lods.prepare(this.#graph.nodes.values());
  }

  #changed(): void {
    this.#changes += 1;
    this.#dirty = true;
  }

  #track(work: Promise<unknown>): void {
    const settled = work.then(
      () => undefined,
      () => undefined,
    );
    this.#pending.add(settled);
    void settled.then(() => {
      this.#pending.delete(settled);
      this.#changed();
    });
  }

  #warn(message: string): void {
    this.#warnings.push(message);
    this.#onWarning?.(message);
  }
}
