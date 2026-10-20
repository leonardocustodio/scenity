// SPDX-License-Identifier: Apache-2.0
// The crossfade of the character poses (src/poseBlend.ts): a change of the family starts a fade, a change between two
// families of `ownTiming` does not, and the blend moves the body between poses.
import { describe, expect, it } from "bun:test";
import type { BodyPose, HeldPose, Placement } from "../src/place";
import { blendPoses, fadeShare, MIX, NO_POSE_MIX, nextPoseMix, type MixInput } from "../src/poseBlend";

const STAND: Placement = { at: [0, 0], yaw: 0, walking: false, speed: 0 };
const OWN: ReadonlySet<string> = new Set(["press", "hold"]);

function input(phaseStartMs: number | null): MixInput {
  return { id: "a", phaseStartMs };
}

function pose(parts: Partial<BodyPose & HeldPose>): BodyPose & HeldPose {
  const rest = { kind: "rest", pitch: 0.08, spread: 0.06 } as const;
  return {
    ...{ at: [0, 0], yaw: 0, visible: true, lean: 0, crouch: 0, bob: 0, left: rest, right: rest },
    ...{ look: null, legSwing: 0, nod: 0, prop: "none" },
    ...parts,
  };
}

describe("the pose mixer", () => {
  it("starts a fade at the phase start when the family changes, and ends it after MIX.fadeMs", () => {
    let mix = nextPoseMix(NO_POSE_MIX, input(null), STAND, "idle", 9_950, OWN);
    mix = nextPoseMix(mix, input(10_000), STAND, "work", 10_016, OWN);
    expect(mix.fades.a?.sinceMs).toBe(10_000);
    expect(fadeShare(mix.fades.a, 10_000, false)).toBe(0);
    expect(fadeShare(mix.fades.a, 10_000, true)).toBe(1);
    mix = nextPoseMix(mix, input(10_000), STAND, "work", 10_000 + MIX.fadeMs, OWN);
    expect(mix.fades.a).toBeUndefined();
  });

  it("does not fade between two families that time their own changes", () => {
    const mix = nextPoseMix(NO_POSE_MIX, input(null), STAND, "press", 1_000, OWN);
    expect(nextPoseMix(mix, input(1_100), STAND, "hold", 1_116, OWN).fades.a).toBeUndefined();
    expect(nextPoseMix(mix, input(1_100), STAND, "idle", 1_116, OWN).fades.a).toBeDefined();
  });

  it("blends the body and changes the held thing at the half share", () => {
    const from = pose({ lean: 0, at: [0, 0], prop: "none" });
    const to = pose({ lean: 0.4, at: [1, 0], prop: "cup" });
    const middle = blendPoses(from, to, 0.25);
    expect(middle.lean).toBeCloseTo(0.1, 9);
    expect(middle.at[0]).toBeCloseTo(0.25, 9);
    expect(middle.prop).toBe("none");
    expect(blendPoses(from, to, 0.75).prop).toBe("cup");
    expect(blendPoses(from, to, 1)).toBe(to);
  });
});
