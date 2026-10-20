// SPDX-License-Identifier: Apache-2.0
/**
 * The asset cache of the builder: one load for each asset in use, with reference counts. When the count of
 * an asset goes to 0, the cache disposes the geometries, materials and textures of the asset and calls the
 * `release` of the source. A release before the end of a load disposes the asset when the load ends.
 *
 * `renew` loads an asset in use again (a new import in dev) and puts the new value in the same entry. The reference
 * counts do not change. The caller disposes the previous values after the users take the new value.
 */
import { Object3D, Texture, type BufferGeometry, type Material } from "three";
import type { AssetHandle, AssetKind, AssetSource, AssetValue, MaterialAsset } from "./types";

interface Entry {
  readonly ref: string;
  readonly kind: AssetKind;
  /** The load of the value. `renew` replaces it. */
  load: Promise<AssetValue>;
  count: number;
  /** The asset after the end of its load. */
  value?: AssetValue;
}

/** The textures of a material: each property value that is a texture. */
export function materialTextures(material: Material): Texture[] {
  return Object.values(material).filter((value): value is Texture => value instanceof Texture);
}

/** The materials of an object that has a `material` field (a mesh, a line or a point cloud). */
export function objectMaterials(object: Object3D): Material[] {
  const material = (object as Object3D & { material?: Material | Material[] }).material;
  if (material === undefined) return [];
  return Array.isArray(material) ? material : [material];
}

/** Dispose each geometry, material and texture under an object, one time each. A material asset holds no GPU data. */
export function disposeResources(value: AssetValue): void {
  if (value instanceof Texture) {
    value.dispose();
    return;
  }
  if (!(value instanceof Object3D)) return;
  const done = new Set<object>();
  const once = (item: { dispose(): void }) => {
    if (done.has(item)) return;
    done.add(item);
    item.dispose();
  };
  value.traverse((node) => {
    const geometry = (node as Object3D & { geometry?: BufferGeometry }).geometry;
    if (geometry !== undefined) once(geometry);
    for (const material of objectMaterials(node)) {
      for (const texture of materialTextures(material)) once(texture);
      once(material);
    }
  });
}

export class AssetCache implements AssetHandle {
  readonly #source: AssetSource;
  readonly #entries = new Map<string, Entry>();
  readonly #track: (work: Promise<unknown>) => void;

  /** `track` gets each dispose that waits for the end of a load. */
  constructor(source: AssetSource, track: (work: Promise<unknown>) => void = () => undefined) {
    this.#source = source;
    this.#track = track;
  }

  /** Start a load or use the load in the cache, and add one user. */
  acquire(ref: string, kind: AssetKind): Promise<AssetValue> {
    const key = `${kind}|${ref}`;
    let entry = this.#entries.get(key);
    if (entry === undefined) {
      const load = this.#source.load(ref, kind);
      const created: Entry = { ref, kind, load, count: 0 };
      void load.then(
        (value) => {
          if (created.load === load) created.value = value;
        },
        () => undefined,
      );
      entry = created;
      this.#entries.set(key, entry);
    }
    entry.count += 1;
    return entry.load;
  }

  /** Remove one user. The last user disposes the asset, immediately or at the end of its load. */
  release(ref: string, kind: AssetKind): void {
    const key = `${kind}|${ref}`;
    const entry = this.#entries.get(key);
    if (entry === undefined) return;
    entry.count -= 1;
    if (entry.count > 0) return;
    this.#entries.delete(key);
    const free = (value: AssetValue) => {
      disposeResources(value);
      this.#source.release?.(ref, kind);
    };
    if (entry.value !== undefined) free(entry.value);
    else this.#track(entry.load.then(free, () => undefined));
  }

  /**
   * Load each asset in use with a reference in `refs` again. The new value goes into the same entry, so the reference
   * counts do not change. The result has the previous value of each renewed entry and the reason of each failed load.
   * A failed load keeps the previous value. A new user after the call gets the new value.
   */
  async renew(refs: ReadonlySet<string>): Promise<{ readonly old: AssetValue[]; readonly failed: string[] }> {
    const old: AssetValue[] = [];
    const failed: string[] = [];
    const renewOne = async (key: string, entry: Entry): Promise<void> => {
      // Wait for the load before it, so that its value does not come after the new value.
      await entry.load.catch(() => undefined);
      let value: AssetValue;
      try {
        value = await this.#source.load(entry.ref, entry.kind);
      } catch (error) {
        failed.push(`${entry.ref}: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (this.#entries.get(key) !== entry) {
        // The last user stopped during the load: the new value has no user.
        disposeResources(value);
        return;
      }
      if (entry.value !== undefined) old.push(entry.value);
      entry.load = Promise.resolve(value);
      entry.value = value;
    };
    const jobs = [...this.#entries].filter(([, entry]) => refs.has(entry.ref));
    await Promise.all(jobs.map(([key, entry]) => renewOne(key, entry)));
    return { old, failed };
  }

  /** The references of the coarser levels of detail of a model, from the source. */
  lods(ref: string): readonly string[] {
    return this.#source.lods?.(ref) ?? [];
  }

  /** The number of users of an asset (0 when the cache does not hold it). */
  users(ref: string, kind: AssetKind = "model"): number {
    return this.#entries.get(`${kind}|${ref}`)?.count ?? 0;
  }

  /** The assets in the cache, as `<kind>|<ref>` keys in sorted order. */
  keys(): string[] {
    return [...this.#entries.keys()].sort();
  }
}

/** True when a loaded asset is a model. */
export function isModel(value: AssetValue): value is Object3D {
  return value instanceof Object3D;
}

/** True when a loaded asset is a texture. */
export function isTexture(value: AssetValue): value is Texture {
  return value instanceof Texture;
}

/** True when a loaded asset is a material asset. */
export function isMaterialAsset(value: AssetValue): value is MaterialAsset {
  return !(value instanceof Object3D) && !(value instanceof Texture) && "material" in value;
}
