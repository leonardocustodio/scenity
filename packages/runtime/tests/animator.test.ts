// SPDX-License-Identifier: Apache-2.0
// The animator presenter and driver (src/scene/presenters/animator.ts, src/scene/animate.ts) on the
// characters sample: the scene builder builds the robot from its document, the sequence keys the parameters and the
// place, and the driver poses the skinned model with no AnimationMixer. Three.js runs in Bun with no renderer.
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Vector3, type Object3D } from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { builtinRegistry, readDocument, type SceneDocument, type SequenceDocument } from "@scenity/scene";
import {
  animatorHolder,
  AnimatorDriver,
  SceneBuilder,
  SceneTimeline,
  type AnimatorHolder,
  type AssetKind,
  type AssetSource,
  type AssetValue,
} from "../src";

const SAMPLE = join(import.meta.dir, "../../../samples/characters");
const registry = builtinRegistry();

function read<K extends "scene" | "sequence">(path: string, kind: K) {
  const result = readDocument(readFileSync(join(SAMPLE, path), "utf8"), kind, { registry });
  if (!result.ok) throw new Error(JSON.stringify(result.errors));
  return result.doc;
}

/** The asset source of the sample: the robot glTF from the disk, with its clips on the scene (`Object3D.animations`).
 */
class RobotAssets implements AssetSource {
  async load(_ref: string, kind: AssetKind): Promise<AssetValue> {
    if (kind !== "model") throw new Error("the sample has only a model");
    const data = readFileSync(join(SAMPLE, "assets/sources/RobotExpressive/RobotExpressive.glb"));
    const buffer = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
    const gltf = await new GLTFLoader().parseAsync(buffer, "");
    gltf.scene.animations = gltf.animations;
    return gltf.scene;
  }
}

/** A player of the sample: the time line puts the scene of the evaluator at a time and poses the robot. */
async function player() {
  const scene: SceneDocument = read("scenes/main.scene.json", "scene");
  const sequence: SequenceDocument = read("sequences/walk-wave.sequence.json", "sequence");
  const builder = new SceneBuilder({ assets: new RobotAssets() });
  builder.build(scene);
  await builder.ready();
  const timeline = new SceneTimeline(builder, scene, sequence);
  const driver = new AnimatorDriver(builder.root);
  const seek = (t: number, since?: number) => timeline.at(t, since);
  return { builder, driver, timeline, seek };
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

describe("the animator presenter and driver", () => {
  test("the robot walks, stops and waves through the state machine", async () => {
    const { seek } = await player();
    const state = (t: number) => seek(t)[0]?.layers[0];
    expect(state(500)).toEqual({ name: "base", state: "idle", from: null });
    expect(state(1100)).toEqual({ name: "base", state: "walk", from: "idle" });
    expect(state(2500)).toEqual({ name: "base", state: "walk", from: null });
    expect(state(4100)).toEqual({ name: "base", state: "idle", from: "walk" });
    expect(state(5900)).toEqual({ name: "base", state: "wave", from: null });
    expect(state(8000)).toEqual({ name: "base", state: "idle", from: null });
  });

  test("the driver moves the bones of the skinned model; the wave lifts the right hand", async () => {
    const { builder, seek } = await player();
    const hand = () => {
      const node = builder.root.getObjectByName("Palm2R");
      if (node === undefined) throw new Error("no hand");
      builder.root.updateMatrixWorld(true);
      return node.getWorldPosition(new Vector3()).y;
    };
    seek(500);
    const idle = hand();
    seek(5900);
    // The hand of the robot (1.2 m tall) goes from about 0.18 m to about 0.83 m over the floor.
    expect(hand() - idle).toBeGreaterThan(0.4);
  });

  test("seek equals play: the bones of a play and of seeks at random times are the same", async () => {
    const play = await player();
    const seeks = await player();
    const robot = (builder: SceneBuilder) => builder.root.getObjectByName("robot") ?? builder.root;
    let since = -1;
    let random = 607;
    const times = Array.from(
      { length: 120 },
      (_, index) => index * 75 + ((random = (random * 48271) % 2147483647) % 60),
    );
    const poses = new Map<number, number[]>();
    for (const t of times) {
      play.seek(t, since);
      poses.set(t, bonePose(robot(play.builder)));
      since = t;
    }
    for (const t of [...times].reverse()) {
      seeks.seek(t);
      expect(bonePose(robot(seeks.builder))).toEqual(poses.get(t)!);
    }
  });

  test("an op on the parameters shows at the next frame and keeps the revision; another change makes a new one", async () => {
    const { builder, driver } = await player();
    const holder = () => {
      let found: AnimatorHolder | undefined;
      builder.root.traverse((object) => {
        found ??= animatorHolder(object);
      });
      if (found === undefined) throw new Error("no animator holder");
      return found;
    };
    builder.root.updateMatrixWorld(true);
    // With no sequence, the driver reads the parameter values of the component at each frame.
    expect(driver.at(0)[0]?.layers[0]?.state).toBe("idle");
    const parameters = {
      op: "set" as const,
      path: "/entities/robot/components/animator/parameters",
      value: { speed: 2 },
    };
    expect(builder.apply([parameters]).ok).toBe(true);
    expect(holder().revision).toBe(0);
    expect(driver.at(100)[0]?.layers[0]).toEqual({ name: "base", state: "walk", from: "idle" });
    const speed = { op: "set" as const, path: "/entities/robot/components/animator/speed", value: 0.5 };
    expect(builder.apply([speed]).ok).toBe(true);
    expect(holder().revision).toBe(1);
  });
});
