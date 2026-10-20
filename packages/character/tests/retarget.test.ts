// SPDX-License-Identifier: Apache-2.0
// The rig profiles and the retarget (src/profiles, src/rest.ts, src/retarget.ts). The Rigify mannequin of the
// characters sample (RigifyMannequin.glb, CC0, own work) and the reference skeleton of the rig spec (UE5 bone names,
// an A-pose, other bone axes) play the same clips: the canonical bone directions agree at each sample time.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnimationClip, Quaternion, QuaternionKeyframeTrack, Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import {
  detectProfile,
  profileFor,
  resolveProfile,
  RIGIFY_PROFILE,
  UE5_PROFILE,
  type RigProfile,
} from "../src/profiles/index";
import { PoseMixer } from "../src/animator/poseMixer";
import { referenceRig } from "../src/referenceRig";
import { boneDirections, boneIndices, poseAt, restPoseOf, restPoseOfGltf, type RestPose } from "../src/rest";
import { retargetClip } from "../src/retarget";

const SOURCES = join(import.meta.dir, "../../../samples/characters/assets/sources");
const MANNEQUIN = join(SOURCES, "RigifyMannequin/RigifyMannequin.glb");
const ROBOT = join(SOURCES, "RobotExpressive/RobotExpressive.glb");

function glbJson(path: string): Record<string, unknown> {
  const data = readFileSync(path);
  const length = data.readUInt32LE(12);
  return JSON.parse(data.subarray(20, 20 + length).toString("utf8")) as Record<string, unknown>;
}

async function load(path: string): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  const data = readFileSync(path);
  const gltf = await new GLTFLoader().parseAsync(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
    "",
  );
  return { scene: gltf.scene, clips: gltf.animations };
}

const names = (rest: RestPose) => rest.nodes.map((node) => node.name);

/** The largest angle in degrees between the canonical bone directions of two posed skeletons, over the times. */
function worstAngle(
  source: { rest: RestPose; profile: RigProfile; clip: AnimationClip },
  target: { rest: RestPose; profile: RigProfile; clip: AnimationClip },
  times: readonly number[],
): { angle: number; bones: number } {
  const from = boneIndices(source.rest, resolveProfile(source.profile, names(source.rest)));
  const to = boneIndices(target.rest, resolveProfile(target.profile, names(target.rest)));
  let angle = 0;
  let bones = 0;
  for (const t of times) {
    const a = boneDirections(from, poseAt(source.rest, source.clip, t), to);
    const b = boneDirections(to, poseAt(target.rest, target.clip, t), from);
    bones = 0;
    for (const [bone, dir] of a) {
      const other = b.get(bone);
      if (other?.child !== dir.child) continue;
      angle = Math.max(angle, (dir.direction.angleTo(other.direction) * 180) / Math.PI);
      bones += 1;
    }
  }
  return { angle, bones };
}

const mannequin = await load(MANNEQUIN);
const mannequinRest = restPoseOf(mannequin.scene);
const idle = mannequin.clips.find((clip) => clip.name === "Idle");
const reference = restPoseOf(referenceRig().model);

describe("the rig profiles", () => {
  test("the reference skeleton is a UE5 skeleton with a short spine: all 52 canonical bones", () => {
    const found = detectProfile(names(reference));
    expect(found?.profile.id).toBe("ue5");
    expect(found?.map.size).toBe(52);
    expect(found?.map.get("chest")).toBe("spine_02");
    expect(found?.map.get("upperChest")).toBe("spine_03");
    const full = resolveProfile(UE5_PROFILE, ["pelvis", "spine_01", "spine_02", "spine_03", "spine_04", "spine_05"]);
    expect([full.get("chest"), full.get("upperChest")]).toEqual(["spine_03", "spine_05"]);
  });

  test("the Rigify mannequin is a Rigify skeleton (the DEF bones, sanitized by the glTF loader)", () => {
    const found = detectProfile(names(mannequinRest));
    expect(found?.profile.id).toBe("rigify");
    expect(found?.map.get("hips")).toBe("DEF-spine");
    expect(found?.map.get("chest")).toBe("DEF-spine002");
    expect(found?.map.get("leftUpperArm")).toBe("DEF-upper_armL");
    expect(found?.map.size).toBe(22);
  });

  test("Mixamo and VRoid names find their profiles; a skeleton of another shape has no profile", async () => {
    const mixamo = ["Hips", "Spine", "Spine1", "Spine2", "Neck", "Head"].map((n) => `mixamorig${n}`);
    for (const side of ["Left", "Right"])
      mixamo.push(...["Arm", "ForeArm", "Hand", "UpLeg", "Leg", "Foot"].map((n) => `mixamorig${side}${n}`));
    expect(detectProfile(mixamo)?.profile.id).toBe("mixamo");
    const vroid = ["Hips", "Spine", "Head"].map((n) => `J_Bip_C_${n}`);
    for (const s of ["L", "R"])
      vroid.push(...["UpperArm", "LowerArm", "Hand", "UpperLeg", "LowerLeg", "Foot"].map((n) => `J_Bip_${s}_${n}`));
    expect(detectProfile(vroid)?.profile.id).toBe("vrm");
    const robot = await load(ROBOT);
    expect(detectProfile(names(restPoseOf(robot.scene)))).toBeNull();
  });

  test("the record value: a named profile, none, an unknown ID, a profile that does not fit", () => {
    expect(profileFor("rigify", names(mannequinRest))?.profile.id).toBe("rigify");
    expect(profileFor(undefined, names(mannequinRest))?.profile.id).toBe("rigify");
    expect(profileFor("none", names(mannequinRest))).toBeNull();
    expect(() => profileFor("maya", names(mannequinRest))).toThrow("not a rig profile");
    expect(() => profileFor("ue5", names(mannequinRest))).toThrow("the skeleton has no hips");
  });

  test("the rest pose of the glTF JSON has the nodes and names of the glTF loader", () => {
    const fromJson = restPoseOfGltf(glbJson(MANNEQUIN));
    expect(names(fromJson)).toEqual(names(mannequinRest));
    fromJson.nodes.forEach((node, i) => {
      expect(node.parent).toBe(mannequinRest.nodes[i]?.parent ?? -2);
      expect(node.position[1]).toBeCloseTo(mannequinRest.nodes[i]?.position[1] ?? 0, 5);
    });
  });
});

