// SPDX-License-Identifier: Apache-2.0
/**
 * The instance batches of the scene builder. The entities that show the same model template with the same material
 * overrides and shadow flags draw as one `InstancedMesh` for each mesh part of the template.
 *
 * - The clone of each entity stays under its entity, so the bounds, the sub-targets and the bounds pick do not change.
 *   Its meshes move to the layer `HIDDEN_LAYER`: the cameras, the shadow cameras and the ray of the pick do not see
 *   them. The batch draws them in their place.
 * - An entity with an `animator`, a `character` or a `locomotion` component keeps its clone: it moves its bones.
 *   A template with a skinned mesh, an `InstancedMesh` (the glTF extension `EXT_mesh_gpu_instancing`) or morph
 *   targets is not in a batch.
 * - `sync` writes the matrix of each shown member from the world matrix of its clone mesh. Only when a matrix changed,
 *   it marks the matrices for the upload and computes the box and the sphere of the batch again. three.js culls
 *   the batch with that sphere, so the sphere always holds each instance.
 * - The `instances` field of the batch mesh gives the entity of each instance, so the pick maps a hit back to its
 *   entity (`instanceHit`).
 *
 * three.js computes the sphere of a skinned mesh one time, in the pose of its first frustum test. After a pose change,
 * three.js can then cull a skinned mesh that is in the view. Thus the skinned meshes of the scene have no frustum cull.
 */
import { Group, InstancedMesh, Matrix4, type Material, type Mesh, type Object3D, type SkinnedMesh } from "three";
import type { ModelValue } from "@scenity/scene/components";
import type { PickTarget } from "../protocolScene";
import type { EntityNode } from "./graph";
import { modelInstance, modelTemplate } from "./presenters/model";

/** The layer of a clone mesh that a batch draws. No camera of the engine sees this layer. */
export const HIDDEN_LAYER = 31;
/** The fewest entities of a batch. One entity draws with its clone. */
export const MIN_BATCH = 2;
/** The components that move the parts of a model. An entity with one of them keeps its clone. */
const MOVERS = ["animator", "character", "locomotion"] as const;

/** One entity of a batch: its entity object, and the meshes of its clone in the order of the template. */
interface Member {
  readonly entity: string;
  readonly group: Object3D;
  readonly meshes: readonly Mesh[];
}

/** The batch of one key: one `InstancedMesh` for each mesh part of the template. */
interface Batch {
  readonly key: string;
  readonly members: readonly Member[];
  readonly parts: readonly InstancedMesh[];
}

/** The numbers of the batches of the last sync. */
export interface InstanceStats {
  /** The entities that draw through a batch. */
  readonly instances: number;
  /** The batches. */
  readonly batches: number;
}

const templateIds = new WeakMap<Object3D, number>();
let nextTemplateId = 1;
const plainTemplates = new WeakMap<Object3D, boolean>();
const relative = new Matrix4();
const rootInverse = new Matrix4();

function templateId(template: Object3D): number {
  let id = templateIds.get(template);
  if (id === undefined) {
    id = nextTemplateId;
    nextTemplateId += 1;
    templateIds.set(template, id);
  }
  return id;
}

function isMesh(object: Object3D): object is Mesh {
  return (object as Partial<Mesh>).isMesh === true;
}

/** The meshes under an object, in traversal order. */
function meshesOf(object: Object3D): Mesh[] {
  const out: Mesh[] = [];
  object.traverse((node) => {
    if (isMesh(node)) out.push(node);
  });
  return out;
}

/** True when each mesh of a template can draw as an instance: no skin, no instances, no morph targets. */
function plain(template: Object3D): boolean {
  let known = plainTemplates.get(template);
  if (known === undefined) {
    const meshes = meshesOf(template);
    known =
      meshes.length > 0 &&
      meshes.every(
        (mesh) =>
          (mesh as Partial<SkinnedMesh>).isSkinnedMesh !== true &&
          (mesh as Partial<InstancedMesh>).isInstancedMesh !== true &&
          Object.keys(mesh.geometry.morphAttributes).length === 0,
      );
    plainTemplates.set(template, known);
  }
  return known;
}

