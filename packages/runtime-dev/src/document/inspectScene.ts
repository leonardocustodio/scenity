// SPDX-License-Identifier: Apache-2.0
/**
 * The inspect report of a scene document (report.ts) from the graph of the scene builder. It runs in the document core
 * of the dev tools after a frame, and in a Bun test over a builder with no GPU.
 *
 * - The transform is the world matrix of the entity object: a sequence, an animator or a walk moves it.
 * - The bounds come from the cache of the builder (`SceneBuilder.bounds`). The own bounds are the box of the own
 *   meshes of the entity, without its child entities.
 * - The joints are the bones of the model (scene/subTargets.ts of the runtime): a `character` rig gives the canonical
 *   humanoid names, else the node names.
 * - The stats count the own meshes of an entity. A clone that an instance batch draws is on the hidden layer: the
 *   entity is `instanced` and has no draw calls of its own, so the report counts each entity one time.
 * - The parts of a model come from the model asset (the template of the clone), so a material override does
 *   not change the material names.
 */
import { Box3, Quaternion, Vector3, type BufferGeometry, type Mesh, type Object3D } from "three";
import { animatorHolder, modelTemplate, objectMaterials, type SceneBuilder } from "@scenity/runtime";
import { HIDDEN_LAYER } from "@scenity/runtime/instancing";
import { shown, subPoints } from "@scenity/runtime/subTargets";
import type { BoxReport, EntityReport, EntityStats, ModelParts, SceneInspectReport } from "./report";

const SOCKETS = new Set(["socket"] as const);
const BONES = new Set(["bone"] as const);

/** A number rounded to 0.1 mm (or 0.0001 of a unit), with no negative zero. */
export function round4(value: number): number {
  return Math.round(value * 1e4) / 1e4 + 0;
}

function vec(v: Vector3): readonly [number, number, number] {
  return [round4(v.x), round4(v.y), round4(v.z)];
}

/** A box of the report, or null for an empty box. */
export function boxReport(box: Box3): BoxReport | null {
  return box.isEmpty() ? null : { min: vec(box.min), max: vec(box.max) };
}

/** The meshes of an entity object without the objects of its child entities. */
export function ownMeshes(group: Object3D, entityGroups: ReadonlySet<Object3D>): Mesh[] {
  const out: Mesh[] = [];
  const visit = (node: Object3D): void => {
    for (const child of node.children) {
      if (entityGroups.has(child)) continue;
      if ((child as Partial<Mesh>).isMesh === true) out.push(child as Mesh);
      visit(child);
    }
  };
  visit(group);
  return out;
}

/** True for a clone mesh that an instance batch draws: only the hidden layer has it. */
export function batchedClone(mesh: Object3D): boolean {
  return mesh.layers.isEnabled(HIDDEN_LAYER) && !mesh.layers.isEnabled(0);
}

function triangles(geometry: BufferGeometry): number {
  const count = geometry.index?.count ?? geometry.getAttribute("position").count;
  return Math.floor(count / 3);
}

/** The draw stats of the own meshes of an entity. */
function entityStats(meshes: readonly Mesh[], lod: number | undefined): EntityStats {
  let tris = 0;
  let drawCalls = 0;
  let instanced = false;
  for (const mesh of meshes) {
    tris += triangles(mesh.geometry);
    if (batchedClone(mesh)) {
      instanced = true;
      continue;
    }
    if (!shown(mesh)) continue;
    drawCalls += Array.isArray(mesh.material) ? Math.max(1, mesh.geometry.groups.length) : 1;
  }
  return { meshes: meshes.length, triangles: tris, drawCalls, instanced, lod: lod ?? null };
}

/** The world box of a list of meshes (the box of each geometry through the world matrix of its mesh). */
export function meshesBox(meshes: readonly Mesh[]): Box3 {
  const box = new Box3();
  const part = new Box3();
  for (const mesh of meshes) {
    if (mesh.geometry.boundingBox === null) mesh.geometry.computeBoundingBox();
    const local = mesh.geometry.boundingBox;
    if (local === null || local.isEmpty()) continue;
    box.union(part.copy(local).applyMatrix4(mesh.matrixWorld));
  }
  return box;
}

/** The world points of a list of sub-targets by name. */
function pointsByName(
  points: readonly { id: string; at: Vector3 }[],
): Record<string, readonly [number, number, number]> {
  return Object.fromEntries(points.map((point) => [point.id, vec(point.at)]));
}

