// SPDX-License-Identifier: Apache-2.0
// The clips of the animation tracks (src/scene/sequenceClips.ts) on the characters sample. An animation key plays a
// named clip of the model of the robot over its animator. The pose after the clip is the pose of the animator again.
// A seek gives the pose of a play, and the preview clip of the editor plays with no change of the sequence.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { builtinRegistry, readDocument, type SceneDocument, type SequenceDocument } from "@scenity/scene";
import { SceneBuilder, SceneTimeline, type AssetKind, type AssetSource, type AssetValue } from "../src";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
const ROBOT = "asset:01M516A3N0NZMAT1HRKD41JEZ4";
const registry = builtinRegistry();

/** The robot glTF from the disk for each model reference, with its clips on the scene. */
class RobotAssets implements AssetSource {
  readonly loads: string[] = [];

  async load(ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the sample has only a model");
    this.loads.push(ref);
    const data = readFileSync(join(SAMPLE, "assets/sources/RobotExpressive/RobotExpressive.glb"));
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

function scene(): SceneDocument {
  const result = readDocument(readFileSync(join(SAMPLE, "scenes/main.scene.json"), "utf8"), "scene", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** A sequence over the main scene with the keys of an animation track of the robot (none: no track). */
function sequence(keys: readonly Record<string, unknown>[] | null): SequenceDocument {
  const tracks = keys === null ? [] : [{ kind: "animation", entity: "robot", keys }];
  const text = JSON.stringify({ format: "scenity.sequence/1", id: "clips", scene: "main", duration: 6000, tracks });
  const result = readDocument(text, "sequence", { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

async function player(keys: readonly Record<string, unknown>[] | null) {
  const assets = new RobotAssets();
  const builder = new SceneBuilder({ assets });
  const doc = scene();
  builder.build(doc);
  await builder.ready();
  const timeline = new SceneTimeline(builder, doc, sequence(keys));
  // The first frame starts the load of a clip of another asset. The frames after it pose with it.
  timeline.at(0);
  await builder.ready();
  return { assets, builder, timeline };
}

/** The height of the right hand of the robot over the floor at a time. */
function handAt(builder: SceneBuilder, timeline: SceneTimeline, t: number): number {
  timeline.at(t);
  const node = builder.root.getObjectByName("Palm2R");
  if (node === undefined) throw new Error("no hand");
  builder.root.updateMatrixWorld(true);
  return node.getWorldPosition(new Vector3()).y;
}

/** The local rotation and place of each bone of the robot, rounded to 1e-9. */
function bonePose(root: Object3D): number[] {
  const out: number[] = [];
  root.traverse((node) => {
    if ((node as Partial<{ isBone: boolean }>).isBone !== true) return;
    for (const value of [...node.quaternion.toArray(), ...node.position.toArray()]) out.push(Math.round(value * 1e9));
  });
  return out;
}

const WAVE = [
  { t: 0, clip: ROBOT, name: "Wave", loop: true },
  { t: 3000, clip: null },
];

describe("the clips of the animation tracks", () => {
  test("a key plays a named clip of the model over the animator; after the clip the animator poses again", async () => {
    const plain = await player(null);
    const waved = await player(WAVE);
    // The robot idles in the plain sequence. The wave lifts its right hand.
    expect(handAt(waved.builder, waved.timeline, 600) - handAt(plain.builder, plain.timeline, 600)).toBeGreaterThan(
      0.3,
    );
    // After the stop key, the pose is the pose of the animator again: the clip leaves no rest pose.
    const robot = (builder: SceneBuilder) => builder.root.getObjectByName("robot") ?? builder.root;
    plain.timeline.at(4000);
    waved.timeline.at(4000);
    expect(bonePose(robot(waved.builder))).toEqual(bonePose(robot(plain.builder)));
    // The clips of the model itself need no other load.
    expect(waved.assets.loads).toEqual([ROBOT]);
  });

  test("a clip with no name plays the first clip of the asset; a seek gives the pose of a play", async () => {
    const first = await player([{ t: 0, clip: ROBOT, loop: true }]);
    const named = await player([{ t: 0, clip: ROBOT, name: "Wave", loop: true }]);
    const robot = (builder: SceneBuilder) => builder.root.getObjectByName("robot") ?? builder.root;
    first.timeline.at(700);
    named.timeline.at(700);
    expect(bonePose(robot(first.builder))).not.toEqual(bonePose(robot(named.builder)));
    const play = await player(WAVE);
    const seeks = await player(WAVE);
    const times = [0, 150, 900, 1700, 2600, 3100, 4200];
    const poses = new Map<number, number[]>();
    for (const t of times) {
      play.timeline.at(t);
      poses.set(t, bonePose(robot(play.builder)));
    }
    for (const t of [...times].reverse()) {
      seeks.timeline.at(t);
      expect(bonePose(robot(seeks.builder))).toEqual(poses.get(t) ?? []);
    }
  });

  test("a new time line after a clip (an undo of the key) poses as a time line that never had the clip", async () => {
    const plain = await player(null);
    const danced = await player([{ t: 0, clip: ROBOT, name: "Dance", loop: true }]);
    const robot = (builder: SceneBuilder) => builder.root.getObjectByName("robot") ?? builder.root;
    danced.timeline.at(500);
    danced.timeline.dispose();
    const next = new SceneTimeline(danced.builder, scene(), sequence(null));
    next.at(500);
    plain.timeline.at(500);
    expect(bonePose(robot(danced.builder))).toEqual(bonePose(robot(plain.builder)));
  });

  test("the preview clip plays on the entity with no change of the sequence; null stops it", async () => {
    const { builder, timeline } = await player(null);
    const idle = handAt(builder, timeline, 600);
    timeline.previewClip({ entity: "robot", clip: ROBOT, name: "Wave" });
    expect(handAt(builder, timeline, 600) - idle).toBeGreaterThan(0.3);
    expect(timeline.sequence.tracks).toEqual([]);
    timeline.previewClip(null);
    expect(handAt(builder, timeline, 600)).toBeCloseTo(idle, 9);
  });
});
