// SPDX-License-Identifier: Apache-2.0
/**
 * The snap targets of the scene editor: the types of the places of the scene that a prop snaps to, and the frame
 * helpers of the snap rules (snapPlace.ts). The plugin makes the targets of its scene
 * (`EditorPlugin.placement.snapTargets`).
 *
 * - **Surfaces**: the base of a prop sits on them (the floor, the tops of the props).
 * - **Walls and rails**: the back of a prop moves against them.
 * - **Sockets**: a port of the dragged prop touches them.
 * - **Anchors**: the place of a prop goes on them.
 *
 * A target is plain data. This module has no Vue import, because the tests and the commands read it. A function reads
 * the plugin when it runs.
 */
import type { FloorRect, Vec3 } from "@scenity/character";
import type { RoomKit, SocketName } from "../../plugins";
import type { PropBox } from "@scenity/runtime-dev";
import type { PropPlace } from "../edit/placeDrag";
import { editorPlugin } from "../plugin";

interface TargetBase {
  /** The ID of the target, for example `surface:cart`, `wall:head`, `socket:wall_outlet`, `anchor:door`. */
  readonly id: string;
  /** The words of the target for the overlay and the tools, for example "cart top". */
  readonly label: string;
  /** The prop slot that holds the target (a dragged prop does not snap to its own targets), or null. */
  readonly owner: string | null;
  /** The origin of the data of the target. */
  readonly source: string;
}

/** A horizontal surface: a rectangle in the frame of its owner, at a height in the room. */
export interface SurfaceTarget extends TargetBase {
  readonly kind: "surface";
  readonly y: number;
  /** The frame of the rectangle: the place of the owner (the room frame for the floor). */
  readonly frame: PropPlace;
  readonly rect: FloorRect;
}

/** A vertical plane through a horizontal segment `a` → `b`. `normal` (x, z) points to the free side. */
export interface EdgeTarget extends TargetBase {
  readonly kind: "wall" | "rail";
  readonly a: Vec3;
  readonly b: Vec3;
  readonly normal: readonly [number, number];
}

/**
 * A point: a socket (a connector of a prop) or an anchor on the floor. For the anchors at a large prop, `away` (x, z)
 * is the direction from that prop. Thus the prop stands next to its edge, not on it.
 */
export interface PointTarget extends TargetBase {
  readonly kind: "socket" | "anchor";
  readonly at: Vec3;
  readonly away?: readonly [number, number];
}

export type SnapTarget = SurfaceTarget | EdgeTarget | PointTarget;
export type SnapKind = SnapTarget["kind"];

/** True for a wall or a rail. */
export function isEdge(target: SnapTarget): target is EdgeTarget {
  return target.kind === "wall" || target.kind === "rail";
}

/** True for a socket or an anchor. */
export function isPoint(target: SnapTarget): target is PointTarget {
  return target.kind === "socket" || target.kind === "anchor";
}

/** The data that the targets read: the room kit, the tune values with their defaults, and the boxes of the props. */
export interface SnapScene {
  readonly kit: RoomKit;
  readonly tunes: Readonly<Record<string, number>>;
  readonly defaults: ReadonlyMap<string, number>;
  readonly boxes: ReadonlyMap<string, PropBox>;
}

/** A point of a frame in the room (as `framePoint` of `@scenity/character` and the turn of Object3D.rotation.y). */
export function frameAt(frame: PropPlace, local: Vec3): Vec3 {
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  return [frame.at[0] + local[0] * c + local[2] * s, frame.at[1] + local[1], frame.at[2] - local[0] * s + local[2] * c];
}

/** A point of the room in a frame (the inverse of frameAt). */
export function inFrame(frame: PropPlace, point: Vec3): Vec3 {
  const c = Math.cos(frame.yaw);
  const s = Math.sin(frame.yaw);
  const dx = point[0] - frame.at[0];
  const dz = point[2] - frame.at[2];
  return [dx * c - dz * s, point[1] - frame.at[1], dx * s + dz * c];
}

/** True for a socket that is a connector: a port (`*_port`) or an outlet (`wall_outlet`). */
export function isConnector(name: string): boolean {
  return name.endsWith("_port") || name.endsWith("_outlet");
}

/** The sockets of a prop slot (RoomKit.sockets): the names and the offsets in the frame of the prop. */
export function socketsOf(kit: RoomKit, slot: string): { readonly name: SocketName; readonly offset: Vec3 }[] {
  const sockets = (kit.sockets as Readonly<Record<string, Readonly<Partial<Record<SocketName, Vec3>>>>>)[slot] ?? {};
  return (Object.entries(sockets) as [SocketName, Vec3][]).map(([name, offset]) => ({ name, offset }));
}

/** All current snap targets of the scene (from the plugin): surfaces, walls and rails, sockets and anchors. */
export function snapTargets(scene: SnapScene): SnapTarget[] {
  return editorPlugin().placement.snapTargets(scene);
}

/** The target of an ID, or of a unique ID end after the kind (`cart` for `surface:cart`). Else undefined. */
export function targetNamed(targets: readonly SnapTarget[], name: string): SnapTarget | undefined {
  const exact = targets.find((target) => target.id === name);
  if (exact !== undefined) return exact;
  const ends = targets.filter((target) => target.id.slice(target.id.indexOf(":") + 1) === name);
  return ends.length === 1 ? ends[0] : undefined;
}
