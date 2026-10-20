// SPDX-License-Identifier: Apache-2.0
// The clips of a built model: a skinned model keeps each of its clips on each level of detail, and each clip gives
// the pose of the source at each time within a stated tolerance. A build that removes the clips of a model makes
// `scenity shot` of samples/characters show the robot in its rest pose.
import { describe, expect, it } from "bun:test";
import type { Document } from "@gltf-transform/core";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { gltfIO, optimizeModel } from "../src/build/optimize";
import { DEFAULT_LODS } from "../src/build/settings";
import { clipDifference } from "./clipSample";

const SOURCES = join(import.meta.dir, "..", "..", "..", "samples", "characters", "assets", "sources");

/**
 * The tolerance of a built clip against its source. The meshopt filters store a rotation in 16 bits and a translation
 * or a scale with a 12-bit mantissa. A rotation of 2e-4 rad moves the tip of a 1 m bone by 0.2 mm.
 */
const TOLERANCE = { rotation: 2e-4, translation: 1e-3, scale: 1e-3 } as const;

/** The times of the samples in seconds: keys, times between keys, and a time after the end of the clip. */
const TIMES = [0, 0.05, 0.2, 0.3333, 0.5, 0.61, 0.75, 0.9, 1.25, 2.5];

function clipNames(document: Document): string[] {
  return document
    .getRoot()
    .listAnimations()
    .map((animation) => animation.getName());
}

async function checkModel(file: string, clips: readonly string[]): Promise<void> {
  const input = new Uint8Array(readFileSync(join(SOURCES, file)));
  const io = await gltfIO();
  const source = await io.readBinary(input);
  const names = clipNames(source);
  for (const clip of clips) expect(names).toContain(clip);
  for (const level of DEFAULT_LODS) {
    const built = await io.readBinary((await optimizeModel(input, level, {})).glb);
    expect(built.getRoot().listSkins().length).toBeGreaterThan(0);
    expect(clipNames(built)).toEqual(names);
    for (const clip of clips) {
      const difference = clipDifference(source, built, clip, TIMES);
      expect(difference.missing.map((channel) => `${level.tier} ${clip} ${channel}`)).toEqual([]);
      expect(difference.rotation).toBeLessThan(TOLERANCE.rotation);
      expect(difference.translation).toBeLessThan(TOLERANCE.translation);
      expect(difference.scale).toBeLessThan(TOLERANCE.scale);
    }
  }
}

describe("the clips of a built model", () => {
  it("keeps the clips of RobotExpressive with the pose of the source at each time", async () => {
    await checkModel(join("RobotExpressive", "RobotExpressive.glb"), ["Idle", "Walking", "Running", "Wave"]);
  });

  it("keeps the clip of the Rigify mannequin with its translations and scales", async () => {
    await checkModel(join("RigifyMannequin", "RigifyMannequin.glb"), ["Idle"]);
  });
});
