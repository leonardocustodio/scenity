// SPDX-License-Identifier: Apache-2.0
/**
 * The test kit of the animator: the controller and the sequence of the characters sample, the clip lengths of
 * its robot, a seeded random generator and random parameter sequences.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { builtinRegistry, type AnimatorValue } from "@scenity/scene/components";
import { readDocument } from "@scenity/scene/read";
import type { SceneDocument } from "@scenity/scene/schema/documents";
import type { SequenceDocument, Track } from "@scenity/scene/sequence";
import { defaultParameters, sequenceParameters, type AnimatorOptions } from "../src/animator/index";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
export const registry = builtinRegistry();

/** The clip lengths of RobotExpressive.glb in seconds (the `max` of the input accessor of each glTF animation). */
export const ROBOT_CLIPS = {
  Idle: 3.3333332538604736,
  Walking: 0.9583333134651184,
  Running: 0.9583333134651184,
  Wave: 1.8333333730697632,
};

export function sampleScene(): SceneDocument {
  const result = readDocument(readFileSync(join(SAMPLE, "scenes/main.scene.json"), "utf8"), "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

export function sampleSequence(): SequenceDocument {
  const text = readFileSync(join(SAMPLE, "sequences/walk-wave.sequence.json"), "utf8");
  const result = readDocument(text, "sequence", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** The animator value of the robot of the sample, with the defaults of the registry. */
export function robotAnimator(): AnimatorValue {
  return registry.fill("animator", sampleScene().entities.robot?.components.animator) as AnimatorValue;
}

/** The animator options of the robot over a sequence (default: the sequence of the sample). */
export function robotOptions(
  sequence: SequenceDocument | null = sampleSequence(),
  checkpointMs?: number,
): AnimatorOptions {
  const value = robotAnimator();
  return {
    value,
    clips: ROBOT_CLIPS,
    parameters: sequenceParameters(sequence, "robot", defaultParameters(value)),
    ...(checkpointMs === undefined ? {} : { checkpointMs }),
  };
}

/** A seeded random generator (mulberry32). */
export function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** A random sequence of the robot parameters: speed keys (steps and ramps) and wave keys. */
export function randomSequence(random: () => number, duration: number): SequenceDocument {
  const times = (count: number) =>
    Array.from({ length: count }, () => Math.floor(random() * duration)).sort((a, b) => a - b);
  const speed: Track = {
    kind: "property",
    entity: "robot",
    path: "animator/parameters/speed",
    keys: times(40).map((t) => ({
      t,
      value: random() < 0.3 ? 0 : Math.round(random() * 2000) / 1000,
      ease: random() < 0.5 ? ("step" as const) : ("linear" as const),
    })),
  };
  const wave: Track = {
    kind: "property",
    entity: "robot",
    path: "animator/parameters/wave",
    keys: times(20).map((t) => ({ t, value: random() < 0.5 })),
  };
  return { format: "scenity.sequence/1", id: "random", scene: "main", duration, tracks: [speed, wave] };
}
