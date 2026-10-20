// SPDX-License-Identifier: Apache-2.0
// The walks of the `locomotion` component in the time line (src/scene/timeline.ts): the robot of the table
// scene of the characters sample walks around the table to the stand point behind it. The animator gets the walk
// speed, so the robot walks while it moves and stands at the stand point. Three.js runs in Bun with no renderer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { builtinRegistry, readDocument, type SceneDocument, type SequenceDocument } from "@scenity/scene";
import { SceneBuilder, SceneTimeline, type AssetKind, type AssetSource, type AssetValue } from "../src";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
const registry = builtinRegistry();

function read<K extends "scene" | "sequence">(path: string, kind: K) {
  const result = readDocument(readFileSync(join(SAMPLE, path), "utf8"), kind, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** The robot glTF from the disk, with its clips on the scene (`Object3D.animations`). */
class RobotAssets implements AssetSource {
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the sample has only a model");
    const data = readFileSync(join(SAMPLE, "assets/sources/RobotExpressive/RobotExpressive.glb"));
    const gltf = await new GLTFLoader().parseAsync(
      data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
      "",
    );
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

async function player() {
  const scene: SceneDocument = read("scenes/table.scene.json", "scene");
  const sequence: SequenceDocument = read("sequences/table-walk.sequence.json", "sequence");
  const builder = new SceneBuilder({ assets: new RobotAssets() });
  builder.build(scene);
  await builder.ready();
  const timeline = new SceneTimeline(builder, scene, sequence);
  const robot = (): Object3D => builder.root.getObjectByName("robot") ?? builder.root;
  const place = (t: number) => {
    timeline.at(t);
    return robot().getWorldPosition(new Vector3());
  };
  return { builder, timeline, robot, place };
}

/** The local rotation and place of each bone, and the world place of the robot, rounded to 1e-9. */
function pose(robot: Object3D): number[] {
  const out = robot
    .getWorldPosition(new Vector3())
    .toArray()
    .map((value) => Math.round(value * 1e9));
  robot.traverse((node) => {
    if ((node as Partial<{ isBone: boolean }>).isBone !== true) return;
    for (const value of [...node.quaternion.toArray(), ...node.position.toArray()]) out.push(Math.round(value * 1e9));
  });
  return out;
}

describe("the locomotion component in the time line", () => {
  test("the robot walks around the table and stops at the stand point", async () => {
    const { place } = await player();
    expect(place(500).toArray()).toEqual([-2.2, 0, 1.2]);
    // At the side of the table: left of its edge (x = -0.7), level with it.
    const side = place(2600);
    expect(side.x).toBeLessThan(-0.98 + 1e-6);
    expect(side.z).toBeLessThan(0);
    const stand = place(5000);
    expect(stand.x).toBeCloseTo(0, 6);
    expect(stand.z).toBeCloseTo(-1, 6);
  });

  test("the animator walks while the robot moves, then stands and waves", async () => {
    const { timeline } = await player();
    const state = (t: number) => timeline.at(t)[0]?.layers[0];
    expect(state(500)).toEqual({ name: "base", state: "idle", from: null });
    expect(state(1100)).toEqual({ name: "base", state: "walk", from: "idle" });
    expect(state(2600)).toEqual({ name: "base", state: "walk", from: null });
    expect(state(4400)).toEqual({ name: "base", state: "idle", from: "walk" });
    expect(state(5000)).toEqual({ name: "base", state: "idle", from: null });
    expect(state(5900)).toEqual({ name: "base", state: "wave", from: null });
  });

  test("seek equals play: the place and the bones of a play and of seeks are the same", async () => {
    const play = await player();
    const seeks = await player();
    const times = Array.from({ length: 90 }, (_, index) => index * 75 + ((index * 37) % 50));
    const poses = new Map<number, number[]>();
    let since = -1;
    for (const t of times) {
      play.timeline.at(t, since);
      poses.set(t, pose(play.robot()));
      since = t;
    }
    for (const t of [...times].reverse()) {
      seeks.timeline.at(t);
      expect(pose(seeks.robot())).toEqual(poses.get(t)!);
    }
  });

  test("an edit of the stand point plans the walk again", async () => {
    const { timeline, place } = await player();
    timeline.at(0);
    expect(timeline.edit([{ op: "set", path: "/entities/spot/components/transform/position/0", value: 0.5 }]).ok).toBe(
      true,
    );
    expect(place(6000).x).toBeCloseTo(0.5, 6);
  });
});