/** The part names of the model of an entity: each named node with a mesh under it, and each material name. */
function modelParts(builder: SceneBuilder, id: string): ModelParts | null {
  const holder = builder.componentObject(id, "model");
  const template = holder === null ? undefined : modelTemplate(holder);
  if (template === undefined) return null;
  const meshes = new Set<string>();
  const materials = new Set<string>();
  template.traverse((node) => {
    if ((node as Partial<Mesh>).isMesh !== true) return;
    for (const material of objectMaterials(node)) if (material.name !== "") materials.add(material.name);
    for (let part: Object3D | null = node; part !== null && part !== template; part = part.parent) {
      if (part.name !== "") meshes.add(part.name);
    }
  });
  const clips = [...new Set(template.animations.map((clip) => clip.name))].sort();
  const clipSeconds = Object.fromEntries(template.animations.map((clip) => [clip.name, clip.duration]));
  // The clips of the clip source of the animator (the clip browser also lists them).
  const animator = builder.componentObject(id, "animator");
  const source = animator === null ? undefined : animatorHolder(animator)?.source;
  const sourceClips = [...new Set(source?.animations.map((clip) => clip.name) ?? [])].sort();
  // The bone names of the skeletons of the model (for the bone map of the character setup).
  const bones = new Set<string>();
  template.traverse((node) => {
    if ((node as { isBone?: boolean }).isBone === true && node.name !== "") bones.add(node.name);
  });
  return {
    ...{ meshes: [...meshes].sort(), materials: [...materials].sort() },
    ...(clips.length === 0 ? {} : { clips, clipSeconds }),
    ...(sourceClips.length === 0 ? {} : { sourceClips }),
    ...(bones.size === 0 ? {} : { bones: [...bones].sort() }),
  };
}

/** The report of one entity. The world matrices must be current. */
function entityReport(
  builder: SceneBuilder,
  id: string,
  groups: ReadonlySet<Object3D>,
  lods: Readonly<Record<string, number>>,
): EntityReport | null {
  const group = builder.entityObject(id);
  const entity = builder.document().entities[id];
  if (group === undefined || entity === undefined) return null;
  const position = new Vector3();
  const rotation = new Quaternion();
  const scale = new Vector3();
  group.matrixWorld.decompose(position, rotation, scale);
  const bones = subPoints(builder, id, BONES);
  const meshes = ownMeshes(group, groups);
  const parts = modelParts(builder, id);
  return {
    id,
    name: entity.name ?? null,
    parent: entity.parent,
    tags: [...(entity.tags ?? [])],
    components: Object.keys(entity.components).sort(),
    visible: shown(group),
    transform: {
      position: vec(position),
      rotation: [round4(rotation.x), round4(rotation.y), round4(rotation.z), round4(rotation.w)],
      scale: vec(scale),
    },
    bounds: boxReport(builder.bounds(id)),
    ownBounds: boxReport(meshesBox(meshes)),
    sockets: pointsByName(subPoints(builder, id, SOCKETS)),
    joints: bones.length === 0 ? null : pointsByName(bones),
    stats: entityStats(meshes, lods[id]),
    ...(parts === null ? {} : { parts }),
  };
}

/**
 * The inspect report of the scene of a builder. `simMs` is the time of the frame; `layers` gives the debug layers
 * that the core can draw and the layers that are on.
 */
export function inspectScene(
  builder: SceneBuilder,
  simMs: number | null,
  layers: SceneInspectReport["layers"] = { names: [], on: [] },
): SceneInspectReport {
  const ids = builder.entityIds();
  builder.root.updateMatrixWorld(true);
  const groups = new Set<Object3D>();
  for (const id of ids) {
    const group = builder.entityObject(id);
    if (group !== undefined) groups.add(group);
  }
  const lods = builder.lodLevels();
  const entities = ids.flatMap((id) => entityReport(builder, id, groups, lods) ?? []);
  let tris = 0;
  let drawCalls = 0;
  for (const entity of entities) {
    tris += entity.stats.triangles;
    drawCalls += entity.stats.drawCalls;
  }
  return {
    simMs,
    bounds: ids.length === 0 ? null : boxReport(builder.bounds()),
    entities,
    totals: { entities: entities.length, triangles: tris, drawCalls },
    layers: { names: [...layers.names], on: [...layers.on] },
  };
}
