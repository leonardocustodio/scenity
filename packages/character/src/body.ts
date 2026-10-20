// SPDX-License-Identifier: Apache-2.0
/**
 * The neutral body of a character: the joints of a standing person without meshes, and the pose logic of the graybox. A
 * BodyPose sets the place, the facing, the crouch, the lean, the leg swing, the rest angles of the arms, the look and
 * the two-bone IK of the hands.
 *
 * At rest every joint frame is the frame of the root: y up, the face to +z, the arms and the legs hang down
 * (−y). The graybox mannequin of a plugin puts its meshes on these joints. The rig driver (rigDriver.ts) copies
 * the joint rotations to a skinned glTF skeleton; it sizes the body from the rest pose of that skeleton, so the
 * IK uses the real lengths of the arms.
 */
import { Group, Matrix4, Quaternion, Vector3 } from "three";
import type { Vec3 } from "./math";
import type { BodyPose, Finger, HandGoal } from "./place";
import { LEAN_MAX } from "./reach";

const DOWN = new Vector3(0, -1, 0);
/** The thumbs of the neutral body point forward (the arms hang, the palms face the thighs). */
const FORWARD = new Vector3(0, 0, 1);
/** The frame of a neutral hand (the fingers down, the thumb forward), inverted. */
const NEUTRAL_HAND = new Matrix4().makeBasis(DOWN, FORWARD, DOWN.clone().cross(FORWARD)).invert();

/** The sizes of a body in metres. The offsets are in the frame of the parent joint at rest. */
export interface BodySize {
  /** The factor of the body to the reference height of 1.75 m (the lean moves the pelvis back by this factor). */
  readonly scale: number;
  /** The height of the pelvis joint above the floor at rest. */
  readonly hipHeight: number;
  /** The spine joint (the lower back) in the frame of the pelvis. */
  readonly spine: Vec3;
  /** The chest joint (the upper back) in the frame of the spine. */
  readonly chest: Vec3;
  /** The neck joint in the frame of the chest. */
  readonly neck: Vec3;
  /** The head joint in the frame of the neck. */
  readonly head: Vec3;
  /** The shoulder joints (left, right) in the frame of the chest. */
  readonly shoulders: readonly [Vec3, Vec3];
  /** The hip joints (left, right) in the frame of the pelvis. */
  readonly hips: readonly [Vec3, Vec3];
  /** From the shoulder to the elbow. */
  readonly upperLength: number;
  /** From the elbow to the wrist. */
  readonly lowerLength: number;
  /** From the hip to the knee. */
  readonly thighLength: number;
  /** From the knee to the ankle. */
  readonly shinLength: number;
}

/**
 * Extra turns of the trunk joints (in the frame of each joint) and the lift of the hips (metres) from a played clip
 * (the trunk drive of clipLayer.ts): the body adds them to its own pose before the IK of the hands. The lift
 * takes the place of the bob of the pose.
 */
export interface TrunkTurns {
  readonly spine: Quaternion;
  readonly chest: Quaternion;
  readonly neck: Quaternion;
  readonly head: Quaternion;
  readonly lift: number;
}

export interface Arm {
  readonly shoulder: Group;
  readonly upper: Group;
  readonly elbow: Group;
  readonly hand: Group;
  /** +1 for the left arm (+x of the body), −1 for the right arm. */
  readonly side: 1 | -1;
}

export interface Leg {
  readonly hip: Group;
  readonly knee: Group;
  /** The ankle: it turns the foot back by the bend of the crouch, so the foot stays flat on the floor. */
  readonly ankle: Group;
}

/** Scratch objects of the IK (one frame at a time). */
const s = new Vector3();
const t = new Vector3();
const u = new Vector3();
const p = new Vector3();
const e = new Vector3();
const dir = new Vector3();
const q = new Quaternion();
const thumb = new Vector3();
const r = new Quaternion();
const frame = new Matrix4();
const sideAxis = new Vector3();
const backAxis = new Vector3();
const facing = new Quaternion();
const turn = new Quaternion();

/**
 * The look of a member: the turn to a target goes over three joints, as a person bends the upper back,
 * the neck and the head together. Each joint takes its share of the pitch and the yaw, within its own limits
 * (radians; a negative pitch looks up).
 */
