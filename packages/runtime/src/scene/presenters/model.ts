// SPDX-License-Identifier: Apache-2.0
/**
 * The `model` presenter: a holder group that gets a clone of the model asset at the end of its load.
 * The clones share the geometries and the textures of the asset.
 *
 * The material overrides of the parts (presenters/modelOverrides.ts) apply to the clone. A material asset of an
 * override comes from the material cache of the scene (scene/materials.ts). The presenter applies the overrides when
 * each of their material assets has loaded. A patch of the overrides or of the shadow flags changes the same clone.
 * The presenter restores the original materials, disposes the copies and releases the material assets that it no
 * longer uses. Then it applies the new overrides. Only a new model asset makes a new clone.
 *
 * An edit of a material asset of the overrides applies the overrides again. Thus the copies with values get the new
 * values, and a new material (a new type) goes into the meshes.
 */
import { Group, type Material, type Mesh, type Object3D } from "three";
import { clone as cloneSkinned } from "three/examples/jsm/utils/SkeletonUtils.js";
import type { ModelValue } from "@scenity/scene/components";
import { isModel } from "../assets";
import { materialCache } from "../materials";
import type { Presenter, PresenterContext } from "../types";
import { applyOverrides, clearOverrides, overrideMaterialRefs, type OverrideState } from "./modelOverrides";

interface ModelState extends OverrideState {
  value: ModelValue;
  template?: Object3D;
  instance?: Object3D;
  /** The material assets that the overrides acquired. */
  materialRefs: readonly string[];
  /** A count of the override applications: a material load of an older apply does nothing. */
  generation: number;
  /** Stop the watch of the edits of the material assets of the overrides. */
  unwatch: () => void;
  disposed: boolean;
}

const states = new WeakMap<Object3D, ModelState>();

/** Set the shadow flags of each mesh of the clone. */
function applyShadows(state: ModelState): void {
  state.instance?.traverse((node) => {
    if (!(node as Partial<Mesh>).isMesh) return;
    node.castShadow = state.value.castShadow !== false;
    node.receiveShadow = state.value.receiveShadow !== false;
  });
}

/**
 * Apply the overrides of the value to the clone. The presenter acquires the new material assets before it releases
 * the previous ones, so a material asset that both values use stays loaded.
 */
function updateOverrides(state: ModelState, ctx: PresenterContext): void {
  state.generation += 1;
  const generation = state.generation;
  clearOverrides(state);
  const cache = materialCache(ctx.assets);
  const refs = overrideMaterialRefs(state.value.materials);
  const loads = refs.map((ref) => cache.acquire(ref));
  for (const ref of state.materialRefs) cache.release(ref);
  state.materialRefs = refs;
  watchMaterials(state, ctx, refs);
  const instance = state.instance;
  if (instance === undefined) return;
  if (loads.length === 0) {
    applyOverrides(instance, state.value.materials, new Map(), state);
    return;
  }
  const settled = loads.map((load, index) =>
    load.then(
      (material): readonly [string, Material] | null => [refs[index] ?? "", material],
      (error: unknown) => {
        if (generation === state.generation && !state.disposed) {
          ctx.warn(`${ctx.id}: the material "${refs[index] ?? ""}" did not load: ${errorText(error)}`);
        }
        return null;
      },
    ),
  );
  const work = Promise.all(settled).then((pairs) => {
    if (generation !== state.generation || state.disposed || state.instance !== instance) return;
    const loaded = new Map(pairs.filter((pair): pair is readonly [string, Material] => pair !== null));
    applyOverrides(instance, state.value.materials, loaded, state);
  });
  ctx.track(work);
}

/** Apply the overrides again after each edit of one of their material assets. */
function watchMaterials(state: ModelState, ctx: PresenterContext, refs: readonly string[]): void {
  state.unwatch();
  const cache = materialCache(ctx.assets);
  const stops = refs.map((ref) =>
    cache.watch(ref, () => {
      if (!state.disposed) updateOverrides(state, ctx);
    }),
  );
  state.unwatch = () => {
    for (const stop of stops) stop();
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function mount(holder: Group, state: ModelState, ctx: PresenterContext): void {
  if (state.template === undefined) return;
  state.instance = cloneSkinned(state.template);
  applyShadows(state);
  holder.add(state.instance);
  updateOverrides(state, ctx);
}

function startLoad(holder: Group, state: ModelState, ctx: PresenterContext): void {
  const ref = state.value.asset;
  const load = ctx.assets.acquire(ref, "model").then(
    (asset) => {
      if (state.disposed) return;
      if (!isModel(asset)) {
        ctx.warn(`${ctx.id}: the asset "${ref}" is not a model`);
        return;
      }
      state.template = asset;
      mount(holder, state, ctx);
    },
    (error: unknown) => {
      ctx.warn(`${ctx.id}: the model "${ref}" did not load: ${errorText(error)}`);
    },
  );
  ctx.track(load);
}

/** True when two override maps have the same values. */
function sameOverrides(a: ModelValue["materials"], b: ModelValue["materials"]): boolean {
  return a === b || JSON.stringify(a ?? {}) === JSON.stringify(b ?? {});
}

export const modelPresenter: Presenter<ModelValue, Group> = {
  id: "model",
  create(value, ctx) {
    const holder = new Group();
    holder.name = "model";
    const state: ModelState = {
      value,
      originals: new Map(),
      copies: [],
      materialRefs: [],
      generation: 0,
      disposed: false,
      unwatch: () => undefined,
    };
    states.set(holder, state);
    startLoad(holder, state, ctx);
    return holder;
  },
  update(holder, value, previous, ctx) {
    const state = states.get(holder);
    if (state === undefined || value.asset !== previous.asset) return false;
    state.value = value;
    if (value.castShadow !== previous.castShadow || value.receiveShadow !== previous.receiveShadow) {
      applyShadows(state);
    }
    if (!sameOverrides(value.materials, previous.materials)) updateOverrides(state, ctx);
    return true;
  },
  dispose(holder, ctx) {
    const state = states.get(holder);
    if (state === undefined) return;
    state.disposed = true;
    state.unwatch();
    clearOverrides(state);
    const cache = materialCache(ctx.assets);
    for (const ref of state.materialRefs) cache.release(ref);
    state.materialRefs = [];
    state.instance?.removeFromParent();
    delete state.instance;
    states.delete(holder);
    ctx.assets.release(state.value.asset, "model");
  },
};

/** The material copies that the overrides of a model holder made (for the tests and the dev tools). */
export function modelOverrideMaterials(holder: Object3D): readonly Material[] {
  return states.get(holder)?.copies ?? [];
}

/** The meshes of the clone of a model holder, after the end of the load. */
export function modelInstance(holder: Object3D): Object3D | undefined {
  return states.get(holder)?.instance;
}

/** The template of the clone of a model holder: the model asset, or a level of detail of it. */
export function modelTemplate(holder: Object3D): Object3D | undefined {
  return states.get(holder)?.template;
}

/**
 * Show a clone of another template in a model holder (a level of detail of the model asset). The overrides and
 * the shadow flags apply to the new clone. The caller keeps the asset of the template. The result is false when the
 * holder has no loaded model.
 */
export function showModelTemplate(holder: Object3D, template: Object3D, ctx: PresenterContext): boolean {
  const state = states.get(holder);
  if (state === undefined || state.disposed || state.template === undefined) return false;
  if (state.template === template) return true;
  state.template = template;
  state.instance?.removeFromParent();
  mount(holder as Group, state, ctx);
  return true;
}
