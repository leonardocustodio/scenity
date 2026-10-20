// SPDX-License-Identifier: Apache-2.0
/**
 * The rules of a snap: from a place of a prop and the snap targets of the room (snapTypes.ts) to the place after the
 * snap. A snap only selects the place values that a drag or a command writes (`room.props.<slot>.at.*` and `.yaw`).
 * Thus undo, the ghosts and "Save placement" stay the same.
 *
 * - **A move drag** puts the prop on the surface under the pointer. This is the nearest surface on the ray of the
 *   pointer that has the prop centre on it (a top of a large prop, a cart top, the floor). The base of the prop goes
 *   to the surface height. A prop that starts within 2 cm of that height keeps its height (the pillow sits a small
 *   distance into the mattress). The 1 cm grid (Shift: 10 cm) stays for the place on the surface. The floor counts
 *   only for a prop that starts on a surface. A prop in the air (lifted to a wall outlet) stays at its height when it
 *   is not on a raised surface.
 * - Then the nearest other target within `SNAP_RADIUS` changes the place. A **wall or a rail** turns the prop so that
 *   its back (the −z side of its box) is on the plane. A **socket** moves the prop so that its nearest port touches
 *   the socket. An **anchor** puts the place of the prop on it (next to the edge of a large prop for its anchors).
 *   Only a prop near the floor goes to an anchor.
 * - Alt during the move disables the snap, and only the grid applies. Alt at the press does not disable the snap,
 *   because it starts a lift.
 *
 * Pure functions: no Vue import, no state between calls.
 */
import type { Vec3 } from "@scenity/character";
import { pickRay, rayAtHeight, type PropBox } from "@scenity/runtime-dev";
import { footprint } from "../edit/footprint";
import { dragPlace, snap, SNAP, type DragStart, type PropPlace } from "../edit/placeDrag";
import { t } from "../../texts";
import {
  frameAt,
  inFrame,
  isEdge,
  socketsOf,
  type EdgeTarget,
  type PointTarget,
  type SnapScene,
  type SnapTarget,
  type SurfaceTarget,
} from "./snapTypes";

/** The radius of a snap to a wall, a rail, a socket or an anchor (metres). */
export const SNAP_RADIUS = 0.08;
/** A prop within this height of a surface sits on it at its own height (metres). */
export const SURFACE_KEEP = 0.02;

/** The dragged prop: its slot, its box in the frame of its place (or null), and its ports. */
export interface SnapProp {
  readonly slot: string;
  readonly box: PropBox | null;
  readonly ports: readonly { readonly name: string; readonly offset: Vec3 }[];
}

/** The place after a snap, the target that changed it (or null) and the surface that the prop sits on (or null). */
export interface Snapped {
  readonly place: PropPlace;
  readonly target: SnapTarget | null;
  readonly surface: SurfaceTarget | null;
}

const GRAIN = 1e4;
const round = (value: number): number => Math.round(value * GRAIN) / GRAIN;
const roundPlace = (at: Vec3, yaw: number): PropPlace => ({
  at: [round(at[0]), round(at[1]), round(at[2])],
  yaw: round(yaw),
});

/** The dragged prop of a slot: the box (from the scene) and the ports of the slot in the room kit. */
export function snapProp(scene: Pick<SnapScene, "kit" | "boxes">, slot: string, box?: PropBox | null): SnapProp {
  const ports = socketsOf(scene.kit, slot).filter((socket) => socket.name.endsWith("_port"));
  return { slot, box: box ?? scene.boxes.get(slot) ?? null, ports };
}

/** True when the point (x, z) is on the rectangle of a surface. */
export function onSurface(surface: SurfaceTarget, point: Vec3): boolean {
  const [x, , z] = inFrame(surface.frame, point);
  const { rect } = surface;
  return x >= rect.minX && x <= rect.maxX && z >= rect.minZ && z <= rect.maxZ;
}

/** The height of a prop that sits on a surface: the surface height, or its own height within SURFACE_KEEP. */
export function surfaceHeight(surface: SurfaceTarget, y: number): number {
  return Math.abs(y - surface.y) <= SURFACE_KEEP ? y : surface.y;
}

/** The yaw that faces a direction (x, z). Of the yaws with one full turn between them, it is the nearest to `near`. */
function facing(normal: readonly [number, number], near: number): number {
  const yaw = Math.atan2(normal[0], normal[1]);
  return yaw + Math.round((near - yaw) / (2 * Math.PI)) * 2 * Math.PI;
}

