// SPDX-License-Identifier: Apache-2.0
// The pose mixer and the foot lock of the animator (src/animator/poseMixer.ts, src/animator/footLock.ts) on the
// robot of the characters sample (RobotExpressive.glb, CC0) and on small synthetic chains. Three.js runs in Bun with no
// renderer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { AnimationClip, Bone, Group, Matrix4, Object3D, Quaternion, Vector3, VectorKeyframeTrack } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { sampleTrack } from "@scenity/scene/sequence";
import type { AnimatorFrame, LayerPose } from "../src/animator/index";
import { createAnimator } from "../src/animator/index";
import { contactsOf, FootLock, solveTwoBone } from "../src/animator/footLock";
import { PoseMixer, type ProceduralMotion } from "../src/animator/poseMixer";
import { ClipSampler } from "../src/clipSampler";
import { robotAnimator, robotOptions, sampleSequence } from "./animatorKit";

const GLB = join(import.meta.dir, "../../../samples/characters/assets/sources/RobotExpressive/RobotExpressive.glb");

async function loadRobot(): Promise<{ scene: Object3D; clips: AnimationClip[] }> {
  const data = readFileSync(GLB);
  const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
  const gltf = await new GLTFLoader().parseAsync(buffer, "");
  return { scene: gltf.scene, clips: gltf.animations };
}

function layer(samples: LayerPose["samples"], extra: Partial<LayerPose> = {}): LayerPose {
  return {
    name: "test",
    weight: 1,
    blend: "override",
    mask: null,
    state: "s",
    phase: 0,
    from: null,
    fromPhase: 0,
    fade: 1,
    enter: 0,
    fadeEnd: 0,
    samples,
    ...extra,
  };
}

function frame(layers: LayerPose[], rootMotion: AnimatorFrame["rootMotion"] = "clip"): AnimatorFrame {
  return { t: 0, rootMotion, layers, events: [] };
}

// An angle from Quaternion.angleTo near 0 has an error of about 1e-4 rad (the acos of a dot product near 1).
const ANGLE = 2e-3;
const clipAt = (clip: string, time: number, weight = 1) => ({ kind: "clip" as const, clip, time, weight });

const robot = await loadRobot();

describe("the pose mixer", () => {
  test("one clip gives the pose of the clip sampler; a node that the clip does not key keeps its rest pose", () => {
    const mixer = new PoseMixer(robot.scene, robot.clips);
    expect(mixer.lengths.Wave).toBeCloseTo(1.8333, 3);
    const foot = mixer.node("FootL");
    const rest = foot?.position.clone();
    mixer.apply(frame([layer([clipAt("Running", 0.4)])]));
    expect(foot?.position.equals(rest ?? new Vector3())).toBe(false);
    // Idle has no track of the foot control bone: the foot returns to its rest place.
    mixer.apply(frame([layer([clipAt("Idle", 1.2)])]));
    expect(foot?.position.distanceTo(rest ?? new Vector3())).toBeLessThan(1e-9);
    const copy = robot.scene.clone(true);
    new ClipSampler(
      robot.clips.find((clip) => clip.name === "Idle")!,
      copy,
    ).sample(1.2);
    const head = mixer.node("Head")?.quaternion;
    expect(head?.angleTo(copy.getObjectByName("Head")!.quaternion)).toBeLessThan(ANGLE);
  });

  test("two clips mix by their weights", () => {
    const mixer = new PoseMixer(robot.scene, robot.clips);
    const pose = (clip: string) => {
      mixer.apply(frame([layer([clipAt(clip, 0.3)])]));
      return mixer.node("Body")!.position.clone();
    };
    const walk = pose("Walking");
    const run = pose("Running");
    mixer.apply(frame([layer([clipAt("Walking", 0.3, 0.25), clipAt("Running", 0.3, 0.75)])]));
    const mixed = mixer.node("Body")!.position;
    expect(mixed.distanceTo(walk.clone().lerp(run, 0.75))).toBeLessThan(1e-9);
  });

  test("a masked layer drives its bones and their children only; an additive layer at time 0 adds nothing", () => {
    const mixer = new PoseMixer(robot.scene, robot.clips);
    mixer.apply(frame([layer([clipAt("Idle", 0.5)])]));
    const idleHead = mixer.node("Head")!.quaternion.clone();
    const idleArm = mixer.node("UpperArmR")!.quaternion.clone();
    mixer.apply(frame([layer([clipAt("Wave", 0.9)])]));
    const waveArm = mixer.node("UpperArmR")!.quaternion.clone();
    expect(waveArm.angleTo(idleArm)).toBeGreaterThan(0.05);
    mixer.apply(frame([layer([clipAt("Idle", 0.5)]), layer([clipAt("Wave", 0.9)], { mask: ["ShoulderR"] })]));
    expect(mixer.node("UpperArmR")!.quaternion.angleTo(waveArm)).toBeLessThan(ANGLE);
    expect(mixer.node("Head")!.quaternion.angleTo(idleHead)).toBeLessThan(ANGLE);
    mixer.apply(frame([layer([clipAt("Idle", 0.5)]), layer([clipAt("Wave", 0)], { blend: "additive" })]));
    expect(mixer.node("UpperArmR")!.quaternion.angleTo(idleArm)).toBeLessThan(ANGLE);
  });

  test("a procedural motion of a plugin changes the nodes after the clips of its layer, by its weight", () => {
    const calls: number[] = [];
    const nod: ProceduralMotion = {
      id: "test.nod",
      apply(node, sample) {
        calls.push(sample.weight);
        node("Head")?.quaternion.multiply(new Quaternion().setFromAxisAngle(new Vector3(1, 0, 0), sample.weight));
      },
    };
    const mixer = new PoseMixer(robot.scene, robot.clips, { procedural: new Map([[nod.id, nod]]) });
    mixer.apply(frame([layer([clipAt("Idle", 0.5)])]));
    const head = mixer.node("Head")!.quaternion.clone();
    const procedural = { kind: "procedural" as const, id: "test.nod", time: 0, phase: 0, weight: 1 };
    mixer.apply(frame([layer([clipAt("Idle", 0.5)]), layer([procedural], { weight: 0.5 })]));
    expect(calls).toEqual([0.5]);
    expect(mixer.node("Head")!.quaternion.angleTo(head)).toBeCloseTo(0.5, 6);
  });

  test("the root motion choice: in-place keeps the floor place of the root bone, clip keeps the clip motion", () => {
    const root = new Group();
    const armature = new Object3D();
    armature.quaternion.setFromAxisAngle(new Vector3(1, 0, 0), -Math.PI / 2);
    armature.scale.setScalar(100);
    const hips = new Bone();
    hips.name = "hips";
    root.add(armature);
    armature.add(hips);
    // The clip moves the hips 0.02 along local y (the model -z after the turn of the armature) and 0.01 up.
    const track = new VectorKeyframeTrack("hips.position", [0, 1], [0, 0, 0, 0, 0.02, 0.01]);
    const mixer = new PoseMixer(root, [new AnimationClip("drift", 1, [track])]);
    const world = () => {
      root.updateMatrixWorld(true);
      return hips.getWorldPosition(new Vector3());
    };
    mixer.apply(frame([layer([clipAt("drift", 1)])], "clip"));
    expect(
      world()
        .toArray()
        .map((value) => Math.round(value * 100) / 100),
    ).toEqual([0, 1, -2]);
    mixer.apply(frame([layer([clipAt("drift", 1)])], "in-place"));
    expect(
      world()
        .toArray()
        .map((value) => Math.round(value * 100) / 100),
    ).toEqual([0, 1, 0]);
  });
});

