// SPDX-License-Identifier: Apache-2.0
/**
 * The types and the plain math of the pick: the page reads them without three.js. The pick itself (pick.ts) runs in
 * the core. The page casts more rays with the camera of a pick (for a drag), so a drag needs no round trip to the
 * worker.
 */
import type { Vec3 } from "@scenity/character/math";
import { pickKinds, type PickKind } from "./pickKinds";

// `scratch` is a scratch prop of the checkout (scratch.ts); its ID is `scratch-<n>`. The kind is an open string; a
// plugin registers its kinds (pickKinds.ts).
export type { PickKind } from "./pickKinds";

/** A work point of the scene near the hit point. */
export interface PickNear {
  readonly name: string;
  readonly at: Vec3;
  readonly distance: number;
}

/** The camera of a pick. */
export interface PickCamera {
  /** The world matrix of the camera (16 numbers, column-major). */
  readonly world: readonly number[];
  /** The inverse of the projection matrix (16 numbers, column-major). */
  readonly projectionInverse: readonly number[];
  /** The size of the canvas in CSS pixels. */
  readonly width: number;
  readonly height: number;
}

/** What is under a point of the canvas. */
export interface PickResult {
  readonly kind: PickKind;
  /**
   * The prop slot, the scratch prop, the member ID, the ID of an item of a plugin kind, or the name of the room part.
   */
  readonly id: string;
  /** The name of the scene object that the ray hit (a mesh), or the bone of a member. */
  readonly object: string;
  /**
   * The bone of a member (rig spec names: `hand_r`, `lowerarm_l`, …) or of a skinned item of a plugin kind, else null.
   */
  readonly bone: string | null;
  /** The hit point in the room (metres). */
  readonly point: Vec3;
  /** The distance from the camera to the hit point (metres). */
  readonly distance: number;
  /** The work points of the scene within the radius of the pick, the nearest first. */
  readonly near: readonly PickNear[];
  /** The box of a prop or a scratch prop in the frame of its place (before its turn), or null for another kind. */
  readonly local: { readonly min: Vec3; readonly max: Vec3 } | null;
  /** The pane of the split screen; 0 when the page has no panes. */
  readonly pane: number;
  readonly camera: PickCamera;
}

/** What the lab selects: the kind and the ID of a pick. */
export interface SelectTarget {
  readonly kind: PickKind;
  readonly id: string;
}

/** A ray: its start and its unit direction. */
export interface PickRay {
  readonly origin: Vec3;
  readonly direction: Vec3;
}

/** A point through a 4×4 matrix (column-major), with the divide by w. */
function transform(m: readonly number[], p: Vec3): Vec3 {
  const at = (index: number): number => m[index] ?? 0;
  const [x, y, z] = p;
  const w = at(3) * x + at(7) * y + at(11) * z + at(15);
  const scale = w === 0 ? 1 : 1 / w;
  return [
    (at(0) * x + at(4) * y + at(8) * z + at(12)) * scale,
    (at(1) * x + at(5) * y + at(9) * z + at(13)) * scale,
    (at(2) * x + at(6) * y + at(10) * z + at(14)) * scale,
  ];
}

/** The ray of a point of the canvas (CSS pixels from its top left corner) from the camera of a pick. */
export function pickRay(camera: PickCamera, x: number, y: number): PickRay {
  const ndc: Vec3 = [(x / camera.width) * 2 - 1, -(y / camera.height) * 2 + 1, 0.5];
  const origin: Vec3 = [camera.world[12] ?? 0, camera.world[13] ?? 0, camera.world[14] ?? 0];
  const far = transform(camera.world, transform(camera.projectionInverse, ndc));
  const way: Vec3 = [far[0] - origin[0], far[1] - origin[1], far[2] - origin[2]];
  const length = Math.hypot(way[0], way[1], way[2]) || 1;
  return { origin, direction: [way[0] / length, way[1] / length, way[2] / length] };
}