/** The place of a prop with its back on a wall or a rail, and the distance from the start place. Null off the edge. */
function edgePlace(place: PropPlace, edge: EdgeTarget, prop: SnapProp, reach: number): [PropPlace, number] | null {
  const [ux, uz] = [edge.b[0] - edge.a[0], edge.b[2] - edge.a[2]];
  const length = Math.hypot(ux, uz);
  if (length === 0) return null;
  const along = ((place.at[0] - edge.a[0]) * ux + (place.at[2] - edge.a[2]) * uz) / length;
  if (along < -reach || along > length + reach) return null;
  const clamped = Math.min(length, Math.max(0, along));
  // The back of the box (its −z side) is `back` metres behind the place.
  const back = prop.box === null ? 0 : -prop.box.min[2];
  const [nx, nz] = edge.normal;
  const x = edge.a[0] + (ux / length) * clamped + nx * back;
  const z = edge.a[2] + (uz / length) * clamped + nz * back;
  const next = roundPlace([x, place.at[1], z], facing(edge.normal, place.yaw));
  return [next, Math.hypot(next.at[0] - place.at[0], next.at[2] - place.at[2])];
}

/** The place of a prop whose nearest port touches a socket, and the distance of that port. Null without a port. */
function socketPlace(place: PropPlace, socket: PointTarget, prop: SnapProp): [PropPlace, number] | null {
  let best: [PropPlace, number] | null = null;
  for (const port of prop.ports) {
    const at = frameAt(place, port.offset);
    const gap: Vec3 = [socket.at[0] - at[0], socket.at[1] - at[1], socket.at[2] - at[2]];
    const distance = Math.hypot(...gap);
    if (best !== null && distance >= best[1]) continue;
    best = [roundPlace([place.at[0] + gap[0], place.at[1] + gap[1], place.at[2] + gap[2]], place.yaw), distance];
  }
  return best;
}

/**
 * The place of a prop on an anchor, and the distance on the floor. For an anchor with `away`, the place is next to the
 * edge of the large prop.
 */
function anchorPlace(place: PropPlace, anchor: PointTarget, prop: SnapProp): [PropPlace, number] {
  let [x, z] = [anchor.at[0], anchor.at[2]];
  if (anchor.away !== undefined && prop.box !== null) {
    // The part of the footprint on the side of the large prop. The prop touches the edge from outside.
    const [ax, az] = anchor.away;
    const reach = Math.max(
      0,
      ...footprint(prop.box, place).map(([cx, cz]) => -((cx - place.at[0]) * ax + (cz - place.at[2]) * az)),
    );
    [x, z] = [x + ax * reach, z + az * reach];
  }
  const next = roundPlace([x, place.at[1], z], place.yaw);
  return [next, Math.hypot(next.at[0] - place.at[0], next.at[2] - place.at[2])];
}

/** The place of a prop at a wall, a rail, a socket or an anchor, and the distance. Null when the rule cannot apply. */
export function pointPlace(
  place: PropPlace,
  target: Exclude<SnapTarget, SurfaceTarget>,
  prop: SnapProp,
  reach = Number.POSITIVE_INFINITY,
): [PropPlace, number] | null {
  if (isEdge(target)) return edgePlace(place, target, prop, reach);
  return target.kind === "socket" ? socketPlace(place, target, prop) : anchorPlace(place, target, prop);
}

/** The nearest wall, rail, socket or anchor within the radius of a place (not a target of the prop itself), or null. */
export function nearestTarget(
  place: PropPlace,
  targets: readonly SnapTarget[],
  prop: SnapProp,
  radius = SNAP_RADIUS,
): { readonly place: PropPlace; readonly target: SnapTarget } | null {
  let best: { place: PropPlace; target: SnapTarget; distance: number } | null = null;
  for (const target of targets) {
    if (target.kind === "surface" || target.owner === prop.slot) continue;
    // An anchor is a place on the floor, so a prop on a cart top does not go to it.
    if (target.kind === "anchor" && Math.abs(place.at[1] - target.at[1]) > radius) continue;
    const made = pointPlace(place, target, prop, radius);
    if (made === null || made[1] > radius || (best !== null && made[1] >= best.distance)) continue;
    best = { place: made[0], target, distance: made[1] };
  }
  return best === null ? null : { place: best.place, target: best.target };
}

