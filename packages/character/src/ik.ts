// SPDX-License-Identifier: Apache-2.0
/**
 * The IK of any skeleton: the two-bone IK of a leg (the foot lock), the two-bone IK of an arm with a
 * pole (the IK of the hands of the neutral body in `body.ts`, made generic), and the aim of a head at a target.
 *
 * Each solver turns the nodes of a posed skeleton in place, after the clips, and updates their world matrices. A
 * solver keeps no state: the same pose and the same target give the same result, so a seek gives the frame of a play.
 */
import { Quaternion, Vector3, type Object3D } from "three";

const a = new Vector3();
const b = new Vector3();
const c = new Vector3();
const u = new Vector3();
const p = new Vector3();
const e = new Vector3();
const axis = new Vector3();
const turn = new Quaternion();
const parentTurn = new Quaternion();
const NO_TURN = new Quaternion();

/** Turn a node by the world rotation `rotation` (its children turn with it). */
export function turnWorld(node: Object3D, rotation: Quaternion): void {
  if (node.parent === null) parentTurn.identity();
  else node.parent.getWorldQuaternion(parentTurn);
  // L' = P⁻¹ · R · P · L
  node.quaternion.premultiply(parentTurn).premultiply(rotation).premultiply(parentTurn.invert());
  node.updateMatrixWorld(true);
}

/** Mix the turns of two nodes back toward their turns before a solve, by `1 - weight`. */
function blendBack(
  upper: Object3D,
  lower: Object3D,
  upperBefore: Quaternion,
  lowerBefore: Quaternion,
  w: number,
): void {
  if (w >= 1) return;
  upper.quaternion.copy(upperBefore.slerp(upper.quaternion, w));
  lower.quaternion.copy(lowerBefore.slerp(lower.quaternion, w));
  upper.updateMatrixWorld(true);
}

/**
 * The two-bone IK: turn `upper` and `lower` so that `end` goes to `target` (world space), by `weight` (0..1). The
 * knee keeps its bend plane; a straight leg bends about the x axis of the lower bone.
 */
export function solveTwoBone(upper: Object3D, lower: Object3D, end: Object3D, target: Vector3, weight: number): void {
  if (weight <= 0) return;
  const upperBefore = upper.quaternion.clone();
  const lowerBefore = lower.quaternion.clone();
  upper.getWorldPosition(a);
  lower.getWorldPosition(b);
  end.getWorldPosition(c);
  const lab = a.distanceTo(b);
  const lcb = b.distanceTo(c);
  const lat = Math.min(Math.max(a.distanceTo(target), Math.abs(lab - lcb) + 1e-6), lab + lcb - 1e-6);
  const toA = a.clone().sub(b).normalize();
  const toC = c.clone().sub(b).normalize();
  axis.crossVectors(toA, toC);
  if (axis.lengthSq() < 1e-12) axis.set(1, 0, 0).transformDirection(lower.matrixWorld);
  axis.normalize();
  const now = Math.acos(Math.min(1, Math.max(-1, toA.dot(toC))));
  const wanted = Math.acos(Math.min(1, Math.max(-1, (lab * lab + lcb * lcb - lat * lat) / (2 * lab * lcb))));
  turnWorld(lower, turn.setFromAxisAngle(axis, wanted - now));
  end.getWorldPosition(c);
  const from = c.sub(a).normalize();
  const to = target.clone().sub(a).normalize();
  turnWorld(upper, turn.setFromUnitVectors(from, to));
  blendBack(upper, lower, upperBefore, lowerBefore, weight);
}

/**
 * The two-bone IK of a limb with a pole (the rule of the hands of `body.ts`): the elbow goes into the plane of the
 * root, the target and the pole direction `pole` (world space), on the side of the pole. Then `end` goes to
 * `target`, or as far as the limb reaches. `weight` (0..1) mixes the result with the pose before it.
 */
export function solveLimb(
  upper: Object3D,
  lower: Object3D,
  end: Object3D,
  target: Vector3,
  pole: Vector3,
  weight: number,
): void {
  if (weight <= 0) return;
  upper.getWorldPosition(a);
  lower.getWorldPosition(b);
  end.getWorldPosition(c);
  const lab = a.distanceTo(b);
  const lbc = b.distanceTo(c);
  u.subVectors(target, a);
  if (lab < 1e-9 || lbc < 1e-9 || u.lengthSq() < 1e-12) return;
  const upperBefore = upper.quaternion.clone();
  const lowerBefore = lower.quaternion.clone();
  const distance = Math.min(Math.max(u.length(), Math.abs(lab - lbc) + 1e-6), lab + lbc - 1e-6);
  u.normalize();
  p.copy(pole).addScaledVector(u, -pole.dot(u));
  if (p.lengthSq() < 1e-12) p.set(0, -1, 0).addScaledVector(u, u.y);
  if (p.lengthSq() < 1e-12) p.set(1, 0, 0);
  p.normalize();
  const cosA = Math.min(1, Math.max(-1, (lab * lab + distance * distance - lbc * lbc) / (2 * lab * distance)));
  e.copy(a)
    .addScaledVector(u, lab * cosA)
    .addScaledVector(p, lab * Math.sqrt(1 - cosA * cosA));
  // The upper bone: from its root to the elbow. Then the lower bone: from the elbow to the target.
  turnWorld(upper, turn.setFromUnitVectors(b.sub(a).normalize(), e.sub(a).normalize()));
  lower.getWorldPosition(b);
  end.getWorldPosition(c);
  turnWorld(lower, turn.setFromUnitVectors(c.sub(b).normalize(), u.subVectors(target, b).normalize()));
  blendBack(upper, lower, upperBefore, lowerBefore, weight);
}

/**
 * Turn `node` so that the direction `forward` (world space, the way the node looks now) goes toward `target`, by
 * `weight` (0..1) and at most by `maxAngle` radians.
 */
export function aimAt(node: Object3D, forward: Vector3, target: Vector3, weight: number, maxAngle: number): void {
  if (weight <= 0) return;
  node.getWorldPosition(a);
  u.subVectors(target, a);
  if (u.lengthSq() < 1e-12) return;
  u.normalize();
  p.copy(forward).normalize();
  const angle = p.angleTo(u);
  if (angle < 1e-9) return;
  const share = Math.min(1, maxAngle / angle) * Math.min(1, weight);
  turn.setFromUnitVectors(p, u);
  turnWorld(node, NO_TURN.clone().slerp(turn, share));
}
