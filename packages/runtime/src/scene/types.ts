// SPDX-License-Identifier: Apache-2.0
/**
 * The contracts of the scene builder: the presenter of a component type, the context that the
 * builder gives to a presenter, and the asset source of the host.
 */
import type { Group, Object3D, Texture } from "three";
import type { MaterialDocument } from "@scenity/scene/schema/material";

/** The kinds of asset that the builder asks for. */
export type AssetKind = "model" | "texture" | "environment" | "material";

/** A loaded material asset: the checked material document. scene/materials.ts makes its three.js material. */
export interface MaterialAsset {
  readonly material: MaterialDocument;
}

/**
 * A loaded asset: a model is an `Object3D`, a texture or an environment map is a `Texture`, a material is a
 * `MaterialAsset`.
 */
export type AssetValue = Object3D | Texture | MaterialAsset;

/**
 * The asset source of the host. `load` gets an asset reference (`asset:<id>`) and its kind. The builder keeps a
 * cache with reference counts, so it calls `load` one time for each asset in use. When the last user of an asset
 * stops, the builder disposes the geometries, materials and textures of the asset, then calls `release`.
 */
export interface AssetSource {
  load(ref: string, kind: AssetKind): Promise<AssetValue>;
  release?(ref: string, kind: AssetKind): void;
  /**
   * The references of the coarser levels of detail of a model, best first. `load` takes each of them. A
   * source with no levels gives an empty list or has no `lods`.
   */
  lods?(ref: string): readonly string[];
}

/** The asset part of the context: each `acquire` needs one `release` with the same reference and kind. */
export interface AssetHandle {
  acquire(ref: string, kind: AssetKind): Promise<AssetValue>;
  release(ref: string, kind: AssetKind): void;
  /** The references of the coarser levels of detail of a model, best first (`AssetSource.lods`). */
  lods?(ref: string): readonly string[];
}

/** The context of a presenter: one context for each entity. */
export interface PresenterContext {
  /** The entity ID. */
  readonly id: string;
  /** The object of the entity. Its local transform comes from the `transform` component. */
  readonly entity: Group;
  readonly assets: AssetHandle;
  /** Add an asynchronous step to the pending work. `SceneBuilder.ready()` waits for it. */
  track(work: Promise<unknown>): void;
  /** The object of an entity, or undefined for an entity that the builder does not hold. */
  entityObject(id: string): Object3D | undefined;
  /** Record a problem that does not stop the build (a failed load, an unknown asset kind). */
  warn(message: string): void;
}

/**
 * The presenter of one component type: it changes a component value into three.js objects. `value` is the
 * component value with the defaults of the registry under it. The builder adds the object of `create` to the
 * entity object and removes it after `dispose`. A presenter that changes only the entity object gives `null`.
 */
export interface Presenter<V = unknown, O extends Object3D | null = Object3D | null> {
  /** The component ID. */
  readonly id: string;
  create(value: V, ctx: PresenterContext): O;
  /**
   * Change the object for a new value. The result `false` tells the builder to dispose the object and create it again.
   */
  update(object: O, value: V, previous: V, ctx: PresenterContext): boolean;
  /** Release the GPU resources of the object that the presenter made. */
  dispose(object: O, ctx: PresenterContext): void;
  /**
   * An optional step after each build or apply, when the world matrices are current. A camera uses it to look at
   * its target.
   */
  layout?(object: O, value: V, ctx: PresenterContext): void;
}
