// SPDX-License-Identifier: Apache-2.0
/**
 * The inspect report of the 3D scene: what the renderer drew at a frame, as plain data. The lab shows it, its tools
 * read it, and the motion metrics (metrics.ts) measure it. It holds the pose of each member (`family`, `phase`, the
 * hand goals) and the places of its joints after the IK. The joints are the bones of a glTF character, else the joints
 * of the graybox body. The report also holds the work points of the scene. A plugin adds its own fields to the report.
 */
import type { Vec3 } from "@scenity/character/math";

/** The joints of a member in the report: the left (`_l`) and the right (`_r`) side. */
export const JOINT_NAMES = [
  "pelvis",
  "head",
  "shoulder_l",
  "elbow_l",
  "wrist_l",
  "shoulder_r",
  "elbow_r",
  "wrist_r",
  "hip_l",
  "knee_l",
  "ankle_l",
  "hip_r",
  "knee_r",
  "ankle_r",
] as const;

export type JointName = (typeof JOINT_NAMES)[number];

export type Joints = Readonly<Partial<Record<JointName, Vec3>>>;

/** A hand of a member: its goal and where the wrist is after the IK. */
export interface HandReport {
  /** "target": the pose gives a place of the wrist; "rest": the hand hangs. */
  readonly kind: "target" | "rest";
  /** The place of the wrist that the pose asks for, or null for a hand at rest. */
  readonly target: Vec3 | null;
  /** The place of the wrist after the IK (or after a capture of the hand by the plugin). */
  readonly wrist: Vec3;
}

export interface MemberReport {
  readonly id: string;
  readonly role: string | null;
  readonly family: string;
  readonly activity: string;
  readonly binding: string | null;
  readonly phase: string | null;
  readonly phaseStartMs: number | null;
  /** The place on the floor (x, z), the facing and the height of the floor under the feet (a step stool). */
  readonly at: readonly [number, number];
  readonly yaw: number;
  readonly lift: number;
  readonly walking: boolean;
  readonly visible: boolean;
  readonly lean: number;
  readonly crouch: number;
  readonly prop: string;
  readonly cycle: number | null;
  /** The clip of the animation catalog that the pose draws (MemberPose.clip), or null. */
  readonly clip: string | null;
  /** The clips that play over the clip (MemberPose.layers: the jaw of a voice, a readback, a gesture). */
  readonly layers: readonly string[];
  /** The round of the upper back (MemberPose.slump) and the open of the jaw (MemberPose.jaw). */
  readonly slump: number;
  readonly jaw: number;
  /** The left hand, then the right hand. */
  readonly hands: readonly [HandReport, HandReport];
  readonly joints: Joints;
  /** A glTF character (true) or the graybox body (false). */
  readonly skinned: boolean;
}

/**
 * A capture of a frame: the simulation time of the frame, a small picture of the canvas (null when the caller asked for
 * no picture, or the browser cannot make it) and the clip and the family that each visible member draws in it.
 */
export interface FrameCapture {
  readonly simMs: number | null;
  readonly bitmap: ImageBitmap | null;
  readonly members: readonly { readonly id: string; readonly clip: string | null; readonly family: string }[];
}

/** The report of a frame. `Member` is the report of a member (a plugin adds its own fields to MemberReport). */
export interface InspectReport<Member extends MemberReport = MemberReport> {
  /** The simulation time of the frame, or null before the first time. */
  readonly simMs: number | null;
  readonly members: readonly Member[];
  /** The work points of the scene in the room (the plugin gives them, after the fit of its models). */
  readonly points: Readonly<Record<string, Vec3>>;
  /** The clip and the layers of each other person of the scene. */
  readonly people?: readonly PersonReport[];
}

/** The clips of another person of the scene in a frame. */
export interface PersonReport {
  readonly id: string;
  readonly clip: string | null;
  readonly layers: readonly string[];
}
