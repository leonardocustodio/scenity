// SPDX-License-Identifier: Apache-2.0
/**
 * The debug layers of a scene document: the drawers that read the graph of the scene builder, and the generic data of
 * the floor layers from the document.
 *
 * - bounds: the world box of each entity with geometry (green)
 * - sockets: a cross at each socket point (blue)
 * - skeleton: a line from each bone of a model to its parent bone (white)
 * - normals: a short line along the normal of the vertices of each mesh (light blue), at most `MAX_NORMALS` lines
 * - lights: a helper for each light: a cross, the line to the target, the cone of a spot light, the rings of a point
 *   light (yellow)
 * - cameras: the frustum of each document camera except the camera of the frame, 0.6 m deep (violet)
 * - obstacles and paths (debugLayers.ts): the `obstacle` footprints, the stand points, the walks of the `locomotion`
 *   components and the lines of the `path` components
 *
 * Each drawer reads the objects of the entities. A clone that an instance batch draws stays under its entity,
 * so the drawers see each entity one time and never the batch meshes.
 */
import { Vector3, type Light, type Mesh, type Object3D, type PerspectiveCamera } from "three";
import type { Vec3 } from "@scenity/character/math";
import { floorObstacles, standPlaces } from "@scenity/character/navigation";
import type { FloorRect } from "@scenity/character/place";
import { sceneWalkers } from "@scenity/character/sceneWalks";
import type { SceneBuilder } from "@scenity/runtime";
import { shown, subPoints } from "@scenity/runtime/subTargets";
import {
  DEBUG_COLORS,
  drawBox,
  drawCross,
  type DebugDraw,
  type DebugInput,
  type DevLayer,
  type Rgb,
} from "../devLayers";
import { ownMeshes } from "./inspectScene";

/** The data of the scene layers: the builder with a document, and the camera that draws the frame. */
export interface SceneLayerData {
  readonly builder: SceneBuilder;
  readonly frameCamera: PerspectiveCamera | null;
}

/** The most normal lines of one frame: a mesh with more vertices draws every n-th vertex. */
export const MAX_NORMALS = 20_000;
const NORMAL_LENGTH = 0.05;
const FRUSTUM_DEPTH = 0.6;
const SOCKETS = new Set(["socket"] as const);
const PATH_POINTS = new Set(["pathPoint"] as const);

function vec(v: Vector3): Vec3 {
  return [v.x, v.y, v.z];
}

/** The meshes of each entity, without the objects of child entities. */
function entityMeshes(builder: SceneBuilder): Mesh[] {
  const groups = new Set<Object3D>();
  for (const id of builder.entityIds()) {
    const group = builder.entityObject(id);
    if (group !== undefined) groups.add(group);
  }
  return [...groups].flatMap((group) => ownMeshes(group, groups)).filter((mesh) => shown(mesh));
}

/** A ring of 16 lines about a centre in the plane of two unit axes. */
function ring(draw: DebugDraw, centre: Vector3, u: Vector3, v: Vector3, radius: number, color: Rgb): void {
  const at = (step: number) => {
    const angle = (step / 16) * Math.PI * 2;
    return centre
      .clone()
      .addScaledVector(u, Math.cos(angle) * radius)
      .addScaledVector(v, Math.sin(angle) * radius);
  };
  for (let step = 0; step < 16; step += 1) draw.line(vec(at(step)), vec(at(step + 1)), color);
}

/** Two unit axes at right angles to a direction. */
function sideAxes(direction: Vector3): [Vector3, Vector3] {
  const helper = Math.abs(direction.y) < 0.9 ? new Vector3(0, 1, 0) : new Vector3(1, 0, 0);
  const u = new Vector3().crossVectors(direction, helper).normalize();
  return [u, new Vector3().crossVectors(direction, u).normalize()];
}

/** The helper of one light. */
function drawLight(draw: DebugDraw, light: Light): void {
  const color = DEBUG_COLORS.lights;
  const at = light.getWorldPosition(new Vector3());
  drawCross(draw, vec(at), 0.08, color);
  const target = (light as Partial<{ target: Object3D }>).target;
  if (target !== undefined) {
    const to = target.getWorldPosition(new Vector3());
    draw.line(vec(at), vec(to), color);
    const angle = (light as Partial<{ angle: number }>).angle;
    const length = at.distanceTo(to);
    if (angle !== undefined && length > 0) {
      const direction = to.clone().sub(at).normalize();
      const [u, v] = sideAxes(direction);
      const radius = Math.tan(angle) * length;
      ring(draw, to, u, v, radius, color);
      for (const side of [u, v, u.clone().negate(), v.clone().negate()]) {
        draw.line(vec(at), vec(to.clone().addScaledVector(side, radius)), color);
      }
    }
  } else if ((light as Partial<{ isPointLight: boolean }>).isPointLight === true) {
    const [x, y, z] = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
    ring(draw, at, x, y, 0.15, color);
    ring(draw, at, y, z, 0.15, color);
    ring(draw, at, x, z, 0.15, color);
  } else if ((light as Partial<{ isHemisphereLight: boolean }>).isHemisphereLight === true) {
    draw.line(vec(at), vec(at.clone().add(new Vector3(0, 0.3, 0))), color);
  }
}

