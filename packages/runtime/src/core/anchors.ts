// SPDX-License-Identifier: Apache-2.0
/**
 * The projected frames of a scene core: the projected points of the anchors, sent to the host only when a point moves.
 * The module is pure: it has no three.js object and no state. The page also imports it (`@scenity/runtime/anchors`).
 */
import type { ProjectedFrame, ProjectedPoint } from "../protocol";

/** A projected frame goes to the host only when a point moves more than this (CSS pixels). */
export const ANCHOR_EPSILON = 0.5;

/** True when a projected point is in front of the camera and on a canvas of this size (CSS pixels). */
export function onCanvas(point: ProjectedPoint, width: number, height: number): boolean {
  const [x, y, depth] = point.at;
  return depth < 1 && x >= 0 && x <= width && y >= 0 && y <= height;
}

/** True when two point lists have the same IDs, the same states and points within ANCHOR_EPSILON. */
function samePoints(
  before: readonly ProjectedPoint[],
  after: readonly ProjectedPoint[],
  width: number,
  height: number,
): boolean {
  return (
    before.length === after.length &&
    after.every((point, index) => {
      const old = before[index];
      return (
        old?.id === point.id &&
        old.visible === point.visible &&
        onCanvas(old, width, height) === onCanvas(point, width, height) &&
        Math.abs(old.at[0] - point.at[0]) <= ANCHOR_EPSILON &&
        Math.abs(old.at[1] - point.at[1]) <= ANCHOR_EPSILON
      );
    })
  );
}

/**
 * The next projected frame for the points of this frame, or null when the frame before it is the same (the same size,
 * the same points). `seq` is the sequence number of the new frame.
 */
export function nextProjectedFrame(
  previous: ProjectedFrame | null,
  seq: number,
  width: number,
  height: number,
  points: readonly ProjectedPoint[],
): ProjectedFrame | null {
  const same =
    previous !== null &&
    previous.width === width &&
    previous.height === height &&
    samePoints(previous.points, points, width, height);
  return same ? null : { seq, width, height, points };
}
