// SPDX-License-Identifier: Apache-2.0
/**
 * The drag of a prop place: pure functions from a pick and the pointer to the tune values of the place
 * (`room.props.<slot>.at.<axis>` and `.yaw`). A drag never moves a scene object. It changes the tune values, so a
 * frame stays a function of its input. Thus the same values in the URL give the same frame.
 *
 * The keys at the press set the mode of a drag. With no key, the prop moves across the floor, on the horizontal plane
 * through the grabbed point. Thus that point stays under the pointer. Shift turns the prop, and Alt lifts it. During a
 * move, Shift snaps to 10 cm (else 1 cm). During a turn, Alt snaps to 1° (else 15°).
 */
import type { Vec3 } from "@scenity/character";
import { pickRay, rayAtHeight, withTune, type PickCamera } from "@scenity/runtime-dev";

export type DragMode = "move" | "turn" | "lift";

/** The place of a prop: its position and its turn around the vertical axis (radians). */
export interface PropPlace {
  readonly at: Vec3;
  readonly yaw: number;
}

/** The start of a drag: the slot, its place, the grabbed point, the camera of the pick and the pointer. */
export interface DragStart {
  readonly slot: string;
  readonly mode: DragMode;
  readonly place: PropPlace;
  readonly grab: Vec3;
  readonly camera: PickCamera;
  readonly x: number;
  readonly y: number;
}

/** The snap steps (metres, degrees) of a drag. */
export const SNAP = { move: 0.01, moveShift: 0.1, turnDeg: 15, turnAltDeg: 1, lift: 0.01 } as const;
/** A horizontal drag of this many CSS pixels turns the prop a quarter turn. */
const TURN_PIXELS = 300;
const DEG = Math.PI / 180;

/** The tune paths of the place of a prop slot. */
export function placePaths(slot: string): { readonly at: readonly [string, string, string]; readonly yaw: string } {
  const base = `room.props.${slot}`;
  return { at: [`${base}.at.0`, `${base}.at.1`, `${base}.at.2`], yaw: `${base}.yaw` };
}

/** The place of a slot from the tune values, else from the defaults. Null for a slot without a tuned place. */
export function placeOf(
  slot: string,
  tunes: Readonly<Record<string, number>>,
  defaults: ReadonlyMap<string, number>,
): PropPlace | null {
  const paths = placePaths(slot);
  const value = (path: string): number | undefined => tunes[path] ?? defaults.get(path);
  const [x, y, z, yaw] = [...paths.at.map(value), value(paths.yaw)];
  if (x === undefined || y === undefined || z === undefined || yaw === undefined) return null;
  return { at: [x, y, z], yaw };
}

/** A value on a grid of `step`, rounded to 0.1 mm. Thus the numbers in the code have no float noise. */
export function snap(value: number, step: number): number {
  return Math.round(Math.round(value / step) * step * 1e4) / 1e4;
}

/**
 * The rounding of a turn (radians): 4 decimals, as `labs tune-apply` writes a number (numberText). Thus the place that
 * "Save placement" writes into the code is equal to the tuned place.
 */
const TURN_ROUND = 1e4;

/** A turn on a grid of degrees (radians, rounded to TURN_ROUND). */
export function snapTurn(yaw: number, stepDeg: number): number {
  return Math.round(Math.round(yaw / (stepDeg * DEG)) * stepDeg * DEG * TURN_ROUND) / TURN_ROUND;
}

/** The new place of a drag for the current pointer and the current keys. */
export function dragPlace(start: DragStart, x: number, y: number, keys: { shift: boolean; alt: boolean }): PropPlace {
  const { place } = start;
  if (start.mode === "turn") {
    // The turn changes in steps from the start turn. Thus the prop keeps the part of its turn that is not on the grid.
    const turn = snapTurn(-((x - start.x) / TURN_PIXELS) * (Math.PI / 2), keys.alt ? SNAP.turnAltDeg : SNAP.turnDeg);
    return { at: place.at, yaw: roundTurn(place.yaw + turn) };
  }
  if (start.mode === "lift") {
    const metres = (y - start.y) * pixelSize(start);
    return { at: [place.at[0], Math.max(0, snap(place.at[1] - metres, SNAP.lift)), place.at[2]], yaw: place.yaw };
  }
  const hit = rayAtHeight(pickRay(start.camera, x, y), start.grab[1]);
  if (hit === null) return place;
  const step = keys.shift ? SNAP.moveShift : SNAP.move;
  return {
    at: [
      snap(place.at[0] + hit[0] - start.grab[0], step),
      place.at[1],
      snap(place.at[2] + hit[2] - start.grab[2], step),
    ],
    yaw: place.yaw,
  };
}

/** The size of one CSS pixel at the grabbed point (metres): a lift follows the pointer at that distance. */
function pixelSize(start: DragStart): number {
  const a = pickRay(start.camera, start.x, start.y);
  const b = pickRay(start.camera, start.x, start.y + 1);
  const distance = Math.hypot(...([0, 1, 2] as const).map((i) => start.grab[i] - a.origin[i]));
  const gap = ([0, 1, 2] as const).map((i) => (a.direction[i] - b.direction[i]) * distance);
  return Math.hypot(...gap);
}

/** A turn rounded to TURN_ROUND. */
function roundTurn(yaw: number): number {
  return Math.round(yaw * TURN_ROUND) / TURN_ROUND;
}

/** A turn of a place by degrees (the key R). */
export function turnPlace(place: PropPlace, degrees: number): PropPlace {
  return { at: place.at, yaw: roundTurn(place.yaw + degrees * DEG) };
}

/** The tune values with the place of a slot. The function removes each value that is equal to its default. */
export function withPlace(
  tunes: Readonly<Record<string, number>>,
  slot: string,
  place: PropPlace,
  defaults: ReadonlyMap<string, number>,
): Record<string, number> {
  const paths = placePaths(slot);
  let next: Record<string, number> = { ...tunes };
  paths.at.forEach((path, axis) => {
    next = withTune(next, path, place.at[axis] ?? 0, defaults.get(path));
  });
  return withTune(next, paths.yaw, place.yaw, defaults.get(paths.yaw));
}