describe("the foot lock", () => {
  test("the contacts of a foot: the lowest share of its heights, one contact over the end of the clip", () => {
    expect(contactsOf([0, 0, 1, 1, 1, 1, 0, 0], 0.2)).toEqual([{ start: 0.75, end: 1.25 }]);
    expect(contactsOf([1, 0, 0, 1], 0.2)).toEqual([{ start: 0.25, end: 0.75 }]);
    expect(contactsOf([0.5, 0.5, 0.5], 0.2)).toEqual([{ start: 0, end: 1 }]);
  });

  test("the two-bone IK puts the end of the chain on a target in reach", () => {
    const upper = new Bone();
    const lower = new Bone();
    const end = new Object3D();
    lower.position.set(0, -1, 0.05);
    end.position.set(0, -1, 0);
    upper.add(lower);
    lower.add(end);
    upper.updateMatrixWorld(true);
    const target = new Vector3(0.3, -1.5, 0.4);
    solveTwoBone(upper, lower, end, target, 1);
    expect(end.getWorldPosition(new Vector3()).distanceTo(target)).toBeLessThan(1e-6);
  });

  test("a walk over the floor: a foot in contact keeps its floor place from frame to frame", () => {
    const sequence = sampleSequence();
    const place = sequence.tracks.find((track) => track.kind === "transform");
    if (place === undefined) throw new Error("no transform track");
    const worldAt = (t: number) => {
      const sample = sampleTrack(place, t);
      if (sample.kind !== "transform") return null;
      const position = new Vector3(...(sample.position ?? [0, 0, 0]));
      const rotation = new Quaternion(...(sample.rotation ?? [0, 0, 0, 1]));
      return new Matrix4().compose(position, rotation, new Vector3(0.25, 0.25, 0.25));
    };
    const entity = new Group();
    const model = robot.scene.clone(true);
    entity.add(model);
    const mixer = new PoseMixer(model, robot.clips);
    const lock = new FootLock(mixer, robotAnimator().footLock!);
    expect(lock.size).toBe(2);
    expect(lock.contacts(0, "Walking").length).toBe(1);
    const animator = createAnimator(robotOptions(sequence));
    const footAt = (t: number, locked: boolean) => {
      const matrix = worldAt(t)!;
      matrix.decompose(entity.position, entity.quaternion, entity.scale);
      entity.updateMatrixWorld(true);
      const pose = animator.at(t);
      mixer.apply(pose);
      if (locked) lock.apply(pose, animator, entity, worldAt);
      model.updateMatrixWorld(true);
      return mixer.node("LowerLegL_end")!.getWorldPosition(new Vector3());
    };
    // The left contact of the walk cycle: find frames of the walk where the lock holds the left foot.
    const times = Array.from({ length: 60 }, (_, index) => 2000 + index * 16);
    const free = times.map((t) => footAt(t, false));
    const held = times.map((t) => footAt(t, true));
    let longest = 0;
    let run = 0;
    for (let index = 1; index < times.length; index += 1) {
      const still = Math.hypot(held[index]!.x - held[index - 1]!.x, held[index]!.z - held[index - 1]!.z) < 1e-4;
      run = still ? run + 1 : 0;
      longest = Math.max(longest, run);
    }
    // The locked foot stands still over several frames; the free foot of the same frames slides.
    expect(longest).toBeGreaterThanOrEqual(5);
    const slide = Math.max(...free.slice(1).map((point, index) => point.distanceTo(free[index]!)));
    expect(slide).toBeGreaterThan(1e-3);
  });
});
