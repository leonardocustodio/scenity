// SPDX-License-Identifier: Apache-2.0
/**
 * The drag of a handle of the scene editor: pure functions from the camera of a pick and the pointer to a point in the
 * room. A handle is a point that a drag moves: a control point of a cable route (useCables.ts) or a hand target
 * (useHandTargets.ts).
 *
 * - **move**: on the horizontal plane through the start point, so the point stays under the pointer (as a prop move of
 *   edit/placeDrag.ts).
 * - **lift** (Alt at the press, as a prop lift): up and down on the vertical line through the start point. One CSS
 *   pixel of the pointer gives one pixel of the room at the distance of the point.
 * - **face**: on the plane through the start point that faces the camera (a small 3D drag of a hand target).
 *
 * `chainDrags` joins the drags of the handles and of the place markers of the team (useTeamPlaces.ts) into the one
 * slot of the scene pointer (edit/scenePointer.ts). The first drag that grabs a press gets its moves and its end.
 *
 * No Vue import: the tests read it.
 */
import type { Vec3 } from "@scenity/character";
import { pickRay, projectPoint, rayAtHeight, type PickCamera } from "@scenity/runtime-dev";
import { snap } from "../edit/placeDrag";
import type { PlaceDrag } from "../edit/scenePointer";

export type HandleMode = "move" | "lift" | "face";

/** A press within this distance of a handle on the screen (CSS pixels) grabs it. */
export const HANDLE_GRAB_PX = 14;

/** The start of a handle drag: the point, the camera of the pick, the pointer and the mode. */
export interface HandleStart {
  readonly at: Vec3;
  readonly camera: PickCamera;
  readonly x: number;
  readonly y: number;
  readonly mode: HandleMode;
}

/** The index of the handle nearest to a point of the canvas within `radius` CSS pixels, or null. */
export function nearestHandle(
  camera: PickCamera,
  points: readonly Vec3[],
  x: number,
  y: number,
  radius = HANDLE_GRAB_PX,
): number | null {
  let best: { index: number; gap: number } | null = null;
  points.forEach((point, index) => {
    const screen = projectPoint(camera, point);
    if (screen === null) return;
    const gap = Math.hypot(screen.x - x, screen.y - y);
    if (gap <= radius && (best === null || gap < best.gap)) best = { index, gap };
  });
  return (best as { index: number } | null)?.index ?? null;
}

/** The size of one CSS pixel at a point of the room (metres), seen with a camera at a point of the canvas. */
export function pixelSizeAt(camera: PickCamera, at: Vec3, x: number, y: number): number {
  const a = pickRay(camera, x, y);
  const b = pickRay(camera, x, y + 1);
  const distance = Math.hypot(at[0] - a.origin[0], at[1] - a.origin[1], at[2] - a.origin[2]);
  return Math.hypot(...([0, 1, 2] as const).map((i) => (a.direction[i] - b.direction[i]) * distance));
}

/** The direction that the camera looks in (the −z axis of its world matrix). */
function forwardOf(camera: PickCamera): Vec3 {
  const [x, y, z] = [-(camera.world[8] ?? 0), -(camera.world[9] ?? 0), -(camera.world[10] ?? 1)];
  const length = Math.hypot(x, y, z) || 1;
  return [x / length, y / length, z / length];
}

/** The point where the ray of a canvas point meets the plane through `at` that faces the camera, or null. */
function facePoint(camera: PickCamera, at: Vec3, x: number, y: number): Vec3 | null {
  const ray = pickRay(camera, x, y);
  const normal = forwardOf(camera);
  const dot = ray.direction[0] * normal[0] + ray.direction[1] * normal[1] + ray.direction[2] * normal[2];
  if (Math.abs(dot) < 1e-9) return null;
  const gap = [at[0] - ray.origin[0], at[1] - ray.origin[1], at[2] - ray.origin[2]] as const;
  const t = (gap[0] * normal[0] + gap[1] * normal[1] + gap[2] * normal[2]) / dot;
  if (t <= 0) return null;
  return [
    ray.origin[0] + ray.direction[0] * t,
    ray.origin[1] + ray.direction[1] * t,
    ray.origin[2] + ray.direction[2] * t,
  ];
}

/** The point of a handle drag for the current pointer, on a grid of `step` metres (0: no grid). */
export function handlePoint(start: HandleStart, x: number, y: number, step: number): Vec3 {
  const { at } = start;
  const round = (value: number): number => (step > 0 ? snap(value, step) : value);
  if (start.mode === "lift") {
    const metres = (y - start.y) * pixelSizeAt(start.camera, at, start.x, start.y);
    return [at[0], round(at[1] - metres), at[2]];
  }
  if (start.mode === "face") {
    const grab = facePoint(start.camera, at, start.x, start.y);
    const now = facePoint(start.camera, at, x, y);
    if (grab === null || now === null) return at;
    return [round(at[0] + now[0] - grab[0]), round(at[1] + now[1] - grab[1]), round(at[2] + now[2] - grab[2])];
  }
  const grab = rayAtHeight(pickRay(start.camera, start.x, start.y), at[1]);
  const now = rayAtHeight(pickRay(start.camera, x, y), at[1]);
  if (grab === null || now === null) return at;
  return [round(at[0] + now[0] - grab[0]), at[1], round(at[2] + now[2] - grab[2])];
}

/**
 * The drags of the handles and the place markers in the one slot of the scene pointer. The chain is active while one
 * drag is active. A press goes to the first active drag that grabs it. Its moves and its end go to that drag only.
 */
export function chainDrags(drags: readonly (PlaceDrag | null)[]): PlaceDrag {
  let held: PlaceDrag | null = null;
  const live = (): PlaceDrag[] => drags.filter((drag): drag is PlaceDrag => drag !== null);
  return {
    active: () => live().some((drag) => drag.active()),
    grab(hit, x, y, propose, keys) {
      held = live().find((drag) => drag.active() && drag.grab(hit, x, y, propose, keys)) ?? null;
      return held !== null;
    },
    move(x, y, keys) {
      held?.move(x, y, keys);
    },
    end(moved) {
      const drag = held;
      held = null;
      drag?.end(moved);
    },
  };
}
