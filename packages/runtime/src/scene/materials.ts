// SPDX-License-Identifier: Apache-2.0
/**
 * The materials of the material assets: a material document of `@scenity/scene` becomes a three.js material
 * of its type, and a cache shares one material for each asset among the presenters of a scene.
 *
 * - The types: `standard` (MeshStandardMaterial), `physical` (MeshPhysicalMaterial), `lambert`
 *   (MeshLambertMaterial), `phong` (MeshPhongMaterial) and `unlit` (MeshBasicMaterial). The WebGPU core adds the node
 *   materials of the physical, Lambert and Phong materials (render/webgpuMaterials.ts).
 * - A texture slot gets a copy of the texture asset with the colour space, the repeat and the offset of the
 *   reference. The copies share the image of the asset. The material owns its copies and disposes them.
 * - The cache keeps one material for each asset reference, with a count of users, over the asset cache of the
 *   builder: the material document and each texture are assets with their own counts. The last user disposes the
 *   material and releases its assets.
 * - The material editor: `edit` puts an edited document in place of the document of the asset. The material of each
 *   user changes in place when the type stays (materialUpdate.ts). A new type gives a new material. Each `watch`
 *   listener of the asset then gets the material, so a presenter that holds a copy or a mesh can follow. A load of an
 *   asset with an edited document uses the document and loads no file. Thus a new material asset of the editor shows
 *   before the manifest of the page has its record.
 */
import {
  BackSide,
  DoubleSide,
  FrontSide,
  MeshBasicMaterial,
  MeshLambertMaterial,
  MeshPhongMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  NoColorSpace,
  RepeatWrapping,
  SRGBColorSpace,
  type Color,
  type Material,
  type Side,
  type Texture,
  type Vector2,
} from "three";
import {
  MATERIAL_SLOTS,
  materialTextureRefs,
  SLOT_COLOUR_SPACES,
  type MaterialDocument,
  type MaterialSlot,
} from "@scenity/scene/schema/material";
import type { Colour } from "@scenity/scene/schema/common";
import { isMaterialAsset, isTexture, materialTextures } from "./assets";
import { setColour } from "./colour";
import { updateMaterial } from "./materialUpdate";
import type { AssetHandle } from "./types";

/** The property of a three.js material for each texture slot. */
const SLOT_PROPERTIES: Readonly<Record<MaterialSlot, string>> = {
  colour: "map",
  normal: "normalMap",
  roughness: "roughnessMap",
  metalness: "metalnessMap",
  emissive: "emissiveMap",
  occlusion: "aoMap",
  alpha: "alphaMap",
};

const SIDES: Readonly<Record<NonNullable<MaterialDocument["side"]>, Side>> = {
  front: FrontSide,
  back: BackSide,
  double: DoubleSide,
};

/** The colour values of a document and the colour property of the three.js material for each. */
const COLOUR_FIELDS = [
  ["colour", "color"],
  ["emissive", "emissive"],
  ["sheenColour", "sheenColor"],
  ["specularColour", "specularColor"],
  ["specular", "specular"],
] as const;

/** The number values of a document that have the same name in the three.js material. */
const NUMBER_FIELDS = [
  "alphaTest",
  "emissiveIntensity",
  "roughness",
  "metalness",
  "clearcoat",
  "clearcoatRoughness",
  "sheen",
  "sheenRoughness",
  "transmission",
  "thickness",
  "ior",
  "iridescence",
  "specularIntensity",
  "shininess",
] as const;

/** A new material of the type of a document, with no values. */
function materialOfType(type: MaterialDocument["type"]): Material {
  switch (type) {
    case "standard":
      return new MeshStandardMaterial();
    case "physical":
      return new MeshPhysicalMaterial();
    case "lambert":
      return new MeshLambertMaterial();
    case "phong":
      return new MeshPhongMaterial();
    case "unlit":
      return new MeshBasicMaterial();
  }
}

/** A copy of a texture asset for one slot: the colour space, the wrap, the repeat and the offset of the reference. */
function slotTexture(source: Texture, slot: MaterialSlot, doc: MaterialDocument): Texture {
  const ref = doc.maps?.[slot];
  const texture = source.clone();
  texture.colorSpace = (ref?.colorSpace ?? SLOT_COLOUR_SPACES[slot]) === "srgb" ? SRGBColorSpace : NoColorSpace;
  texture.wrapS = RepeatWrapping;
  texture.wrapT = RepeatWrapping;
  if (ref?.repeat !== undefined) texture.repeat.set(...ref.repeat);
  if (ref?.offset !== undefined) texture.offset.set(...ref.offset);
  texture.needsUpdate = true;
  return texture;
}