export const LOOK_SHARES = {
  chest: { pitch: 0.15, yaw: 0 },
  neck: { pitch: 0.35, yaw: 0.4 },
  head: { pitch: 0.5, yaw: 0.6 },
} as const;
/** A hand target can be this share of the arm length from its shoulder: the elbow stays a little bent. */
export const REACH_SHARE = 0.97;
/**
 * The largest drop of the hips (metres) that brings a far hand target in reach, with the largest lean of
 * the trunk (LEAN_MAX, reach.ts): a character bends at the hips and at the knees over low work.
 */
export { LEAN_MAX };
export const CROUCH_MAX = 0.1;
/**
 * The passes of the reach and the look in each frame, from the neutral upper back (Body.apply). The second pass
 * measures from the upper back of the first; a third pass changes a joint by less than 0.001 rad.
 */
const LOOK_PASSES = 2;

/** The steps of the bend in the search of the bend with the smallest gap (nearestBend). */
const BEND_STEPS = 8;

/**
 * The share of the bend (0 to 1) with the smallest `gap`: a coarse search in BEND_STEPS
 * steps, then a finer search between the neighbours of the best step. The ties go to the smaller bend.
 */
function nearestBend(gap: (share: number) => number): number {
  let best = 0;
  let bestGap = gap(0);
  for (let step = 1; step <= BEND_STEPS; step += 1) {
    const value = gap(step / BEND_STEPS);
    if (value < bestGap - 1e-6) {
      best = step / BEND_STEPS;
      bestGap = value;
    }
  }
  let low = Math.max(0, best - 1 / BEND_STEPS);
  let high = Math.min(1, best + 1 / BEND_STEPS);
  for (let step = 0; step < 8; step += 1) {
    const a = low + (high - low) / 3;
    const b = high - (high - low) / 3;
    if (gap(a) <= gap(b)) high = b;
    else low = a;
  }
  const fine = (low + high) / 2;
  return gap(fine) < bestGap ? fine : best;
}

/** The turn (radians) of the upper back, the neck and the head for a slump of 1 (BodyPose.slump). */
const SLUMP = { chest: 0.24, neck: 0.12, head: 0.2 } as const;

export const LOOK_LIMITS = {
  chest: { down: 0.14, up: 0.03, side: 0 },
  neck: { down: 0.3, up: 0.15, side: 0.45 },
  head: { down: 0.42, up: 0.3, side: 0.65 },
} as const;

function share(value: number, part: number, limit: { readonly down: number; readonly up: number }): number {
  return Math.max(-limit.up, Math.min(limit.down, value * part));
}

export class Body {
  readonly root = new Group();
  readonly pelvis = new Group();
  readonly spine = new Group();
  readonly chest = new Group();
  readonly neck = new Group();
  readonly head = new Group();
  readonly arms: readonly [Arm, Arm];
  /** True for a hand that the pose turned (a target with `fingers`): the rig driver turns its bone too. */
  readonly turnedHands: [boolean, boolean] = [false, false];
  /** How far the fingers of each hand (left, right) close (HandGoal grip): the rig driver bends its finger bones. */
  readonly grips: [number, number] = [0, 0];
  /** The grips of single fingers of each hand (HandGoal.fingerGrips), or null: then `grips` for every finger. */
  readonly fingerGrips: [Partial<Record<Finger, number>> | null, Partial<Record<Finger, number>> | null] = [null, null];
  readonly legs: readonly [Leg, Leg];

  constructor(readonly size: BodySize) {
    this.pelvis.position.y = size.hipHeight;
    this.root.add(this.pelvis);
    this.spine.position.set(...size.spine);
    this.pelvis.add(this.spine);
    this.chest.position.set(...size.chest);
    this.spine.add(this.chest);
    this.neck.position.set(...size.neck);
    this.chest.add(this.neck);
    this.head.position.set(...size.head);
    this.neck.add(this.head);
    const makeArm = (side: 1 | -1): Arm => {
      const shoulder = new Group();
      shoulder.position.set(...size.shoulders[side === 1 ? 0 : 1]);
      this.chest.add(shoulder);
      const upper = new Group();
      shoulder.add(upper);
      const elbow = new Group();
      elbow.position.y = -size.upperLength;
      upper.add(elbow);
      const hand = new Group();
      hand.position.y = -size.lowerLength;
      elbow.add(hand);
      return { shoulder, upper, elbow, hand, side };
    };
    this.arms = [makeArm(1), makeArm(-1)];
    const makeLeg = (side: 1 | -1): Leg => {
      const hip = new Group();
      hip.position.set(...size.hips[side === 1 ? 0 : 1]);
      this.pelvis.add(hip);
      const knee = new Group();
      knee.position.y = -size.thighLength;
      hip.add(knee);
      const ankle = new Group();
      ankle.position.y = -size.shinLength;
      knee.add(ankle);
      return { hip, knee, ankle };
    };
    this.legs = [makeLeg(1), makeLeg(-1)];
  }

