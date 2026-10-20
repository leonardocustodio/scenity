// SPDX-License-Identifier: Apache-2.0
/**
 * The presenter outputs of the systems: the values that the systems write in one frame. A
 * presenter or the scene builder applies them after the systems. Each frame starts with empty outputs, so an output
 * is a function of the frame and of the system memory only.
 */
import type { Quat, Vec3 } from "@scenity/scene/math";
import type { Json } from "./types";

/** A transform override of an entity. A part that the override does not hold keeps the value of the document. */
export interface TransformOutput {
  readonly position?: Vec3;
  readonly rotation?: Quat;
  readonly scale?: Vec3;
}

/** The outputs of one entity. `values` holds the pose and material values by a key of the presenter. */
export interface EntityOutput {
  readonly transform?: TransformOutput;
  readonly visible?: boolean;
  readonly values: Readonly<Record<string, Json>>;
}

interface MutableEntityOutput {
  transform?: { position?: Vec3; rotation?: Quat; scale?: Vec3 };
  visible?: boolean;
  values: Record<string, Json>;
}

/** A copy of a JSON value, so a later change of the value of the system does not change the output. */
function copyJson(value: Json): Json {
  return JSON.parse(JSON.stringify(value)) as Json;
}

/** The outputs of one frame. A later write to the same part replaces the earlier write. */
export class PresenterOutputs {
  readonly #byEntity = new Map<string, MutableEntityOutput>();

  #entry(entity: string): MutableEntityOutput {
    let entry = this.#byEntity.get(entity);
    if (entry === undefined) {
      entry = { values: {} };
      this.#byEntity.set(entity, entry);
    }
    return entry;
  }

  /** Override a part of the local transform of an entity. */
  setTransform(entity: string, transform: TransformOutput): void {
    const entry = this.#entry(entity);
    const next = { ...entry.transform };
    if (transform.position !== undefined) next.position = [...transform.position];
    if (transform.rotation !== undefined) next.rotation = [...transform.rotation];
    if (transform.scale !== undefined) next.scale = [...transform.scale];
    entry.transform = next;
  }

  /** Show or hide an entity. */
  setVisible(entity: string, visible: boolean): void {
    this.#entry(entity).visible = visible;
  }

  /** Set a pose or material value of an entity. The presenter of the entity knows the key. */
  setValue(entity: string, key: string, value: Json): void {
    this.#entry(entity).values[key] = copyJson(value);
  }

  /** The outputs of an entity, or undefined when no system wrote to it. */
  get(entity: string): EntityOutput | undefined {
    return this.#byEntity.get(entity);
  }

  /** The IDs of the entities with outputs, in sort order. */
  entities(): string[] {
    return [...this.#byEntity.keys()].sort();
  }

  get size(): number {
    return this.#byEntity.size;
  }

  /** The outputs as plain JSON, with the entity IDs and the value keys in sort order. */
  snapshot(): Record<string, EntityOutput> {
    const out: Record<string, EntityOutput> = {};
    for (const entity of this.entities()) {
      const entry = this.#byEntity.get(entity);
      if (entry === undefined) continue;
      const values: Record<string, Json> = {};
      for (const key of Object.keys(entry.values).sort()) values[key] = copyJson(entry.values[key] ?? null);
      out[entity] = {
        ...(entry.transform === undefined
          ? {}
          : { transform: JSON.parse(JSON.stringify(entry.transform)) as TransformOutput }),
        ...(entry.visible === undefined ? {} : { visible: entry.visible }),
        values,
      };
    }
    return out;
  }
}