/**
 * The three.js material of a material document. `textures` gives the loaded texture asset of each reference. The
 * material gets a copy of each one (`slotTexture`).
 */
export function makeMaterial(doc: MaterialDocument, textures: ReadonlyMap<string, Texture>): Material {
  const material = materialOfType(doc.type);
  const target = material as unknown as Record<string, unknown>;
  if (doc.name !== undefined) material.name = doc.name;
  for (const [field, property] of COLOUR_FIELDS) {
    const value: Colour | undefined = doc[field];
    if (value !== undefined) setColour(target[property] as Color, value);
  }
  for (const field of NUMBER_FIELDS) {
    const value = doc[field];
    if (value !== undefined) target[field] = value;
  }
  if (doc.flatShading !== undefined) target.flatShading = doc.flatShading;
  if (doc.normalScale !== undefined) (target.normalScale as Vector2).set(...doc.normalScale);
  material.side = SIDES[doc.side ?? "front"];
  material.opacity = doc.opacity ?? 1;
  material.transparent = material.opacity < 1 || doc.maps?.alpha !== undefined;
  for (const slot of MATERIAL_SLOTS) {
    const ref = doc.maps?.[slot]?.texture;
    const source = ref === undefined ? undefined : textures.get(ref);
    if (source !== undefined) target[SLOT_PROPERTIES[slot]] = slotTexture(source, slot, doc);
  }
  return material;
}

/** Dispose a material of `makeMaterial` and its texture copies. */
export function disposeMaterial(material: Material): void {
  for (const texture of materialTextures(material)) texture.dispose();
  material.dispose();
}

interface MaterialEntry {
  count: number;
  /** The load of the material. An edit with a new type replaces it. */
  load: Promise<Material>;
  /** The texture references that the entry acquired. */
  textures: readonly string[];
  value?: Material;
  released: boolean;
  /** True when the entry acquired the material asset (an edited document needs no file). */
  asset: boolean;
  /** A count of the edits. An edit that ends after a newer edit does nothing. */
  edits: number;
}

/** A listener of the changes of the material of an asset. */
export type MaterialListener = (material: Material) => void;

/** The message of the load of a material that the last user released before its end. */
const RELEASED = "the material was released before the end of its load";

/** The shared materials of the material assets of one scene, over its asset cache. */
export class MaterialCache {
  readonly #assets: AssetHandle;
  readonly #entries = new Map<string, MaterialEntry>();
  /** The edited documents by asset reference. They go in place of the documents of the assets. */
  readonly #edits = new Map<string, MaterialDocument>();
  readonly #listeners = new Map<string, Set<MaterialListener>>();

  constructor(assets: AssetHandle) {
    this.#assets = assets;
  }