/** The surface step of a move drag: the nearest surface on the pointer ray with the prop centre on it, or null. */
function surfaceStep(
  start: DragStart,
  x: number,
  y: number,
  step: number,
  surfaces: readonly SurfaceTarget[],
): { readonly place: PropPlace; readonly surface: SurfaceTarget } | null {
  const ray = pickRay(start.camera, x, y);
  const resting = surfaces.some(
    (surface) =>
      surface.owner !== start.slot &&
      onSurface(surface, start.place.at) &&
      Math.abs(start.place.at[1] - surface.y) <= SURFACE_KEEP,
  );
  let best: { place: PropPlace; surface: SurfaceTarget; t: number } | null = null;
  for (const surface of surfaces) {
    // The floor (no owner) applies only to a prop that starts on a surface.
    if (surface.owner === start.slot || (surface.owner === null && !resting)) continue;
    const height = surfaceHeight(surface, start.place.at[1]);
    // The grabbed point moves up or down with the prop, so it stays under the pointer.
    const hit = rayAtHeight(ray, start.grab[1] + height - start.place.at[1]);
    if (hit === null) continue;
    const t = Math.hypot(hit[0] - ray.origin[0], hit[1] - ray.origin[1], hit[2] - ray.origin[2]);
    const at: Vec3 = [
      snap(start.place.at[0] + hit[0] - start.grab[0], step),
      round(height),
      snap(start.place.at[2] + hit[2] - start.grab[2], step),
    ];
    if (!onSurface(surface, at) || (best !== null && t >= best.t)) continue;
    best = { place: { at, yaw: start.place.yaw }, surface, t };
  }
  return best === null ? null : { place: best.place, surface: best.surface };
}

/**
 * The place of a drag with the snap. A move drag snaps to the surface under the pointer, then to the nearest other
 * target within the radius. A turn or a lift drag, and a move with Alt, give the grid place of `dragPlace`.
 */
export function snapDrag(
  start: DragStart,
  x: number,
  y: number,
  keys: { readonly shift: boolean; readonly alt: boolean },
  targets: readonly SnapTarget[],
  prop: SnapProp,
): Snapped {
  if (start.mode !== "move" || keys.alt) return { place: dragPlace(start, x, y, keys), target: null, surface: null };
  const step = keys.shift ? SNAP.moveShift : SNAP.move;
  const surfaces = targets.filter((target): target is SurfaceTarget => target.kind === "surface");
  const sits = surfaceStep(start, x, y, step, surfaces);
  const base = sits?.place ?? dragPlace(start, x, y, keys);
  const near = nearestTarget(base, targets, prop);
  return { place: near?.place ?? base, target: near?.target ?? null, surface: sits?.surface ?? null };
}

/** The surface under a place that is nearest to its height within the radius, or null (the command `prop.snap`). */
function surfaceUnder(place: PropPlace, targets: readonly SnapTarget[], prop: SnapProp): SurfaceTarget | null {
  let best: SurfaceTarget | null = null;
  for (const target of targets) {
    if (target.kind !== "surface" || target.owner === prop.slot || !onSurface(target, place.at)) continue;
    const gap = Math.abs(target.y - place.at[1]);
    if (gap <= SNAP_RADIUS && (best === null || gap < Math.abs(best.y - place.at[1]))) best = target;
  }
  return best;
}

/** The nearest snap of a place without a pointer (the command `prop.snap` with no target): a surface, then a target. */
export function nearestSnap(place: PropPlace, targets: readonly SnapTarget[], prop: SnapProp): Snapped {
  const surface = surfaceUnder(place, targets, prop);
  const base =
    surface === null ? place : roundPlace([place.at[0], surfaceHeight(surface, place.at[1]), place.at[2]], place.yaw);
  const near = nearestTarget(base, targets, prop);
  return { place: near?.place ?? base, target: near?.target ?? null, surface };
}

/**
 * The snap of a place to one target (the command `prop.snap` with a target), at all distances. A place on a surface
 * stays on it. Else the prop goes to the middle of the rectangle of the surface. Throws for a socket when the prop has
 * no port.
 */
export function snapToTarget(place: PropPlace, target: SnapTarget, prop: SnapProp): Snapped {
  if (target.kind === "surface") {
    const y = surfaceHeight(target, place.at[1]);
    if (onSurface(target, place.at))
      return { place: roundPlace([place.at[0], y, place.at[2]], place.yaw), target, surface: target };
    const { rect } = target;
    const middle = frameAt(target.frame, [(rect.minX + rect.maxX) / 2, 0, (rect.minZ + rect.maxZ) / 2]);
    return { place: roundPlace([middle[0], y, middle[2]], place.yaw), target, surface: target };
  }
  const made = pointPlace(place, target, prop);
  if (made === null) {
    throw new Error(
      target.kind === "socket"
        ? t("commands-snap-no-port", { id: target.id, slot: prop.slot })
        : t("commands-snap-not-along", { id: target.id }),
    );
  }
  return { place: made[0], target, surface: null };
}