/** The inverse of a 4×4 matrix (column-major), or null for a matrix without an inverse. */
export function invert4(m: readonly number[]): number[] | null {
  const a = (index: number): number => m[index] ?? 0;
  const out = new Array<number>(16).fill(0);
  // The cofactors, as in the inverse of three.js Matrix4 (the elements in column-major order).
  const [n11, n21, n31, n41, n12, n22, n32, n42, n13, n23, n33, n43, n14, n24, n34, n44] = Array.from(
    { length: 16 },
    (_, index) => a(index),
  ) as [
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
    number,
  ];
  const t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44;
  const t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44;
  const t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44;
  const t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
  const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
  if (det === 0) return null;
  const k = 1 / det;
  out[0] = t11 * k;
  out[1] =
    (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * k;
  out[2] =
    (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * k;
  out[3] =
    (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * k;
  out[4] = t12 * k;
  out[5] =
    (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * k;
  out[6] =
    (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * k;
  out[7] =
    (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * k;
  out[8] = t13 * k;
  out[9] =
    (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * k;
  out[10] =
    (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * k;
  out[11] =
    (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * k;
  out[12] = t14 * k;
  out[13] =
    (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * k;
  out[14] =
    (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * k;
  out[15] =
    (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * k;
  return out;
}

/**
 * The point of the canvas (CSS pixels) of a point of the room, seen with the camera of a pick; null behind the camera.
 * The lab gives it to the tools (`screenOf`): a test or an agent picks the place of a joint or a prop.
 */
export function projectPoint(camera: PickCamera, point: Vec3): { x: number; y: number } | null {
  const view = invert4(camera.world);
  const projection = invert4(camera.projectionInverse);
  if (view === null || projection === null) return null;
  const local = transform(view, point);
  if (local[2] >= 0) return null;
  const ndc = transform(projection, local);
  return { x: ((ndc[0] + 1) / 2) * camera.width, y: ((1 - ndc[1]) / 2) * camera.height };
}

/** The point where a ray meets the horizontal plane at the height `y`, or null when it does not meet it ahead. */
export function rayAtHeight(ray: PickRay, y: number): Vec3 | null {
  const dy = ray.direction[1];
  if (Math.abs(dy) < 1e-9) return null;
  const t = (y - ray.origin[1]) / dy;
  if (t <= 0) return null;
  return [ray.origin[0] + ray.direction[0] * t, y, ray.origin[2] + ray.direction[2] * t];
}

/** The work points near a point, the nearest first: at most `max` within `radius` metres. */
export function nearPoints(points: Readonly<Record<string, Vec3>>, at: Vec3, radius = 0.15, max = 6): PickNear[] {
  const out: PickNear[] = [];
  for (const [name, point] of Object.entries(points)) {
    const distance = Math.hypot(point[0] - at[0], point[1] - at[1], point[2] - at[2]);
    if (distance <= radius) out.push({ name, at: point, distance });
  }
  return out.sort((a, b) => a.distance - b.distance || a.name.localeCompare(b.name)).slice(0, max);
}

/** The text of a select target in the URL (`sel=prop:cart`), and back. */
export function selectText(target: SelectTarget): string {
  return `${target.kind}:${target.id}`;
}

/** One item of a selection text (`kind:id`), or null. */
function parseItem(text: string): SelectTarget | null {
  const at = text.indexOf(":");
  const kind: PickKind = text.slice(0, at);
  const id = text.slice(at + 1);
  return at > 0 && pickKinds().includes(kind) && id !== "" ? { kind, id } : null;
}

/** The selected item of a URL text: the first item of a list (`prop:a,prop:b`). */
export function parseSelect(text: string | null): SelectTarget | null {
  return parseSelection(text)[0] ?? null;
}

/**
 * The selected items of a URL text (`sel=prop:a,prop:b`; also one item, `sel=prop:a`), the first item first. The
 * function ignores a part that is not an item, and it keeps each item one time.
 */
export function parseSelection(text: string | null): SelectTarget[] {
  if (text === null) return [];
  const items: SelectTarget[] = [];
  for (const part of text.split(",")) {
    const item = parseItem(part.trim());
    if (item !== null && !items.some((other) => other.kind === item.kind && other.id === item.id)) items.push(item);
  }
  return items;
}

/** The URL text of the selected items (`prop:a,prop:b`), the first item first. */
export function selectionText(items: readonly SelectTarget[]): string {
  return items.map(selectText).join(",");
}