  /** Start a load or use the load in the cache, and add one user. Each `acquire` needs one `release`. */
  acquire(ref: string): Promise<Material> {
    let entry = this.#entries.get(ref);
    if (entry === undefined) {
      const state = { count: 0, textures: [], released: false, asset: false, edits: 0 } as Omit<MaterialEntry, "load">;
      const created: MaterialEntry = Object.assign(state, { load: this.#make(ref, state) });
      // A caller that releases before the end sees no error. The presenters handle their own errors.
      created.load.catch(() => undefined);
      this.#entries.set(ref, created);
      entry = created;
    }
    entry.count += 1;
    return entry.load;
  }

  /** Remove one user. The last user disposes the material and releases its assets. */
  release(ref: string): void {
    const entry = this.#entries.get(ref);
    if (entry === undefined) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    this.#entries.delete(ref);
    entry.released = true;
    if (entry.value !== undefined) disposeMaterial(entry.value);
    for (const texture of entry.textures) this.#assets.release(texture, "texture");
    if (entry.asset) this.#assets.release(ref, "material");
  }

  /** The number of users of a material asset (0 when the cache does not hold it). */
  users(ref: string): number {
    return this.#entries.get(ref)?.count ?? 0;
  }

  /**
   * Use `doc` in place of the document of the asset `ref`, immediately and for each later load. The material of the
   * users changes in place, or a new material replaces it for a new type. Then the listeners of `watch` get it. The
   * promise ends when the users have the new values (immediately when the cache does not hold the asset).
   */
  async edit(ref: string, doc: MaterialDocument): Promise<void> {
    this.#edits.set(ref, doc);
    const entry = this.#entries.get(ref);
    if (entry === undefined) return;
    entry.edits += 1;
    const edit = entry.edits;
    await entry.load.catch(() => undefined);
    const refs = materialTextureRefs(doc);
    const textures = await this.#textures(refs);
    const old = entry.value;
    if (entry.released || entry.edits !== edit || old === undefined) {
      for (const texture of refs) this.#assets.release(texture, "texture");
      return;
    }
    const fresh = makeMaterial(doc, textures);
    let material = old;
    if (fresh.type === old.type) updateMaterial(old, fresh);
    else {
      material = fresh;
      entry.value = fresh;
      entry.load = Promise.resolve(fresh);
    }
    for (const texture of entry.textures) this.#assets.release(texture, "texture");
    entry.textures = refs;
    // A listener can watch again (a model applies its overrides again): the loop reads a copy of the set.
    for (const listener of [...(this.#listeners.get(ref) ?? [])]) listener(material);
    // The users of the previous material took the new one: dispose the previous one.
    if (material !== old) disposeMaterial(old);
  }

  /** Call `listener` after each edit of the material of `ref`. The result stops it. */
  watch(ref: string, listener: MaterialListener): () => void {
    const set = this.#listeners.get(ref) ?? new Set<MaterialListener>();
    set.add(listener);
    this.#listeners.set(ref, set);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.#listeners.delete(ref);
    };
  }

  /** Acquire the texture assets of `refs`. A failure releases each of them and throws. */
  async #textures(refs: readonly string[]): Promise<Map<string, Texture>> {
    const loads = refs.map((texture) => this.#assets.acquire(texture, "texture"));
    const settled = await Promise.allSettled(loads);
    const textures = new Map<string, Texture>();
    const problems: string[] = [];
    for (const [index, texture] of refs.entries()) {
      const result = settled[index];
      const value = result?.status === "fulfilled" ? result.value : undefined;
      if (value === undefined || !isTexture(value)) problems.push(`the asset "${texture}" is not a texture`);
      else textures.set(texture, value);
    }
    const problem = problems[0];
    if (problem === undefined) return textures;
    for (const texture of refs) this.#assets.release(texture, "texture");
    throw new Error(problem);
  }

  async #make(ref: string, entry: Omit<MaterialEntry, "load">): Promise<Material> {
    // An edited document goes in place of the document of the asset, with no load of the file.
    let doc = this.#edits.get(ref);
    if (doc === undefined) {
      entry.asset = true;
      const asset = await this.#assets.acquire(ref, "material");
      if (!isMaterialAsset(asset)) throw new Error(`the asset "${ref}" is not a material`);
      doc = this.#edits.get(ref) ?? asset.material;
    }
    if (entry.released) throw new Error(RELEASED);
    const refs = materialTextureRefs(doc);
    entry.textures = refs;
    const loaded = await Promise.all(refs.map((texture) => this.#assets.acquire(texture, "texture")));
    const textures = new Map<string, Texture>();
    refs.forEach((texture, index) => {
      const value = loaded[index];
      if (value === undefined || !isTexture(value)) throw new Error(`the asset "${texture}" is not a texture`);
      textures.set(texture, value);
    });
    const material = makeMaterial(doc, textures);
    if (isReleased(entry)) {
      disposeMaterial(material);
      throw new Error(RELEASED);
    }
    entry.value = material;
    return material;
  }
}

/** True when the last user released the entry (a read after an await: the type checker cannot see the change). */
function isReleased(entry: Pick<MaterialEntry, "released">): boolean {
  return entry.released;
}

/** The material cache of each asset handle: the presenters of one scene share one cache. */
const caches = new WeakMap<AssetHandle, MaterialCache>();

/** The material cache of the asset handle of a presenter context. */
export function materialCache(assets: AssetHandle): MaterialCache {
  let cache = caches.get(assets);
  if (cache === undefined) {
    cache = new MaterialCache(assets);
    caches.set(assets, cache);
  }
  return cache;
}
