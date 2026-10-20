// SPDX-License-Identifier: Apache-2.0
/**
 * The metric context of a scene builder: the facts of the inspect report (inspectScene.ts) and the hooks that need the
 * graph of three.js, for the metric library of `@scenity/rules`. A document core gives its builder
 * (`DocumentCore.builder`), so the metrics run on the scene of a frame with no render: in the dev scene page, in a Bun
 * test and in a tool.
 *
 * - `point`: the world point of a reference through the sub-targets of the runtime (sockets, path points, bones by
 *   their canonical or node names), as for the projected points.
 * - `meshBoxes`: the world box of each own mesh of an entity (not the meshes of its child entities). A skinned mesh
 *   gives the box of its posed vertices.
 * - `raycast`: the entities whose own meshes a segment hits, nearest first. A batched clone keeps its world
 *   matrix, so it hits as its entity.
 */
import { Box3, Raycaster, Vector3, type Intersection, type Mesh, type Object3D, type SkinnedMesh } from "three";
import type { ProjectDocument, SceneDocument } from "@scenity/scene";
import type { SceneBuilder } from "@scenity/runtime";
import { refPoint, shown } from "@scenity/runtime/subTargets";
import { createMetricContext, type AssetStatus, type Box, type MetricContext, type Vec3 } from "@scenity/rules";
import { inspectScene, ownMeshes } from "./inspectScene";

export interface BuilderMetricOptions {
  /** The simulation time of the frame (ms), or null. */
  readonly time?: number | null;
  /** The scene document before the sequence (the walk plans start from it). Default: the document of the builder. */
  readonly base?: SceneDocument;
  readonly project?: ProjectDocument;
  readonly assets?: readonly AssetStatus[];
  /** The data of the plugins by key (the metrics of a plugin read it). */
  readonly data?: Readonly<Record<string, unknown>>;
}

function vec(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

function isSkinned(mesh: Mesh): mesh is SkinnedMesh {
  return (mesh as Partial<SkinnedMesh>).isSkinnedMesh === true;
}

/** The entity objects of a builder by object, and the own meshes of each entity. */
function meshesOf(builder: SceneBuilder): Map<string, Mesh[]> {
  const groups = new Set<Object3D>();
  for (const id of builder.entityIds()) {
    const group = builder.entityObject(id);
    if (group !== undefined) groups.add(group);
  }
  const out = new Map<string, Mesh[]>();
  for (const id of builder.entityIds()) {
    const group = builder.entityObject(id);
    if (group !== undefined && shown(group)) out.set(id, ownMeshes(group, groups));
  }
  return out;
}

/** The world box of a mesh: the posed vertices of a skinned mesh, else the box of its geometry. */
function meshBox(mesh: Mesh): Box | null {
  const box = new Box3().setFromObject(mesh, isSkinned(mesh));
  return box.isEmpty() ? null : { min: vec(box.min), max: vec(box.max) };
}

/** The entities whose meshes the segment `from` → `to` hits, nearest first, each one time. */
function raycastOf(meshes: ReadonlyMap<string, readonly Mesh[]>): (from: Vec3, to: Vec3) => string[] {
  return (from, to) => {
    const start = new Vector3(...from);
    const delta = new Vector3(...to).sub(start);
    const length = delta.length();
    if (length === 0) return [];
    const raycaster = new Raycaster(start, delta.normalize(), 0, length);
    const hits: { id: string; distance: number }[] = [];
    for (const [id, list] of meshes) {
      for (const mesh of list) {
        const found: Intersection[] = [];
        mesh.raycast(raycaster, found);
        for (const hit of found) hits.push({ id, distance: hit.distance });
      }
    }
    hits.sort((a, b) => a.distance - b.distance);
    return [...new Set(hits.map((hit) => hit.id))];
  };
}

/** The metric context of the current scene of a builder. The world matrices update first. */
export function builderMetricContext(builder: SceneBuilder, options: BuilderMetricOptions = {}): MetricContext {
  const facts = inspectScene(builder, options.time ?? null);
  const meshes = meshesOf(builder);
  const boxes = new Map<string, readonly Box[]>();
  return createMetricContext({
    facts,
    scene: builder.document(),
    ...(options.base === undefined ? {} : { base: options.base }),
    ...(options.project === undefined ? {} : { project: options.project }),
    ...(options.assets === undefined ? {} : { assets: options.assets }),
    ...(options.data === undefined ? {} : { data: options.data }),
    point: (ref) => {
      const found = refPoint(builder, ref);
      return found === null ? null : vec(found.at);
    },
    meshBoxes: (id) => {
      let list = boxes.get(id);
      if (list === undefined) {
        list = (meshes.get(id) ?? []).flatMap((mesh) => meshBox(mesh) ?? []);
        boxes.set(id, list);
      }
      return list;
    },
    raycast: raycastOf(meshes),
  });
}
