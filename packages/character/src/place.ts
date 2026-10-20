// SPDX-License-Identifier: Apache-2.0
/**
 * The types of the place and the pose of a character: the floor shapes, the slot of a character, its place
 * after the locomotion, the goals of its hands and the body pose that `Body.apply` takes. The module has no imports
 * with bytes.
 */
import type { Vec3 } from "./math";

/** An axis-aligned rectangle on the floor. */
export interface FloorRect {
  readonly minX: number;
  readonly maxX: number;
  readonly minZ: number;
  readonly maxZ: number;
}

/** A place on the floor (x, z) and the point on the floor that a character there faces. */
export interface Slot {
  readonly at: readonly [number, number];
  readonly face: readonly [number, number];
}

/** The facing from one floor point to another: 0 faces +z, π/2 faces +x (0 for the same point). */
export function yawTo(from: readonly [number, number], to: readonly [number, number]): number {
  const dx = to[0] - from[0];
  const dz = to[1] - from[1];
  return dx === 0 && dz === 0 ? 0 : Math.atan2(dx, dz);
}

/** The place and the walk of a character, from the locomotion (locomotion.ts). */
export interface Placement {
  readonly at: readonly [number, number];
  readonly yaw: number;
  /** True while the character walks. */
  readonly walking: boolean;
  /** Walk speed in metres per second (the step rate follows it). */
  readonly speed: number;
  /**
   * The locomotion sets the next fields. While the character walks: the start and the end of the walk (ms), for the
   * first and the last step (clip_walk_start, clip_walk_stop).
   */
  readonly walkStartMs?: number;
  readonly walkEndMs?: number;
  /** While the character walks a short way to the side without a turn: the side of the step (clip_sidestep_*). */
  readonly sidestep?: "left" | "right";
  /** While the character turns in place after a walk: the facings and the times of the turn (clip_turn_*). */
  readonly turn?: TurnInPlace;
}

/** A turn in place to the facing of a stand point (Placement.turn). */
export interface TurnInPlace {
  readonly fromYaw: number;
  readonly toYaw: number;
  readonly startMs: number;
  readonly ms: number;
}

/** The fingers of a hand (the bones thumb_0n, index_0n, … of the rig). */
export type Finger = "thumb" | "index" | "middle" | "ring" | "pinky";

/** A hand at rest (arm angles) or on a target point. */
export type HandGoal =
  | { readonly kind: "rest"; readonly pitch: number; readonly spread: number }
  | {
      readonly kind: "target";
      /** The place of the wrist. */
      readonly at: Vec3;
      /** The fingers point this way (a unit vector) and the palm faces down; else the hand follows the forearm. */
      readonly fingers?: Vec3;
      /**
       * With `fingers`: the thumb side of the hand points this way (from the little finger to the index finger, made
       * square to the fingers) in place of the palm down (the C-E grip of a face mask: the hand on the side of the
       * face).
       */
      readonly thumb?: Vec3;
      /** How far the fingers close: 0 (open, the rest of the rig) to 1 (a fist). A hand that holds a thing closes. */
      readonly grip?: number;
      /** The grip of some fingers in place of `grip` (the C-E grip: the thumb and the index on the mask). */
      readonly fingerGrips?: Partial<Record<Finger, number>>;
    };

/**
 * The pose of the body of a character: the place, the trunk, the hands, the look and the face. `Body.apply`
 * takes it. A plugin pose extends it with its own fields (the clip, the held prop).
 */
export interface BodyPose {
  /** The place on the floor (x, z). */
  readonly at: readonly [number, number];
  /** The facing: 0 faces +z, π/2 faces +x. */
  readonly yaw: number;
  readonly visible: boolean;
  /** Forward lean of the upper body in radians. */
  readonly lean: number;
  /** Drop of the hips in metres (bent knees). */
  readonly crouch: number;
  /**
   * The largest drop of the hips of the reach of the hands (Body.reach; absent: CROUCH_MAX). 0: the reach bends only
   * the trunk (bent knees would go into a frame in front of the character).
   */
  readonly crouchMax?: number;
  /**
   * The largest lean of the trunk of the reach of the hands (Body.reach; absent: LEAN_MAX). A character on a step
   * bends further at the hips: the step puts the shoulders higher above the work.
   */
  readonly leanMax?: number;
  /** Vertical motion of the body in metres (a press, a breath). */
  readonly bob: number;
  /** The height of the floor under the feet (metres): a step (the core sets it). Absent: the floor. */
  readonly lift?: number;
  readonly left: HandGoal;
  readonly right: HandGoal;
  /** The point that the head looks at, or null for straight ahead. */
  readonly look: Vec3 | null;
  /** Leg swing of a walk in radians. */
  readonly legSwing: number;
  /** A small nod while the character speaks, in radians. */
  readonly nod: number;
  /**
   * In a cyclic work: the work as a count of cycles from the bottom of each one, for the motion of a cycle clip.
   * Absent in the other poses and in a still pose.
   */
  readonly cycle?: number;
  /**
   * The round of the upper back and the drop of the head, from 0 (upright) to 1 (a tired character). A
   * negative value opens the chest (a deep breath, the roll of the shoulders). Absent: 0.
   */
  readonly slump?: number;
  /** The open of the jaw from 0 to 1 (the morph `jaw_open`: a count aloud). Absent: 0. */
  readonly jaw?: number;
  /**
   * The close of the eyelids from 0 (open) to 1 (closed): the morph `blink` of the characters (clip_face_blink).
   * Absent: 0.
   */
  readonly blink?: number;
}

/** The thing in the hand of a pose: its name, and the hand that holds it (absent: the right hand). */
export interface HeldPose {
  readonly prop: string;
  readonly propHand?: "left" | "right";
}