describe("the retarget", () => {
  if (idle === undefined) throw new Error("the mannequin has no Idle clip");
  const times = [0, 0.4, 0.75, 1.1, 1.5, 2.25, 2.9];

  test("the idle of the Rigify mannequin on the UE5 skeleton: the same canonical directions", () => {
    const clip = retargetClip(idle, RIGIFY_PROFILE, UE5_PROFILE, mannequinRest, reference);
    expect(clip.name).toBe("Idle");
    expect(clip.duration).toBeCloseTo(idle.duration, 6);
    const keys = idle.tracks[0]?.times ?? [];
    const atKeys = worstAngle(
      { rest: mannequinRest, profile: RIGIFY_PROFILE, clip: idle },
      { rest: reference, profile: UE5_PROFILE, clip },
      [...keys],
    );
    expect(atKeys.bones).toBeGreaterThanOrEqual(15);
    // The shin segments of Rigify (DEF-shin.L.001) bend a little in the source; the target keeps them straight.
    expect(atKeys.angle).toBeLessThan(0.5);
    const between = worstAngle(
      { rest: mannequinRest, profile: RIGIFY_PROFILE, clip: idle },
      { rest: reference, profile: UE5_PROFILE, clip },
      times,
    );
    expect(between.angle).toBeLessThan(1);
  });

  test("a clip of the UE5 skeleton on the Rigify mannequin (an A-pose clip on another rest pose)", () => {
    const turn = (axis: Vector3, degrees: number) => new Quaternion().setFromAxisAngle(axis, (degrees * Math.PI) / 180);
    const rig = referenceRig();
    const track = (bone: string, axis: Vector3, degrees: number) => {
      const rest = rig.bones.get(bone)?.quaternion.clone() ?? new Quaternion();
      const moved = rest.clone().multiply(turn(axis, degrees));
      return new QuaternionKeyframeTrack(`${bone}.quaternion`, [0, 1], [...rest.toArray(), ...moved.toArray()]);
    };
    const clip = new AnimationClip("Lift", 1, [
      track("upperarm_l", new Vector3(0, 0, 1), -40),
      track("lowerarm_r", new Vector3(1, 0, 0), 50),
      track("spine_02", new Vector3(1, 0, 0), 12),
      track("thigh_l", new Vector3(1, 0, 0), 20),
    ]);
    const moved = retargetClip(clip, UE5_PROFILE, RIGIFY_PROFILE, reference, mannequinRest);
    const result = worstAngle(
      { rest: reference, profile: UE5_PROFILE, clip },
      { rest: mannequinRest, profile: RIGIFY_PROFILE, clip: moved },
      [0, 0.5, 1],
    );
    expect(result.angle).toBeLessThan(0.05);
  });

  test("the pose mixer binds the new clip by node name and gives the pose of the retarget", () => {
    const rig = referenceRig();
    const clip = retargetClip(idle, RIGIFY_PROFILE, UE5_PROFILE, mannequinRest, restPoseOf(rig.model));
    const mixer = new PoseMixer(rig.model, [clip]);
    const time = 1.1;
    mixer.apply({
      t: time * 1000,
      rootMotion: "clip",
      events: [],
      layers: [
        {
          name: "base",
          weight: 1,
          blend: "override",
          mask: null,
          state: "idle",
          phase: 0,
          from: null,
          fromPhase: 0,
          fade: 1,
          enter: 0,
          fadeEnd: 0,
          samples: [{ kind: "clip", clip: "Idle", time, weight: 1 }],
        },
      ],
    });
    const expected = poseAt(restPoseOf(referenceRig().model), clip, time);
    const posed = restPoseOf(rig.model);
    const arm = posed.nodes.findIndex((node) => node.name === "upperarm_l");
    const q = new Quaternion(...(posed.nodes[arm]?.quaternion ?? [0, 0, 0, 1]));
    const want = new Quaternion();
    const parent = expected[posed.nodes[arm]?.parent ?? -1];
    const world = expected[arm];
    if (parent === undefined || world === undefined) throw new Error("no upper arm");
    want.setFromRotationMatrix(parent.clone().invert().multiply(world));
    expect(q.angleTo(want)).toBeLessThan(1e-3);
  });
});