  /** The extra turns of the trunk in the pose of the last `apply`, or null. */
  private turns: TrunkTurns | null = null;

  /**
   * Apply a pose: the place, the facing, the legs, the trunk, the look and the hands. `turns` (a compression clip)
   * add to the back, the upper back, the neck and the head before the IK of the hands.
   */
  apply(pose: BodyPose, turns: TrunkTurns | null = null): void {
    this.turns = turns;
    this.root.visible = pose.visible;
    this.root.position.set(pose.at[0], pose.lift ?? 0, pose.at[1]);
    this.root.rotation.set(0, pose.yaw, 0);
    this.setTrunk(pose, pose.lean, pose.crouch);
    // Rest angles first, then the IK of the hands with a target.
    for (const [index, arm] of this.arms.entries()) {
      arm.hand.quaternion.identity();
      this.turnedHands[index] = false;
      const goal = index === 0 ? pose.left : pose.right;
      this.grips[index] = goal.kind === "target" ? Math.min(1, Math.max(0, goal.grip ?? 0)) : 0;
      this.fingerGrips[index] = goal.kind === "target" ? (goal.fingerGrips ?? null) : null;
    }
    // The look turns the upper back, and the upper back moves the shoulders and the neck that the reach and the look
    // measure: the two steps depend on each other. Each frame starts from the neutral upper back, neck and head and
    // does the two steps twice, so a pose never depends on the frame before it. A start from the joints of the earlier
    // frame can make the render worker and the main-thread core draw different poses for one fixed frame.
    this.chest.rotation.set(0, 0, 0);
    this.neck.rotation.set(0, 0, 0);
    this.head.rotation.set(0, 0, 0);
    // The turns of a played clip and the slump move the shoulders too: each pass adds them after the look, so the reach
    // of the second pass measures the shoulders of the final upper back. Without this order, the wrists of a press clip
    // can stop up to 8 cm above the target on the chest.
    // The reach, the look and the arms read the world places of the joints only through getWorldPosition and
    // getWorldQuaternion. These calculate the matrices of the chain from the scene to the joint. Thus `apply` does not
    // update the matrices of the full member: the model of a skinned member has about 70 bones, and the reach can try
    // 30 bends. The render updates the matrices of the scene before it draws.
    for (let pass = 0; pass < LOOK_PASSES; pass += 1) {
      this.reach(pose);
      this.lookAt(pose.look, pose.nod);
      this.turnUpperBack(pose);
    }
    this.restArm(this.arms[0], pose.left);
    this.restArm(this.arms[1], pose.right);
    this.solve(this.arms[0], pose.left);
    this.solve(this.arms[1], pose.right);
  }

  /**
   * The turns of a played clip on the upper back, the neck and the head, then the round of the upper back and the drop
   * of the head (a tired compressor): the shoulders come forward and down, and the elbows
   * of straight arms bend a little.
   */
  private turnUpperBack(pose: BodyPose): void {
    if (this.turns !== null) {
      this.chest.quaternion.multiply(this.turns.chest);
      this.neck.quaternion.multiply(this.turns.neck);
      this.head.quaternion.multiply(this.turns.head);
    }
    const slump = pose.slump ?? 0;
    if (slump !== 0) {
      this.chest.rotateX(SLUMP.chest * slump);
      this.neck.rotateX(SLUMP.neck * slump);
      this.head.rotateX(SLUMP.head * slump);
    }
  }

