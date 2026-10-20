// SPDX-License-Identifier: Apache-2.0
// The IK of any skeleton, the attach and the rig of a character: `solveLimb` puts a hand on a target with
// the elbow on the side of the pole, `aimAt` turns a head to a target within its limit, the attach parses a parent
// and moves an object under it, and `characterBones` gives the bone map of a profile and of the bone names.
import { describe, expect, test } from "bun:test";
import { Bone, Group, Object3D, Vector3 } from "three";
import { attachTarget, attachTo } from "../src/attach";
import { boneNode, characterBones, findNode } from "../src/characterRig";
import { aimAt, solveLimb } from "../src/ik";
import { referenceRig } from "../src/referenceRig";

/** An arm that hangs down from the origin: a 0.3 m upper bone and a 0.25 m lower bone. */
function arm() {
  const upper = new Bone();
  const lower = new Bone();
  const end = new Object3D();
  lower.position.set(0, -0.3, 0);
  end.position.set(0, -0.25, 0);
  upper.add(lower);
  lower.add(end);
  upper.updateMatrixWorld(true);
  return { upper, lower, end };
}

const world = (node: Object3D): Vector3 => node.getWorldPosition(new Vector3());

describe("the IK of any skeleton", () => {
  test("a limb puts its end on a target in reach, with the elbow on the side of the pole", () => {
    for (const pole of [new Vector3(1, 0, 0), new Vector3(-1, 0, 0), new Vector3(0, 0, -1)]) {
      const { upper, lower, end } = arm();
      const target = new Vector3(0, -0.2, 0.35);
      solveLimb(upper, lower, end, target, pole, 1);
      expect(world(end).distanceTo(target)).toBeLessThan(1e-6);
      // The elbow is off the line from the root to the target, toward the pole.
      const elbow = world(lower);
      const line = target.clone().normalize();
      const off = elbow.clone().sub(line.multiplyScalar(elbow.dot(line)));
      expect(off.dot(pole)).toBeGreaterThan(0.05);
      expect(world(lower).length()).toBeCloseTo(0.3, 6);
    }
  });

  test("a target out of reach straightens the limb toward it; a weight mixes the pose", () => {
    const { upper, lower, end } = arm();
    const target = new Vector3(0, 0, 2);
    solveLimb(upper, lower, end, target, new Vector3(0, -1, 0), 1);
    expect(world(end).length()).toBeCloseTo(0.55, 4);
    expect(
      world(end)
        .normalize()
        .dot(new Vector3(0, 0, 1)),
    ).toBeGreaterThan(0.999);
    const half = arm();
    solveLimb(half.upper, half.lower, half.end, new Vector3(0, -0.2, 0.35), new Vector3(1, 0, 0), 0);
    expect(world(half.end).distanceTo(new Vector3(0, -0.55, 0))).toBeLessThan(1e-9);
  });

  test("a head turns to its target within the limit", () => {
    const head = new Object3D();
    const nose = new Object3D();
    nose.position.set(0, 0, 1);
    head.add(nose);
    head.updateMatrixWorld(true);
    aimAt(head, new Vector3(0, 0, 1), new Vector3(1, 0, 0), 1, Math.PI);
    expect(world(nose).distanceTo(new Vector3(1, 0, 0))).toBeLessThan(1e-6);
    head.quaternion.identity();
    head.updateMatrixWorld(true);
    aimAt(head, new Vector3(0, 0, 1), new Vector3(1, 0, 0), 1, Math.PI / 4);
    expect(world(nose).angleTo(new Vector3(0, 0, 1))).toBeCloseTo(Math.PI / 4, 6);
  });
});

describe("the attach to a bone", () => {
  test("the parent of an attach reference", () => {
    expect(attachTarget("entity:robot#rightHand")).toEqual({ entity: "robot", socket: "rightHand" });
    expect(attachTarget("entity:cart")).toEqual({ entity: "cart", socket: null });
    expect(attachTarget("asset:cart")).toBeNull();
    expect(attachTarget("entity:")).toBeNull();
  });

  test("an object goes under its parent at a local place, one time", () => {
    const hand = new Group();
    const prop = new Object3D();
    prop.position.set(1, 2, 3);
    attachTo(prop, hand, [0.1, 0.2, 0.3]);
    expect(prop.parent).toBe(hand);
    expect(prop.position.toArray()).toEqual([0.1, 0.2, 0.3]);
    prop.position.set(5, 5, 5);
    attachTo(prop, hand, [0, 0, 0]);
    expect(prop.position.toArray()).toEqual([5, 5, 5]);
  });

  test("the bone map of a character: the profile, then the bone names of the component", () => {
    const root = referenceRig().model;
    const map = characterBones(root, { bones: { leftHand: "lowerarm_l" } });
    expect(map.get("head")).toBe("head");
    expect(map.get("leftHand")).toBe("lowerarm_l");
    expect(boneNode(root, map, "rightHand")?.name).toBe("hand_r");
    expect(boneNode(root, map, "pelvis")?.name).toBe("pelvis");
    const problems: string[] = [];
    expect(characterBones(root, { rig: "rigify" }, problems).size).toBe(0);
    expect(problems[0]).toContain("rigify");
    // A bone wins over a mesh with the same name; a name with a dot finds the name of the glTF loader.
    const model = new Group();
    const mesh = new Object3D();
    mesh.name = "Head";
    const bone = new Bone();
    bone.name = "Head";
    const palm = new Bone();
    palm.name = "Palm2R";
    model.add(mesh, bone, palm);
    expect(findNode(model, "Head")).toBe(bone);
    expect(findNode(model, "Palm2.R")).toBe(palm);
    // The loader names the bone "Torso_1" when a mesh "Torso" comes before it: the bone wins.
    const torsoMesh = new Object3D();
    torsoMesh.name = "Torso";
    const torso = new Bone();
    torso.name = "Torso_1";
    model.add(torsoMesh, torso);
    expect(findNode(model, "Torso")).toBe(torso);
    expect(characterBones(model, { rig: "none", bones: { chest: "Torso", rightHand: "Palm2.R" } })).toEqual(
      new Map([
        ["chest", "Torso_1"],
        ["rightHand", "Palm2R"],
      ]),
    );
    const missing: string[] = [];
    characterBones(model, { rig: "none", bones: { leftHand: "Palm2.L" } }, missing);
    expect(missing).toEqual(['the model has no node "Palm2.L" for the bone "leftHand"']);
  });
});
