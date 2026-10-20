// SPDX-License-Identifier: Apache-2.0
/**
 * The clip layer of the characters: one player for each recorded clip that a character plays over its procedural pose.
 * A config (ClipConfig; the played clips of a plugin) tells the layer which clip it plays, how the time of the scene
 * maps to the clip time, and which bones the clip drives. The core loads the clip of each config once for an asset
 * choice; without the clip the character keeps its procedural pose.
 *
 * The layer has its own copy of the skeleton of the clip file. It gives two drives:
 * - the trunk drive (`turns`): the turns of the trunk joints of the neutral body away from the mean pose (time 0) and
 *   the lift of the hips. The body adds them to its own pose before the IK of the hands (Body.apply), so the legs
 *   stand and the hands stay on their targets. The weight is 1: no blend in or out.
 * - the all-bones drive (`clip`): a skinned member samples the clip on all its bones in place of the pose
 *   (CaptureFrame, SkinnedPerson.apply). The bones go back to their pose when the frame stops. No crossfade.
 *
 * The layer has no crossfade and no foot lock: the animator (`animator/`) has them.
 *
 * Trunk turns: a bone turns by D = L0⁻¹ · L (L its rotation in the parent, L0 in the mean pose). The rig driver gives a
 * bone the rotation B = G · W of its neutral joint (W: the rest rotation of the bone in the model frame), so the joint
 * turns by W · D · W⁻¹. The pelvis and spine_02 have no neutral joint of their own here: their turns go to the back
 * (spine_01). The turn of the pelvis (the hinge at the hips that pushes) thus goes to the back: the legs stand.
 */
import { Quaternion, Vector3, type AnimationClip, type Object3D } from "three";
import type { TrunkTurns } from "./body";
import { ClipSampler, clipTime } from "./clipSampler";
import type { BodyPose } from "./place";

/**
 * How a character plays a recorded clip. `Rig` is the data that the `rig` hook takes from the clip file (null without a
 * hook). `Family` is the clip family of the plugin, `Pose` its pose.
 */
export interface ClipConfig<Rig = unknown, Family extends string = string, Pose extends BodyPose = BodyPose> {
  /** The family of the library clip in the manifest of the plugin (its asset choice). */
  readonly family: Family;
  /**
   * The time map. "cycle": the cycle count of the pose (BodyPose.cycle) round the work cycles of the clip
   * (clipTime); the clip needs one full cycle, else the character keeps its pose. "seconds": a clip time from the
   * choreography of the core.
   */
  readonly time: "cycle" | "seconds";
  /**
   * The trunk drive: null for the turns of the capture. A number for a forward lean: the back and the upper back turn
   * by the angle of their turn in the capture, times this share, about their own x axis, and the neck and the head do
   * not turn (the look of the pose aims them). A capture with the work at another side of the actor or lower than
   * the work of the scene then fits a character that faces its work.
   */
  readonly bend: number | null;
  /** What the member keeps when the clip does not load (the end of the warning). */
  readonly fallback: string;
  /**
   * When the trunk drive plays and at what time: the cycle count or the clip seconds (the time map) for a pose
   * at the simulation time `sim`, or null when the layer does not play. Without the hook the choreography of the core
   * starts the clip (a timed one-shot clip).
   */
  readonly play?: (pose: Pose, sim: number) => number | null;
  /**
   * The data of the all-bones drive from the clip file (for example the press frame of a capture). Throws when the clip
   * does not fit.
   */
  readonly rig?: (layer: ClipLayer) => Rig;
}

/** The bones of the clip that turn each joint of the neutral body. */
const JOINTS: Readonly<Record<Exclude<keyof TrunkTurns, "lift">, readonly string[]>> = {
  spine: ["pelvis", "spine_01", "spine_02"],
  chest: ["spine_03"],
  neck: ["neck_01"],
  head: ["head"],
};

interface TrunkBone {
  readonly node: Object3D;
  /** W, and W⁻¹. */
  readonly rest: Quaternion;
  readonly restInverse: Quaternion;
  /** L0⁻¹: the inverse rotation in the parent in the mean pose. */
  readonly meanInverse: Quaternion;
}

const turn = new Quaternion();
const place = new Vector3();

