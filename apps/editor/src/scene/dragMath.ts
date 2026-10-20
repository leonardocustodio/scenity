// SPDX-License-Identifier: Apache-2.0
/**
 * The math of an entity drag on the scene page: the ray of a canvas point from a document camera, its hit on a level
 * plane, and the change of a local position for a move in the world. The camera follows the `camera` presenter of the
 * runtime: the world place of the entity, and a look at its target (a world point or `entity:<id>`), else along -Z of
 * the entity. `pageView` gives the view of the editor camera while it draws, so the drag, the gizmos and the drop
 * follow it. Pure functions, no DOM.
 */
import { qconjugate, qrotate, vadd, vcross, vdot, vnormalize, vscale, vsub, type Vec3 } from "@scenity/scene/math";
import { roundNumber } from "@scenity/scene/canonical";
import { parseRef } from "@scenity/scene/refs";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import { worldTransform } from "@scenity/scene/world";

/** A ray in the world. */
export interface Ray {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** The view of a document camera: its place, the direction of its view and its vertical field of view (degrees). */
export interface CameraView {
  readonly position: Vec3;
  readonly forward: Vec3;
  readonly fov: number;
}

/** The default field of view of the `camera` component (degrees). */
const DEFAULT_FOV = 50;

function isVec3(value: unknown): value is Vec3 {
  return Array.isArray(value) && value.length === 3 && value.every((item) => typeof item === "number");
}

/** The camera entities of each document. An edit makes a new document, so a document never changes. */
const CAMERAS = new WeakMap<SceneDocument, readonly string[]>();

/** The camera entities of a document by ID (the frames of the page read them, so a document keeps its list). */
export function documentCameraIds(doc: SceneDocument): readonly string[] {
  let ids = CAMERAS.get(doc);
  if (ids === undefined) {
    ids = Object.keys(doc.entities)
      .filter((id) => doc.entities[id]?.components.camera !== undefined)
      .sort();
    CAMERAS.set(doc, ids);
  }
  return ids;
}

/** The count of entities of each document. */
const COUNTS = new WeakMap<SceneDocument, number>();

/** The count of entities of a document. */
export function entityCount(doc: SceneDocument): number {
  let count = COUNTS.get(doc);
  if (count === undefined) {
    count = Object.keys(doc.entities).length;
    COUNTS.set(doc, count);
  }
  return count;
}

/** The camera entity of a name (an entity ID or a name), or the first camera by ID for null. */
export function cameraEntity(doc: SceneDocument, name: string | null): string | null {
  const ids = documentCameraIds(doc);
  if (name === null) return ids[0] ?? null;
  return ids.find((id) => id === name || doc.entities[id]?.name === name) ?? null;
}

/** The view of a camera entity, or null when the entity is not a camera. */
export function cameraView(doc: SceneDocument, id: string): CameraView | null {
  const camera = doc.entities[id]?.components.camera as { fov?: unknown; target?: unknown } | undefined;
  const world = worldTransform(doc, id);
  if (camera === undefined || world === undefined) return null;
  const fov = typeof camera.fov === "number" ? camera.fov : DEFAULT_FOV;
  let target: Vec3 | null = isVec3(camera.target) ? camera.target : null;
  const ref = typeof camera.target === "string" ? parseRef(camera.target) : undefined;
  if (ref?.kind === "entity") target = worldTransform(doc, ref.id)?.position ?? null;
  const forward = target === null ? qrotate(world.rotation, [0, 0, -1]) : vnormalize(vsub(target, world.position));
  return { position: world.position, forward, fov };
}

/** A view of the editor camera: a place, a target and a vertical field of view (degrees). */
export interface EditorPose {
  readonly position: readonly [number, number, number];
  readonly target: readonly [number, number, number];
  readonly fov: number;
}

/** What the page tells of its camera: the document camera, and the editor camera while it draws. */
export interface ViewSource {
  /** The name of the document camera of the page (null: the first camera). */
  camera(): string | null;
  /** The view of the editor camera, or null (absent) while a document camera draws. */
  editorView?(): EditorPose | null;
}

/** The view that draws the page now: the editor camera, else the document camera of the page. */
export function pageView(doc: SceneDocument, source: ViewSource): CameraView | null {
  const editor = source.editorView?.() ?? null;
  if (editor !== null) {
    const [position, target]: [Vec3, Vec3] = [[...editor.position], [...editor.target]];
    return { position, forward: vnormalize(vsub(target, position)), fov: editor.fov };
  }
  const camera = cameraEntity(doc, source.camera());
  return camera === null ? null : cameraView(doc, camera);
}

/** The ray of a canvas point (CSS pixels) through a camera view on a canvas of the given size. */
export function viewRay(view: CameraView, x: number, y: number, width: number, height: number): Ray {
  const right = vnormalize(vcross(view.forward, [0, 1, 0]));
  const up = vcross(right, view.forward);
  const tan = Math.tan((view.fov * Math.PI) / 360);
  const aspect = width / Math.max(1, height);
  const ndcX = (2 * x) / Math.max(1, width) - 1;
  const ndcY = 1 - (2 * y) / Math.max(1, height);
  const direction = vadd(view.forward, vadd(vscale(right, ndcX * tan * aspect), vscale(up, ndcY * tan)));
  return { origin: view.position, direction: vnormalize(direction) };
}

/** A world point on the canvas: CSS pixels from the top left corner, and the depth along the view (metres). */
export interface CanvasPoint {
  readonly x: number;
  readonly y: number;
  readonly depth: number;
}

/**
 * The canvas point of a world point through a camera view (the inverse of viewRay), or null for a point behind the
 * camera. The gizmo overlay draws its handles with it.
 */
export function projectPoint(view: CameraView, point: Vec3, width: number, height: number): CanvasPoint | null {
  const right = vnormalize(vcross(view.forward, [0, 1, 0]));
  const up = vcross(right, view.forward);
  const tan = Math.tan((view.fov * Math.PI) / 360);
  const aspect = width / Math.max(1, height);
  const offset = vsub(point, view.position);
  const depth = vdot(offset, view.forward);
  if (depth <= 1e-4) return null;
  const ndcX = vdot(offset, right) / (depth * tan * aspect);
  const ndcY = vdot(offset, up) / (depth * tan);
  return { x: ((ndcX + 1) / 2) * width, y: ((1 - ndcY) / 2) * height, depth };
}

/** The point where a ray meets the level plane at the height `y`, or null when it does not meet it in front. */
export function levelHit(ray: Ray, y: number): Vec3 | null {
  const dy = ray.direction[1];
  if (Math.abs(dy) < 1e-6) return null;
  const t = (y - ray.origin[1]) / dy;
  return t > 0 ? vadd(ray.origin, vscale(ray.direction, t)) : null;
}

/** The change of the local position of an entity for a move of `delta` in the world (through its parent). */
export function localDelta(doc: SceneDocument, id: string, delta: Vec3): Vec3 {
  const parent = doc.entities[id]?.parent ?? null;
  const world = parent === null ? undefined : worldTransform(doc, parent);
  if (world === undefined) return delta;
  const turned = qrotate(qconjugate(world.rotation), delta);
  return [turned[0] / world.scale[0], turned[1] / world.scale[1], turned[2] / world.scale[2]];
}

/**
 * A position with x and z on a grid (metres); y stays. Each value goes on the number grid of the documents too, so the
 * value in memory equals the value after a save and a reload. A grid of 0 snaps to the number grid only.
 */
export function onLevelGrid(position: Vec3, grid: number): Vec3 {
  const snap = (value: number): number => roundNumber(grid > 0 ? Math.round(value / grid) * grid : value);
  return [snap(position[0]), roundNumber(position[1]), snap(position[2])];
}
