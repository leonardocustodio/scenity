// SPDX-License-Identifier: Apache-2.0
// The bone map of the character setup. A rig profile maps the bones that the skeleton has, and the `bones` of the
// component complete the map. A required bone with no node is missing. Detect finds the profile.
import { MIXAMO_PROFILE, REQUIRED_HUMAN_BONES } from "@scenity/character/profiles";
import { describe, expect, it } from "vitest";
import { bestProfile, boneRows, missingRows, SETUP_BONES } from "../../src/scene/character/characterSetup";

/** The node names of a Mixamo skeleton: the first candidate of each bone of the profile, with the prefix. */
const MIXAMO = Object.values(MIXAMO_PROFILE.bones).flatMap((names) => (names[0] === undefined ? [] : [names[0]]));

describe("the bone map of the character setup", () => {
  it("maps a Mixamo skeleton with its profile, and finds the profile", () => {
    expect(SETUP_BONES.every((bone) => !bone.includes("Proximal"))).toBe(true);
    const rows = boneRows("mixamo", MIXAMO, {});
    expect(missingRows(rows)).toEqual([]);
    expect(rows.find((row) => row.bone === "hips")).toMatchObject({ from: "profile", required: true });
    expect(bestProfile(MIXAMO)).toBe("mixamo");
    expect(bestProfile(["Root", "Body"])).toBe("none");
  });

  it("completes a profile with the bones of the component, and lists the missing bones", () => {
    const own = boneRows("none", ["Hips", "Torso", "Head"], { hips: "Hips", head: "Head" });
    expect(own.find((row) => row.bone === "hips")).toMatchObject({ node: "Hips", from: "bones" });
    expect(own.find((row) => row.bone === "spine")).toMatchObject({ node: null, from: null });
    expect(missingRows(own)).toEqual(REQUIRED_HUMAN_BONES.filter((bone) => bone !== "hips" && bone !== "head"));
  });
});