  /**
   * The legs and the trunk: bent knees for a crouch (the hips drop, the thighs go forward and the shins back) and
   * the lean of the trunk from the hips. The pelvis goes back a little with the lean of the pose (the balance of
   * the body), not with the extra lean of `reach`.
   */
  private setTrunk(pose: BodyPose, lean: number, crouch: number): void {
    const size = this.size;
    const drop = Math.min(0.15, Math.max(0, crouch));
    const bend = Math.acos(Math.min(1, 1 - drop / (size.thighLength + size.shinLength)));
    const bob = this.turns === null ? pose.bob : this.turns.lift;
    this.pelvis.position.set(0, size.hipHeight - drop + bob, -0.09 * Math.max(0, pose.lean) * size.scale);
    this.spine.rotation.set(lean, 0, 0);
    if (this.turns !== null) this.spine.quaternion.multiply(this.turns.spine);
    const [left, right] = this.legs;
    left.hip.rotation.set(-bend + pose.legSwing, 0, 0);
    left.knee.rotation.set(2 * bend + Math.max(0, -pose.legSwing) * 0.7, 0, 0);
    right.hip.rotation.set(-bend - pose.legSwing, 0, 0);
    right.knee.rotation.set(2 * bend + Math.max(0, pose.legSwing) * 0.7, 0, 0);
    // The shin of a crouch turns forward by `bend`: the ankle turns the foot back by it (the walk keeps its foot roll).
    left.ankle.rotation.set(-bend, 0, 0);
    right.ankle.rotation.set(-bend, 0, 0);
  }

  /**
   * Bend further when a hand target is out of reach (a work point lower or farther than the kit, a short character):
   * the lean and the crouch go together toward LEAN_MAX and CROUCH_MAX, to the smallest bend that brings every
   * target of the pose to REACH_SHARE of the arm length (the full bend when none does).
   */
  private reach(pose: BodyPose): void {
    const goals: { readonly arm: Arm; readonly at: Vec3 }[] = [];
    for (const [index, goal] of [pose.left, pose.right].entries()) {
      const arm = this.arms[index];
      if (goal.kind === "target" && arm !== undefined) goals.push({ arm, at: goal.at });
    }
    if (goals.length === 0) return;
    const limit = REACH_SHARE * (this.size.upperLength + this.size.lowerLength);
    const leanTop = pose.leanMax ?? LEAN_MAX;
    const lean = (share: number): number => pose.lean + share * Math.max(0, leanTop - pose.lean);
    const crouchTop = pose.crouchMax ?? CROUCH_MAX;
    const crouch = (share: number): number => pose.crouch + share * Math.max(0, crouchTop - pose.crouch);
    /** The largest distance of a target beyond the reach of its arm at a bend (0: every target in reach). */
    const excess = (share: number): number => {
      this.setTrunk(pose, lean(share), crouch(share));
      // getWorldPosition calculates the matrices from the scene to the shoulder. The other joints wait for `apply`.
      let most = 0;
      for (const { arm, at } of goals) {
        most = Math.max(most, arm.shoulder.getWorldPosition(s).distanceTo(t.set(...at)) - limit);
      }
      return most;
    };
    const short = (share: number): boolean => excess(share) > 0;
    let share = 0;
    if (short(0)) {
      // The bisection keeps `high` in reach.
      let low = 0;
      let high = 1;
      if (short(high)) {
        // No bend reaches every target: the bend with the smallest gap. A target above
        // the shoulders is then not farther away after a full bend.
        high = nearestBend(excess);
      } else {
        for (let step = 0; step < 14; step += 1) {
          const middle = (low + high) / 2;
          if (short(middle)) low = middle;
          else high = middle;
        }
      }
      share = high;
    }
    this.setTrunk(pose, lean(share), crouch(share));
  }

  /**
   * A hand at rest: the arm angles are in the frame of the facing of the member (the root), not of the trunk. Thus a
   * lean of the trunk does not swing a resting arm back; the arm hangs from the shoulder.
   */
  private restArm(arm: Arm, goal: HandGoal): void {
    if (goal.kind !== "rest") return;
    arm.upper.rotation.set(-goal.pitch, 0, arm.side * goal.spread);
    arm.elbow.rotation.set(-0.15 - goal.pitch * 0.3, 0, 0);
    // The turn of the shoulder frame in the root frame, removed from the turn of the upper arm.
    this.root.getWorldQuaternion(facing).invert();
    arm.shoulder.getWorldQuaternion(turn).premultiply(facing).invert();
    arm.upper.quaternion.premultiply(turn);
  }