/** The frustum of a camera to a depth: four lines from the eye and the rectangle at the depth. */
function drawFrustum(draw: DebugDraw, camera: PerspectiveCamera): void {
  camera.updateMatrixWorld();
  const half = Math.tan(((camera.fov / 2) * Math.PI) / 180) * FRUSTUM_DEPTH;
  const width = half * camera.aspect;
  const corners = [
    [-width, -half],
    [width, -half],
    [width, half],
    [-width, half],
  ].map(([x, y]) => new Vector3(x, y, -FRUSTUM_DEPTH).applyMatrix4(camera.matrixWorld));
  const eye = camera.getWorldPosition(new Vector3());
  corners.forEach((corner, index) => {
    draw.line(vec(eye), vec(corner), DEBUG_COLORS.cameras);
    draw.line(vec(corner), vec(corners[(index + 1) % 4] ?? corner), DEBUG_COLORS.cameras);
  });
  // A short line up from the top edge shows which side is up.
  const top = corners[2]
    ?.clone()
    .add(corners[3] ?? new Vector3())
    .multiplyScalar(0.5);
  if (top !== undefined)
    draw.line(vec(top), vec(top.clone().addScaledVector(camera.up, half * 0.4)), DEBUG_COLORS.cameras);
}

/** The normal lines of the meshes, every n-th vertex so that the frame keeps at most MAX_NORMALS lines. */
function drawNormals(draw: DebugDraw, meshes: readonly Mesh[]): void {
  const total = meshes.reduce((sum, mesh) => sum + mesh.geometry.getAttribute("position").count, 0);
  const step = Math.max(1, Math.ceil(total / MAX_NORMALS));
  const point = new Vector3();
  const normal = new Vector3();
  for (const mesh of meshes) {
    if (!mesh.geometry.hasAttribute("normal")) continue;
    const normals = mesh.geometry.getAttribute("normal");
    const matrix = mesh.matrixWorld;
    for (let index = 0; index < normals.count; index += step) {
      mesh.getVertexPosition(index, point).applyMatrix4(matrix);
      normal.fromBufferAttribute(normals, index).transformDirection(matrix);
      draw.line(vec(point), vec(point.clone().addScaledVector(normal, NORMAL_LENGTH)), DEBUG_COLORS.normals);
    }
  }
}

/** The lines from each bone of the models to its parent bone. */
function drawBones(draw: DebugDraw, builder: SceneBuilder): void {
  const from = new Vector3();
  const to = new Vector3();
  builder.root.traverse((node) => {
    const parent = node.parent;
    if ((node as Partial<{ isBone: boolean }>).isBone !== true || parent === null) return;
    if ((parent as Partial<{ isBone: boolean }>).isBone !== true || !shown(node)) return;
    draw.line(vec(parent.getWorldPosition(from)), vec(node.getWorldPosition(to)), DEBUG_COLORS.white);
  });
}

/** The layers that read the graph of a scene builder. */
export const SCENE_LAYERS: readonly DevLayer<SceneLayerData>[] = [
  {
    name: "skeleton",
    order: 60,
    scene: (draw, _input, { builder }) => {
      drawBones(draw, builder);
    },
  },
  {
    name: "bounds",
    order: 80,
    scene(draw, _input, { builder }) {
      for (const id of builder.entityIds()) {
        const box = builder.bounds(id);
        if (!box.isEmpty()) drawBox(draw, vec(box.min), vec(box.max), DEBUG_COLORS.bounds);
      }
    },
  },
  {
    name: "sockets",
    order: 82,
    scene(draw, _input, { builder }) {
      for (const id of builder.entityIds()) {
        for (const socket of subPoints(builder, id, SOCKETS))
          drawCross(draw, vec(socket.at), 0.04, DEBUG_COLORS.sockets);
      }
    },
  },
  {
    name: "normals",
    order: 84,
    scene: (draw, _input, { builder }) => {
      drawNormals(draw, entityMeshes(builder));
    },
  },
  {
    name: "lights",
    order: 86,
    scene(draw, _input, { builder }) {
      builder.root.traverse((node) => {
        if ((node as Partial<Light>).isLight === true && shown(node)) drawLight(draw, node as Light);
      });
    },
  },
  {
    name: "cameras",
    order: 88,
    scene(draw, _input, { builder, frameCamera }) {
      for (const camera of builder.cameras().values()) if (camera !== frameCamera) drawFrustum(draw, camera);
    },
  },
];

/**
 * The generic data of the floor layers of a scene document: the obstacle footprints (a `bounds` footprint takes the
 * box of the entity), the stand points, the walks of the walkers and the lines of the `path` components.
 */
export function sceneDebugInput(builder: SceneBuilder): DebugInput {
  const doc = builder.document();
  const bounds = (id: string): FloorRect | undefined => {
    const box = builder.bounds(id);
    return box.isEmpty() ? undefined : { minX: box.min.x, maxX: box.max.x, minZ: box.min.z, maxZ: box.max.z };
  };
  const stands = standPlaces(doc).map((place) => ({
    at: place.at,
    face: [place.at[0] + Math.sin(place.yaw), place.at[1] + Math.cos(place.yaw)] as const,
  }));
  const walks = sceneWalkers(doc).flatMap((walker) => walker.plan.legs.map((leg) => ({ path: leg.path })));
  const routes: Vec3[][] = [];
  for (const id of builder.entityIds()) {
    const points = subPoints(builder, id, PATH_POINTS).map((point) => vec(point.at));
    const closed = (doc.entities[id]?.components.path as { closed?: boolean } | undefined)?.closed === true;
    if (points.length > 1) routes.push(closed && points[0] !== undefined ? [...points, points[0]] : points);
  }
  return { obstacles: floorObstacles(doc, { bounds }), stands, walks, routes, figures: [], points: [] };
}