export class ClipLayer {
  private readonly sampler: ClipSampler;
  private readonly nodes = new Map<string, Object3D>();
  private readonly model: Object3D;
  private readonly bones: Readonly<Record<keyof typeof JOINTS, readonly TrunkBone[]>>;
  private readonly trunk: {
    -readonly [K in keyof TrunkTurns]: TrunkTurns[K];
  } = { spine: new Quaternion(), chest: new Quaternion(), neck: new Quaternion(), head: new Quaternion(), lift: 0 };
  private readonly pelvis: Object3D;
  /** The place of the pelvis in the mean pose (in the frame of the model: y is up). */
  private readonly pelvisMean = new Vector3();

  /**
   * `scene` is the scene of the clip file (its skeleton at the rest pose), `clip` its animation, `cycles` the number
   * of work cycles after the mean pose (for the time map "cycle"). Throws when the clip has no bone of the
   * trunk.
   */
  constructor(
    scene: Object3D,
    readonly clip: AnimationClip,
    private readonly config: Pick<ClipConfig, "time" | "bend">,
    private readonly cycles: number,
  ) {
    const model = scene.clone(true);
    this.model = model;
    model.position.set(0, 0, 0);
    model.quaternion.identity();
    model.updateMatrixWorld(true);
    // A clip file has no skin, so its bones are plain nodes: find them by name.
    model.traverse((node) => {
      if (!this.nodes.has(node.name)) this.nodes.set(node.name, node);
    });
    const bone = (name: string): TrunkBone => {
      const node = this.bone(name);
      const rest = node.getWorldQuaternion(new Quaternion());
      return { node, rest, restInverse: rest.clone().invert(), meanInverse: new Quaternion() };
    };
    this.bones = {
      spine: JOINTS.spine.map(bone),
      chest: JOINTS.chest.map(bone),
      neck: JOINTS.neck.map(bone),
      head: JOINTS.head.map(bone),
    };
    this.pelvis = this.bones.spine[0]?.node ?? model;
    this.sampler = new ClipSampler(clip, model);
    this.sampler.sample(0);
    for (const list of Object.values(this.bones)) {
      for (const item of list) item.meanInverse.copy(item.node.quaternion).invert();
    }
    this.pelvis.getWorldPosition(this.pelvisMean);
  }

  /** The node of a bone of the clip file. Throws when the clip has no such bone. */
  bone(name: string): Object3D {
    const node = this.nodes.get(name);
    if (node === undefined) throw new Error(`The clip has no bone "${name}".`);
    return node;
  }

  /** Put the copy of the skeleton in the pose of the clip at `seconds`, with its frames in the model (a rig hook). */
  pose(seconds: number): void {
    this.sampler.sample(seconds);
    this.model.updateMatrixWorld(true);
  }

  /**
   * The turns of the joints of the neutral body and the lift of the hips at `at`: a cycle count
   * (BodyPose.cycle) or the seconds of the clip, from the time map of the config. The result is one object of this
   * layer that the next call changes (no new objects in a frame): use it at once, or copy it.
   */
  turns(at: number): TrunkTurns {
    this.sampler.sample(this.config.time === "cycle" ? clipTime(at, this.cycles) : at);
    this.pelvis.parent?.updateWorldMatrix(true, false);
    this.trunk.lift = this.pelvis.getWorldPosition(place).y - this.pelvisMean.y;
    const bend = this.config.bend;
    for (const joint of Object.keys(JOINTS) as (keyof typeof JOINTS)[]) {
      const total = this.trunk[joint].identity();
      for (const { node, rest, restInverse, meanInverse } of this.bones[joint]) {
        turn.copy(meanInverse).multiply(node.quaternion);
        total.multiply(turn.premultiply(rest).multiply(restInverse));
      }
      // The bend toward the work of the capture as a forward lean: the angle of the turn, about x.
      if (bend !== null) {
        const angle = joint === "spine" || joint === "chest" ? 2 * Math.acos(Math.min(1, Math.abs(total.w))) : 0;
        const half = (angle * bend) / 2;
        total.set(Math.sin(half), 0, 0, Math.cos(half));
      }
    }
    return this.trunk;
  }
}