  private lookAt(target: Vec3 | null, nod: number): void {
    if (target === null) {
      this.chest.rotation.set(0, 0, 0);
      this.neck.rotation.set(0, 0, 0);
      this.head.rotation.set(nod, 0, 0);
      return;
    }
    this.neck.getWorldPosition(s);
    dir.set(target[0] - s.x, target[1] - s.y, target[2] - s.z);
    this.spine.getWorldQuaternion(q);
    dir.applyQuaternion(q.invert());
    const yaw = Math.atan2(dir.x, dir.z);
    const pitch = Math.atan2(-dir.y, Math.hypot(dir.x, dir.z));
    const side = (part: number, limit: number): number => Math.max(-limit, Math.min(limit, yaw * part));
    this.chest.rotation.set(share(pitch, LOOK_SHARES.chest.pitch, LOOK_LIMITS.chest), 0, 0);
    this.neck.rotation.set(
      share(pitch, LOOK_SHARES.neck.pitch, LOOK_LIMITS.neck),
      side(LOOK_SHARES.neck.yaw, LOOK_LIMITS.neck.side),
      0,
      "YXZ",
    );
    this.head.rotation.set(
      share(pitch, LOOK_SHARES.head.pitch, LOOK_LIMITS.head) + nod,
      side(LOOK_SHARES.head.yaw, LOOK_LIMITS.head.side),
      0,
      "YXZ",
    );
  }

  /** Two-bone IK: the elbow bends outward, down and back; a far target straightens the arm. */
  private solve(arm: Arm, goal: HandGoal): void {
    if (goal.kind !== "target") return;
    arm.shoulder.getWorldPosition(s);
    t.set(goal.at[0], goal.at[1], goal.at[2]);
    const a = this.size.upperLength;
    const b = this.size.lowerLength;
    u.subVectors(t, s);
    const distance = Math.min(Math.max(u.length(), Math.abs(a - b) + 0.01), a + b - 0.002);
    if (u.lengthSq() < 1e-8) return;
    u.normalize();
    // The pole: out to the side of the arm, down, and a little back.
    sideAxis.set(arm.side, 0, 0).applyQuaternion(this.root.quaternion);
    backAxis.set(0, 0, -1).applyQuaternion(this.root.quaternion);
    p.copy(sideAxis).multiplyScalar(0.55).add(DOWN).addScaledVector(backAxis, 0.25);
    p.addScaledVector(u, -p.dot(u));
    if (p.lengthSq() < 1e-8) p.set(0, -1, 0);
    p.normalize();
    const cosA = Math.min(1, Math.max(-1, (a * a + distance * distance - b * b) / (2 * a * distance)));
    const sinA = Math.sqrt(1 - cosA * cosA);
    e.copy(s)
      .addScaledVector(u, a * cosA)
      .addScaledVector(p, a * sinA);
    // Upper arm: from the shoulder to the elbow, in the space of the shoulder.
    dir.subVectors(e, s).normalize();
    arm.shoulder.getWorldQuaternion(q);
    dir.applyQuaternion(q.invert());
    arm.upper.quaternion.setFromUnitVectors(DOWN, dir);
    arm.upper.updateMatrixWorld(true);
    // Forearm: from the elbow to the target, in the space of the upper arm.
    dir.set(goal.at[0], goal.at[1], goal.at[2]).sub(e).normalize();
    arm.upper.getWorldQuaternion(q);
    dir.applyQuaternion(q.invert());
    arm.elbow.quaternion.setFromUnitVectors(DOWN, dir);
    arm.elbow.updateMatrixWorld(true);
    if (goal.fingers !== undefined) this.turnHand(arm, goal.fingers, goal.thumb);
  }

  /**
   * Turn a hand: the fingers along `fingers`, the palm down and the thumb to the middle of the body (the hand
   * position of a press with two hands). With `thumbWay` the thumb side points that way (square to the fingers).
   */
  private turnHand(arm: Arm, fingers: Vec3, thumbWay?: Vec3): void {
    dir.set(fingers[0], fingers[1], fingers[2]).normalize();
    if (thumbWay !== undefined) {
      thumb.set(thumbWay[0], thumbWay[1], thumbWay[2]);
      thumb.addScaledVector(dir, -thumb.dot(dir));
    } else {
      // The palm faces down: the thumb is on the side of the body (side · (down × fingers)).
      thumb.crossVectors(DOWN, dir).multiplyScalar(arm.side);
    }
    if (thumb.lengthSq() < 1e-8) return;
    thumb.normalize();
    frame.makeBasis(dir, thumb, e.crossVectors(dir, thumb)).multiply(NEUTRAL_HAND);
    q.setFromRotationMatrix(frame);
    arm.elbow.getWorldQuaternion(r);
    arm.hand.quaternion.copy(r.invert().multiply(q));
    arm.hand.updateMatrixWorld(true);
    this.turnedHands[arm.side === 1 ? 0 : 1] = true;
  }
}
