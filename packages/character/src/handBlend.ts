// SPDX-License-Identifier: Apache-2.0
/**
 * The points in front of the body and the blend of two hand goals. The family poses of a plugin and the
 * crossfade (poseBlend.ts) use them. This module registers no tune value, so a family module that imports it does not
 * change the order of the tune registry.
 */
import type { Vec3 } from "./math";
import type { HandGoal } from "./place";

/**
 * A point in front of the body: `forward` metres ahead, `side` metres to the right, at height `y`. The right of a
 * character that faces +z is −x (the left shoulder of the body is at +x).
 */
export function bodyPoint(at: readonly [number, number], yaw: number, forward: number, side: number, y: number): Vec3 {
  const fx = Math.sin(yaw);
  const fz = Math.cos(yaw);
  return [at[0] + fx * forward - fz * side, y, at[1] + fz * forward + fx * side];
}

/** A hand goal between two targets: `share` 0 is `from`, 1 is `to`. */
export function blendGoal(from: HandGoal, to: HandGoal, share: number): HandGoal {
  if (from.kind !== "target" || to.kind !== "target") return share < 0.5 ? from : to;
  const at: Vec3 = [
    from.at[0] + (to.at[0] - from.at[0]) * share,
    from.at[1] + (to.at[1] - from.at[1]) * share,
    from.at[2] + (to.at[2] - from.at[2]) * share,
  ];
  const fa = from.fingers ?? [0, 0, 1];
  const ta = to.fingers ?? fa;
  const mixed: Vec3 = [
    fa[0] + (ta[0] - fa[0]) * share,
    fa[1] + (ta[1] - fa[1]) * share,
    fa[2] + (ta[2] - fa[2]) * share,
  ];
  const length = Math.hypot(mixed[0], mixed[1], mixed[2]) || 1;
  // The thumb side and the grips of single fingers: of the nearer goal (a C-E grip that blends to a hand at rest).
  const near = share < 0.5 ? from : to;
  const grip = (from.grip ?? 0.8) + ((to.grip ?? 0.8) - (from.grip ?? 0.8)) * share;
  return {
    kind: "target",
    at,
    fingers: [mixed[0] / length, mixed[1] / length, mixed[2] / length],
    grip,
    ...(near.thumb !== undefined ? { thumb: near.thumb } : {}),
    ...(near.fingerGrips !== undefined ? { fingerGrips: near.fingerGrips } : {}),
  };
}