/** True when the object and each of its parents show. */
function shown(object: Object3D): boolean {
  for (let node: Object3D | null = object; node !== null; node = node.parent) {
    if (!node.visible) return false;
  }
  return true;
}

function sameMembers(a: readonly Member[], b: readonly Member[]): boolean {
  return a.length === b.length && a.every((member, index) => member.meshes === b[index]?.meshes);
}

/** The batch key and the member of a node, or null when the node draws with its own clone. */
function memberOf(node: EntityNode, meshCache: WeakMap<Object3D, Mesh[]>): [string, Member] | null {
  const part = node.parts.get("model");
  if (part?.object === null || part === undefined) return null;
  if (MOVERS.some((id) => node.parts.has(id))) return null;
  const clone = modelInstance(part.object);
  const template = modelTemplate(part.object);
  if (clone === undefined || template === undefined || !plain(template)) return null;
  let meshes = meshCache.get(clone);
  if (meshes === undefined) {
    meshes = meshesOf(clone);
    meshCache.set(clone, meshes);
  }
  const value = part.value as ModelValue;
  const shadows = `${String(value.castShadow !== false)}${String(value.receiveShadow !== false)}`;
  const key = `${String(templateId(template))}|${shadows}|${JSON.stringify(value.materials ?? null)}`;
  return [key, { entity: node.id, group: node.group, meshes }];
}

/** No frustum culling for the skinned meshes of a clone (see the module comment). */
function keepSkinned(node: EntityNode): void {
  const holder = node.parts.get("model")?.object;
  const clone = holder === null || holder === undefined ? undefined : modelInstance(holder);
  clone?.traverse((child) => {
    if ((child as Partial<SkinnedMesh>).isSkinnedMesh === true) child.frustumCulled = false;
  });
}

export class Instancer {
  readonly #root: Object3D;
  readonly #holder = new Group();
  #batches = new Map<string, Batch>();
  /** The layer mask of each clone mesh that a batch draws, before the batch took it. */
  readonly #masks = new Map<Mesh, number>();
  readonly #meshCache = new WeakMap<Object3D, Mesh[]>();
  #instances = 0;

  constructor(root: Object3D) {
    this.#root = root;
    this.#holder.name = "instances";
  }

