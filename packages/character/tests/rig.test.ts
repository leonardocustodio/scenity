// SPDX-License-Identifier: Apache-2.0
// The humanoid rig of the characters (src/rig.ts, src/rigDriver.ts): the bone list, the skeleton check with the
// reference skeleton, and the body sizes that the rig driver measures.
import { describe, expect, it } from "bun:test";
import { referenceRig } from "../src/referenceRig";
import { checkSkeleton, HUMANOID_BONES, MAX_BONES } from "../src/rig";
import { DRIVEN_BONES, findBones, RigDriver } from "../src/rigDriver";

describe("the humanoid rig", () => {
  it("has 53 required bones in parent-first order, within the bone limit", () => {
    expect(HUMANOID_BONES.filter((bone) => bone.optional !== true)).toHaveLength(53);
    expect(HUMANOID_BONES.length).toBeLessThanOrEqual(MAX_BONES);
    const seen = new Set<string>();
    for (const bone of HUMANOID_BONES) {
      if (bone.parent !== null) expect(seen.has(bone.parent)).toBe(true);
      seen.add(bone.name);
    }
  });

  it("passes the check with the reference skeleton and finds a missing or an unknown bone", () => {
    const rig = referenceRig();
    const bones = [...rig.bones.values()].map((bone) => ({
      name: bone.name,
      parent: rig.bones.has(bone.parent?.name ?? "") ? (bone.parent?.name ?? null) : null,
    }));
    expect(checkSkeleton(bones)).toEqual([]);
    expect(checkSkeleton(bones.filter((bone) => bone.name !== "hand_l"))).toContain("missing bone hand_l");
    expect(checkSkeleton([...bones, { name: "tail", parent: "pelvis" }])).toContain("unknown bone tail");
  });
});

describe("the rig driver", () => {
  it("sizes the body from the rest pose of the skeleton", () => {
    const driver = new RigDriver(referenceRig().model);
    expect(driver.size.upperLength).toBeCloseTo(0.29, 3);
    expect(driver.size.lowerLength).toBeCloseTo(0.26, 3);
    expect(driver.size.thighLength).toBeCloseTo(0.42, 2);
    expect(driver.size.hipHeight).toBeGreaterThanOrEqual(0.95);
    expect(DRIVEN_BONES).toContain("upperarm_l");
    expect(driver.boneNames[0]).toBe("root");
  });

  it("refuses a skeleton without a needed bone", () => {
    const rig = referenceRig();
    const hand = findBones(rig.model).get("hand_r");
    hand?.parent?.remove(hand);
    expect(() => new RigDriver(rig.model)).toThrow('The character has no bone "hand_r".');
  });
});
