// SPDX-License-Identifier: Apache-2.0
/**
 * The drop point of a file on the scene: the point for the base centre of the dropped model. The pick of the core
 * casts the ray of the pointer:
 *
 * - a prop or a device: the hit point, a surface (a model on a trolley stands on its top);
 * - the floor of the room (a hit below FLOOR_HEIGHT): the hit point on the floor;
 * - a wall or a figure (a member): the floor under the hit point;
 * - no hit: the floor plane under the pointer, from the camera of the last pick; no camera yet gives null.
 */
import { pickRay, rayAtHeight, type PickCamera, type PickResult } from "@scenity/runtime-dev";
import type { Vec3 } from "@scenity/character";

/** A hit lower than this (metres) is on the floor. */
export const FLOOR_HEIGHT = 0.02;

export interface DropPoint {
  /** The point in the room (metres, Y up). */
  readonly at: Vec3;
  /** On the floor, or on the surface of a prop. */
  readonly on: "floor" | "surface";
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function floorAt(point: Vec3): DropPoint {
  return { at: [round(point[0]), 0, round(point[2])], on: "floor" };
}

/** The drop point of a pick at the canvas point (x, y), or of the floor plane under it. */
export function dropPoint(pick: PickResult | null, camera: PickCamera | null, x: number, y: number): DropPoint | null {
  if (pick !== null) {
    const [px, py, pz] = pick.point;
    if ((pick.kind === "prop" || pick.kind === "device") && py > FLOOR_HEIGHT) {
      return { at: [round(px), round(py), round(pz)], on: "surface" };
    }
    return floorAt(pick.point);
  }
  if (camera === null) return null;
  const hit = rayAtHeight(pickRay(camera, x, y), 0);
  return hit === null ? null : floorAt(hit);
}