  /** Make the batches again from the nodes of the graph. A batch with the same members stays. */
  regroup(nodes: Iterable<EntityNode>): void {
    const groups = new Map<string, Member[]>();
    for (const node of nodes) {
      keepSkinned(node);
      const found = memberOf(node, this.#meshCache);
      if (found === null) continue;
      const list = groups.get(found[0]);
      if (list === undefined) groups.set(found[0], [found[1]]);
      else list.push(found[1]);
    }
    const next = new Map<string, Batch>();
    for (const [key, members] of groups) {
      if (members.length < MIN_BATCH) continue;
      const old = this.#batches.get(key);
      next.set(key, old !== undefined && sameMembers(old.members, members) ? old : this.#makeBatch(key, members));
    }
    for (const [key, batch] of this.#batches) if (next.get(key) !== batch) this.#dropBatch(batch);
    this.#batches = next;
    this.#adopt();
    if (next.size > 0 && this.#holder.parent !== this.#root) this.#root.add(this.#holder);
    if (next.size === 0) this.#holder.removeFromParent();
  }

  /** Write the matrices of the shown members. The world matrices of the graph must be current. */
  sync(): void {
    rootInverse.copy(this.#root.matrixWorld).invert();
    let instances = 0;
    for (const batch of this.#batches.values()) {
      const shownMembers = batch.members.filter((member) => shown(member.group));
      instances += shownMembers.length;
      batch.parts.forEach((mesh, part) => this.#syncPart(mesh, part, shownMembers));
    }
    this.#instances = instances;
  }

  stats(): InstanceStats {
    return { instances: this.#instances, batches: this.#batches.size };
  }

  /** Remove each batch and restore the layers of each clone mesh. */
  clear(): void {
    for (const batch of this.#batches.values()) this.#dropBatch(batch);
    this.#batches = new Map();
    this.#adopt();
    this.#holder.removeFromParent();
    this.#instances = 0;
  }

  #makeBatch(key: string, members: readonly Member[]): Batch {
    const first = members[0];
    const parts = (first?.meshes ?? []).map((mesh) => {
      const batch = new InstancedMesh(mesh.geometry, mesh.material, members.length);
      batch.name = mesh.name;
      batch.castShadow = mesh.castShadow;
      batch.receiveShadow = mesh.receiveShadow;
      batch.count = 0;
      batch.userData.instances = [] as string[];
      batch.userData.part = mesh.name;
      this.#holder.add(batch);
      return batch;
    });
    return { key, members, parts };
  }

  #dropBatch(batch: Batch): void {
    for (const mesh of batch.parts) {
      mesh.removeFromParent();
      // The geometry and the material belong to the model asset: dispose releases only the instance buffers.
      mesh.dispose();
    }
  }

  /** Put the meshes of the members on the hidden layer, and restore the layers of the other meshes. */
  #adopt(): void {
    const taken = new Set<Mesh>();
    for (const batch of this.#batches.values()) {
      for (const member of batch.members) for (const mesh of member.meshes) taken.add(mesh);
    }
    for (const [mesh, mask] of this.#masks) {
      if (taken.has(mesh)) continue;
      mesh.layers.mask = mask;
      this.#masks.delete(mesh);
    }
    for (const mesh of taken) {
      if (this.#masks.has(mesh)) continue;
      this.#masks.set(mesh, mesh.layers.mask);
      mesh.layers.set(HIDDEN_LAYER);
    }
  }

  /** Write the matrices of one part. The box and the sphere change only when a matrix or the count changed. */
  #syncPart(mesh: InstancedMesh, part: number, members: readonly Member[]): void {
    const array = mesh.instanceMatrix.array as Float32Array;
    const entities = mesh.userData.instances as string[];
    let changed = mesh.count !== members.length;
    members.forEach((member, index) => {
      const source = member.meshes[part];
      if (source === undefined) return;
      relative.multiplyMatrices(rootInverse, source.matrixWorld);
      const offset = index * 16;
      for (let i = 0; i < 16; i += 1) {
        const value = relative.elements[i] ?? 0;
        if (array[offset + i] === Math.fround(value)) continue;
        array[offset + i] = value;
        changed = true;
      }
      entities[index] = member.entity;
    });
    entities.length = members.length;
    // A material change of the first member (an override that loads later) shows in the batch.
    const material: Material | Material[] | undefined = members[0]?.meshes[part]?.material;
    if (material !== undefined) mesh.material = material;
    if (!changed) return;
    mesh.count = members.length;
    mesh.instanceMatrix.needsUpdate = true;
    mesh.computeBoundingBox();
    mesh.computeBoundingSphere();
  }
}

/**
 * The entity, the component and the glTF node of a hit on a batch, from the instance ID of the hit. Null when the
 * object is not a batch of the instancer.
 */
export function instanceHit(
  object: Object3D,
  instanceId: number | undefined,
): { entity: string; component: string; target: PickTarget | null } | null {
  const entities: unknown = object.userData.instances;
  if (!Array.isArray(entities) || instanceId === undefined) return null;
  const entity: unknown = entities[instanceId];
  if (typeof entity !== "string") return null;
  const part: unknown = object.userData.part;
  return {
    entity,
    component: "model",
    target: typeof part === "string" && part !== "" ? { kind: "node", id: part } : null,
  };
}
